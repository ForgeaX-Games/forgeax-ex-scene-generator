import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance } from 'fastify'
import { getScreenshotService } from '@forgeax/editor-host/backend'
import { broadcastToClients } from '../routes/ws.js'
import { rendererSyncStatus, TERRAIN_MESH_REQUIRED_ACTION } from './rendererStatus.js'

// backend/src/agent/routes.ts → plugin repo root is three dirs up.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const PROJECT_ROOT = process.env.FORGEAX_PROJECT_ROOT ?? resolve(REPO_ROOT, '.forgeax-runtime')

// Agent-facing screenshot view. We deliberately DROP the base64 `dataUrl`:
// handing it to an AI caller dumps hundreds of KB of base64 into the model's
// context as plain *text* (tokenized per-character, not as a vision tile) — one
// capture can blow the window past 100%. Instead we persist the PNG to disk and
// return its path; the agent opens it with the builtin `read_file` tool, which
// yields a proper image content-part and never re-inlines base64 into history.
type ScreenshotRecord = { captureId: string; dataUrl: string; width: number; height: number; capturedAt: string }
type AgentScreenshotView = Omit<ScreenshotRecord, 'dataUrl'> & { path: string; relPath: string; projectId?: string }
const captureProjects = new Map<string, string>()

export function screenshotCaptureProjectId(captureId: string): string | null {
  return captureProjects.get(captureId) ?? null
}

export function noteScreenshotCaptureProject(captureId: string, projectId: string): void {
  captureProjects.set(captureId, projectId)
}

function persistForAgent(rec: ScreenshotRecord): AgentScreenshotView {
  const base64 = rec.dataUrl.includes(',') ? rec.dataUrl.slice(rec.dataUrl.indexOf(',') + 1) : rec.dataUrl
  const dir = join(PROJECT_ROOT, '.cache', 'screenshots')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${rec.captureId}.png`)
  writeFileSync(file, Buffer.from(base64, 'base64'))
  return {
    captureId: rec.captureId,
    width: rec.width,
    height: rec.height,
    capturedAt: rec.capturedAt,
    ...(captureProjects.get(rec.captureId) ? { projectId: captureProjects.get(rec.captureId) } : {}),
    path: file,
    relPath: relative(PROJECT_ROOT, file),
  }
}

// WS-coordinated screenshot capture: /capture broadcasts a request to live
// renderer clients and awaits their /store callback; /latest returns the cache.
export async function registerScreenshotRoutes(app: FastifyInstance): Promise<void> {
  const svc = getScreenshotService()

  app.post('/api/v1/agent/screenshot/capture', { bodyLimit: 20 * 1024 * 1024 }, async (req, reply) => {
    const body = (req.body ?? {}) as { timeout?: number; projectId?: string }
    const projectId = typeof body.projectId === 'string' && body.projectId.trim() ? body.projectId.trim() : null
    if (projectId) {
      const sync = rendererSyncStatus(projectId)
      const visibleLayers = sync.voxelLayers + sync.gridLayers + sync.meshLayers
      if (sync.viewingProjectId !== projectId || !sync.aligned || visibleLayers <= 0) {
        return reply.code(409).send({
          status: 'rejected',
          code: 'screenshot-project-not-ready',
          projectId,
          reason: 'Renderer is not displaying visible output for the requested project.',
          sync,
          nextAction: 'Commit the current stage with scene:script.commitProject and wait for its verified Renderer output before capturing. Draft preview is optional.',
        })
      }
    }
    const timeout = Math.min(body.timeout ?? 10000, 15000)
    const { captureId, promise } = svc.createCapture(timeout)
    if (projectId) noteScreenshotCaptureProject(captureId, projectId)
    broadcastToClients({ event: 'screenshot:request', payload: { captureId, projectId } })
    try {
      const captured = persistForAgent(await promise)
      if (!projectId) return captured
      const after = rendererSyncStatus(projectId)
      return {
        ...captured,
        representation: after.representation,
        ...(after.representation.occupancyOnly
          ? { nextAction: TERRAIN_MESH_REQUIRED_ACTION }
          : {}),
      }
    } catch {
      captureProjects.delete(captureId)
      return reply.code(504).send({ error: 'capture timeout (no renderer connected?)' })
    }
  })

  app.post('/api/v1/agent/screenshot/store', { bodyLimit: 20 * 1024 * 1024 }, async (req) => {
    const b = req.body as { captureId: string; dataUrl: string; width: number; height: number }
    const ok = svc.resolveCapture(b.captureId, { ...b, capturedAt: new Date().toISOString() })
    return { ok }
  })

  app.get('/api/v1/agent/screenshot/latest', async (_req, reply) => {
    const latest = svc.getLatest()
    return latest ? persistForAgent(latest) : reply.code(404).send({ error: 'no screenshot yet' })
  })
}
