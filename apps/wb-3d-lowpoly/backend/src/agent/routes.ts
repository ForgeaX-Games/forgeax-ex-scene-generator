import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance } from 'fastify'
import { getScreenshotService } from '@forgeax/editor-host/backend'
import { getGlbService } from './glb.service.js'
import { broadcastToClients } from '../routes/ws.js'
import { getProjectDir, getProjectRegistry } from '../runtime.js'
import { normalizeGlbFilename } from '../editor-import.js'

// backend/src/agent/routes.ts → plugin repo root is three dirs up.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const PROJECT_ROOT = process.env.FORGEAX_PROJECT_ROOT ?? resolve(REPO_ROOT, '.forgeax-runtime')

/**
 * Resolve which project an agent screenshot / GLB export belongs to, and the
 * directory its artifact should be written under.
 *
 * Subtlety this guards: the single `?pane=viewer3d` viewer renders the workspace's
 * VIEWING project. So a capture/export is always a frame of whatever is being
 * viewed — never of some other "open" project. If the caller asks for a project
 * that isn't the viewing one, we reject with a clear instruction instead of
 * silently handing back the wrong project's frame (the old behavior also dumped
 * every artifact into the global PROJECT_ROOT, so per-project `assets.list`
 * never saw them). Output now lands in the resolved project's own directory.
 */
async function resolveAgentTarget(
  requestedProjectId: unknown,
): Promise<
  | { ok: true; projectId: string; dir: string }
  | { ok: false; code: number; error: string }
> {
  const reg = await getProjectRegistry()
  const viewingId = reg.getViewingProjectId()
  if (!viewingId) {
    return { ok: false, code: 409, error: 'no viewing project — open/view a project before capturing' }
  }
  const requested =
    typeof requestedProjectId === 'string' && requestedProjectId.trim() ? requestedProjectId : viewingId
  if (requested !== viewingId) {
    return {
      ok: false,
      code: 409,
      error: `project "${requested}" is not the viewing project ("${viewingId}"); the renderer only captures the viewing project — set "${requested}" as viewing first`,
    }
  }
  const dir = await getProjectDir(requested)
  if (!dir) return { ok: false, code: 404, error: `project not found: ${requested}` }
  return { ok: true, projectId: requested, dir }
}

function safeName(raw: unknown): string {
  return normalizeGlbFilename(raw).replace(/\.glb$/iu, '')
}

// Agent-facing screenshot view. We deliberately DROP the base64 `dataUrl`:
// handing it to an AI caller dumps hundreds of KB of base64 into the model's
// context as plain *text* (tokenized per-character, not as a vision tile) — one
// capture can blow the window past 100%. Instead we persist the PNG to disk and
// return its path; the agent opens it with the builtin `read_file` tool, which
// yields a proper image content-part and never re-inlines base64 into history.
type ScreenshotRecord = { captureId: string; dataUrl: string; width: number; height: number; capturedAt: string }
type AgentScreenshotView = Omit<ScreenshotRecord, 'dataUrl'> & { path: string; relPath: string }

function persistForAgent(rec: ScreenshotRecord, baseDir: string): AgentScreenshotView {
  const base64 = rec.dataUrl.includes(',') ? rec.dataUrl.slice(rec.dataUrl.indexOf(',') + 1) : rec.dataUrl
  const dir = join(baseDir, '.cache', 'screenshots')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${rec.captureId}.png`)
  writeFileSync(file, Buffer.from(base64, 'base64'))
  return {
    captureId: rec.captureId,
    width: rec.width,
    height: rec.height,
    capturedAt: rec.capturedAt,
    path: file,
    relPath: relative(baseDir, file),
  }
}

// WS-coordinated agent routes: screenshot capture + glb export both broadcast a
// request to live renderer clients (the ?pane=viewer3d viewer / headless renderer)
// and await their /store callback.
export async function registerScreenshotRoutes(app: FastifyInstance): Promise<void> {
  const svc = getScreenshotService()
  const glb = getGlbService()

  app.post('/api/v1/agent/screenshot/capture', { bodyLimit: 20 * 1024 * 1024 }, async (req, reply) => {
    const body = (req.body as { timeout?: number; projectId?: unknown }) ?? {}
    const target = await resolveAgentTarget(body.projectId)
    if (!target.ok) return reply.code(target.code).send({ error: target.error })
    // Default 10s (was 5s): a cold render of a heavy URDF in the headless
    // renderer (re-sync graph → render → encode 600KB+ PNG → POST) can exceed
    // 5s and surface as a misleading "no renderer connected" timeout.
    const timeout = Math.min(body.timeout ?? 10000, 20000)
    const { captureId, promise } = svc.createCapture(timeout)
    broadcastToClients({ event: 'screenshot:request', payload: { captureId } })
    try {
      return persistForAgent(await promise, target.dir)
    } catch (e) {
      // A renderer-reported failure (empty scene / encode error) rejects fast with
      // its own reason; only a genuine no-reply hits the timeout message.
      const reason = (e as Error).message
      const msg = reason && reason !== 'timeout'
        ? `capture failed: ${reason}`
        : 'capture timeout (no renderer connected?)'
      return reply.code(504).send({ error: msg })
    }
  })

  app.post('/api/v1/agent/screenshot/store', { bodyLimit: 20 * 1024 * 1024 }, async (req) => {
    const b = req.body as { captureId: string; dataUrl?: string; width?: number; height?: number; error?: string }
    // The renderer POSTs an `error` when it can't produce a frame, so the awaiting
    // /capture fails fast instead of waiting for the timeout.
    if (b.error) {
      const ok = svc.rejectCapture(b.captureId, b.error)
      return { ok: false, rejected: ok }
    }
    if (typeof b.dataUrl !== 'string') {
      svc.rejectCapture(b.captureId, 'missing dataUrl')
      return { ok: false }
    }
    const ok = svc.resolveCapture(b.captureId, {
      captureId: b.captureId,
      dataUrl: b.dataUrl,
      width: b.width ?? 0,
      height: b.height ?? 0,
      capturedAt: new Date().toISOString(),
    })
    return { ok }
  })

  app.get('/api/v1/agent/screenshot/latest', async (req, reply) => {
    const latest = svc.getLatest()
    if (!latest) return reply.code(404).send({ error: 'no screenshot yet' })
    const target = await resolveAgentTarget((req.query as { projectId?: unknown })?.projectId)
    if (!target.ok) return reply.code(target.code).send({ error: target.error })
    return persistForAgent(latest, target.dir)
  })

  // ── GLB export ──────────────────────────────────────────────────────────
  // /export broadcasts `glb:request`; the live viewer bakes the current URDF
  // scene to binary glTF (with joint-preview animation) and POSTs it to /store,
  // which writes it under <projectRoot>/assets/3d/<name>.glb and resolves.
  app.post('/api/v1/agent/glb/export', { bodyLimit: 1 * 1024 * 1024 }, async (req, reply) => {
    const body = (req.body as { name?: string; animated?: boolean; mode?: string; timeout?: number; projectId?: unknown }) ?? {}
    const target = await resolveAgentTarget(body.projectId)
    if (!target.ok) return reply.code(target.code).send({ error: target.error })
    // glb bake (render + GLTFExporter parse + base64 + POST) is heavier than a
    // screenshot, so default 30s / cap 60s. (timeout is MILLISECONDS.)
    const timeout = Math.min(body.timeout ?? 30000, 60000)
    const name = safeName(body.name)
    // `mode` selects the export flavor (animated/static/skinned/character). For
    // backward compat, `animated` is honored when `mode` is absent: animated!==false
    // → 'animated', else 'static'. See useGlbExport.ts for the renderer branches.
    const MODES = ['animated', 'static', 'skinned', 'character']
    const mode = typeof body.mode === 'string' && MODES.includes(body.mode)
      ? body.mode
      : body.animated === false ? 'static' : 'animated'
    // Capture the target now so the renderer's /store callback (which has no
    // project context) writes the .glb under the right project directory.
    const { requestId, promise } = glb.createExport(timeout, { projectId: target.projectId, dir: target.dir })
    broadcastToClients({ event: 'glb:request', payload: { requestId, name, animated: body.animated !== false, mode } })
    try {
      return await promise
    } catch (e) {
      return reply
        .code(504)
        .send({ error: `glb export failed/timeout after ${timeout}ms: ${(e as Error).message} (renderer connected? graph executed so g_to_urdf has output?)` })
    }
  })

  app.post('/api/v1/agent/glb/store', { bodyLimit: 128 * 1024 * 1024 }, async (req, reply) => {
    const b = req.body as { requestId: string; name?: string; dataUrl?: string; bytes?: number; error?: string }
    if (!b?.requestId) return reply.code(400).send({ error: 'missing requestId' })
    if (b.error) {
      glb.rejectExport(b.requestId, b.error)
      return { ok: false }
    }
    if (typeof b.dataUrl !== 'string') {
      glb.rejectExport(b.requestId, 'missing dataUrl')
      return reply.code(400).send({ error: 'missing dataUrl' })
    }
    const base64 = b.dataUrl.includes(',') ? b.dataUrl.slice(b.dataUrl.indexOf(',') + 1) : b.dataUrl
    const buf = Buffer.from(base64, 'base64')
    // Write under the project directory captured at export time (falls back to
    // the global runtime root only if the pending export is gone — e.g. timed out).
    const baseDir = glb.getTarget(b.requestId)?.dir ?? PROJECT_ROOT
    const outDir = join(baseDir, 'assets', '3d')
    mkdirSync(outDir, { recursive: true })
    const file = join(outDir, `${safeName(b.name)}.glb`)
    writeFileSync(file, buf)
    const ok = glb.resolveExport(b.requestId, {
      requestId: b.requestId,
      path: file,
      relPath: relative(baseDir, file),
      bytes: buf.length,
    })
    return { ok }
  })
}
