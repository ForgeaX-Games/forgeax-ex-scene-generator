// Thin Fastify routes over the kernel ProjectRegistry — multi-project
// management with viewing (UI) vs executing (agent lock) separation.

import type { FastifyInstance, FastifyRequest } from 'fastify'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPipeline } from '@forgeax/node-runtime'
import type { CallerIdentity, ImportGraphFormat, ImportGraphInput } from '@forgeax/node-runtime'
import { getProjectRegistry, resolveWorkspaceRoot } from '../runtime.js'
import { broadcastToClients, rebindWsSubscriptions } from './ws.js'

interface ProjectIdParams {
  id: string
}

const CALLER_KINDS: ReadonlyArray<CallerIdentity['kind']> = ['ai', 'user', 'workbench', 'cli', 'skill']

export function extractCaller(req: FastifyRequest): CallerIdentity {
  const rawKind = req.headers['x-forgeax-caller-kind']
  const kind = (CALLER_KINDS as readonly string[]).includes(rawKind as string)
    ? (rawKind as CallerIdentity['kind'])
    : 'user'
  const agentId = req.headers['x-forgeax-caller-agent-id']
  const sessionId = req.headers['x-forgeax-caller-session-id']
  return {
    kind,
    ...(typeof agentId === 'string' ? { agentId } : {}),
    ...(typeof sessionId === 'string' ? { sessionId } : {}),
  }
}

export async function ensureMutationAccess(
  req: FastifyRequest,
  projectId: string,
): Promise<{ ok: true; projectId: string } | { ok: false; reason: string; code: string; projectId: string }> {
  const reg = await getProjectRegistry()
  const result = reg.checkMutationAccess(projectId, extractCaller(req))
  if (result.ok) return { ok: true, projectId }
  return { ok: false, reason: result.reason, code: result.code, projectId }
}

function detectFormat(graph: unknown, declared?: string): ImportGraphFormat {
  if (declared === 'kernel-graph-v1' || declared === 'legacy-pipeline-v1') return declared
  const g = graph as { nodes?: unknown }
  const nodes = Array.isArray(g?.nodes)
    ? (g.nodes as Array<Record<string, unknown>>)
    : g?.nodes && typeof g.nodes === 'object'
      ? Object.values(g.nodes as Record<string, Record<string, unknown>>)
      : []
  const first = nodes[0]
  if (first && 'batteryId' in first && !('opId' in first)) return 'legacy-pipeline-v1'
  return 'kernel-graph-v1'
}

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, '..', '..', '..')
const BUILTIN_TEMPLATES_DIR = resolve(appRoot, 'templates')

async function resolveTemplate(rel: string): Promise<ImportGraphInput | null> {
  const ws = resolveWorkspaceRoot()
  const safe = basename(rel)
  const userDir = resolve(ws, 'templates')
  const userFull = resolve(userDir, safe)
  let full: string | null = null
  if (userFull.startsWith(resolve(userDir)) && existsSync(userFull)) {
    full = userFull
  } else {
    const builtinFull = resolve(BUILTIN_TEMPLATES_DIR, safe)
    if (builtinFull.startsWith(resolve(BUILTIN_TEMPLATES_DIR)) && existsSync(builtinFull)) full = builtinFull
  }
  if (!full) return null
  const parsed = JSON.parse(readFileSync(full, 'utf-8')) as { format?: string; graph?: unknown }
  const graph = parsed.graph ?? parsed
  return { format: detectFormat(graph, parsed.format), graph } as ImportGraphInput
}

function broadcastViewing(projectId: string, pipelineId: string, newHash: string): void {
  const payload = { kind: 'project:viewing' as const, projectId, pipelineId, newHash }
  broadcastToClients({ event: 'runtime', payload })
  broadcastToClients({ event: 'runtime', payload: { kind: 'project:activated', projectId, pipelineId, newHash } })
}

export async function registerProjectRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/projects', async () => {
    const reg = await getProjectRegistry()
    return reg.listProjects()
  })

  app.get<{ Params: ProjectIdParams }>('/api/v1/projects/:id', async (req, reply) => {
    const reg = await getProjectRegistry()
    const record = reg.getProject(req.params.id)
    if (!record) return reply.code(404).send({ reason: `project not found: ${req.params.id}` })
    return record
  })

  app.get<{ Params: ProjectIdParams }>('/api/v1/projects/:id/lock', async (req, reply) => {
    const reg = await getProjectRegistry()
    if (!reg.getProject(req.params.id)) {
      return reply.code(404).send({ reason: `project not found: ${req.params.id}` })
    }
    return { lock: reg.getProjectLock(req.params.id) }
  })

  app.post('/api/v1/projects', async (req, reply) => {
    const reg = await getProjectRegistry()
    const body = (req.body ?? {}) as {
      type?: string
      name?: string
      description?: string
      fromTemplate?: string
    }
    if (!body.name || !body.name.trim()) {
      return reply.code(400).send({ reason: 'project name is required' })
    }
    let fromTemplate: ImportGraphInput | undefined
    if (body.fromTemplate) {
      const resolved = await resolveTemplate(body.fromTemplate)
      if (!resolved) return reply.code(404).send({ reason: `template not found: ${body.fromTemplate}` })
      fromTemplate = resolved
    }
    try {
      const meta = await reg.createProject({
        name: body.name,
        ...(body.type ? { type: body.type } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(fromTemplate ? { fromTemplate } : {}),
      })
      return reply.code(201).send(meta)
    } catch (e) {
      return reply.code(400).send({ reason: (e as Error).message })
    }
  })

  app.put<{ Params: ProjectIdParams }>('/api/v1/projects/:id', async (req, reply) => {
    const reg = await getProjectRegistry()
    const patch = (req.body ?? {}) as { name?: string; description?: string; thumbnail?: string; type?: string }
    try {
      return reg.updateProject(req.params.id, patch)
    } catch (e) {
      return reply.code(404).send({ reason: (e as Error).message })
    }
  })

  app.delete<{ Params: ProjectIdParams; Querystring: { assetPolicy?: string } }>(
    '/api/v1/projects/:id',
    async (req, reply) => {
      const reg = await getProjectRegistry()
      const assetPolicy = req.query.assetPolicy === 'delete' ? 'delete' : 'detach'
      try {
        await reg.deleteProject(req.params.id, { assetPolicy })
        await rebindWsSubscriptions()
        return { ok: true, assetPolicy, workspace: reg.getWorkspace() }
      } catch (e) {
        return reply.code(404).send({ reason: (e as Error).message })
      }
    },
  )

  app.post<{ Params: ProjectIdParams }>('/api/v1/projects/:id/view', async (req, reply) => {
    const reg = await getProjectRegistry()
    try {
      const rt = reg.viewProject(req.params.id)
      await rebindWsSubscriptions()
      const snap = getPipeline(rt)
      broadcastViewing(req.params.id, rt.config.pipelineId, snap?.hash ?? '')
      return { project: reg.getProject(req.params.id), pipeline: snap, workspace: reg.getWorkspace() }
    } catch (e) {
      return reply.code(404).send({ reason: (e as Error).message })
    }
  })

  app.post<{ Params: ProjectIdParams }>('/api/v1/projects/:id/open', async (req, reply) => {
    const reg = await getProjectRegistry()
    const open = reg.openProject(req.params.id, extractCaller(req))
    if (!open.ok) return reply.code(409).send({ reason: open.reason, code: open.code })
    const rt = reg.getRuntimeFor(req.params.id)
    await rebindWsSubscriptions()
    const caller = extractCaller(req)
    if (caller.kind === 'ai' && caller.agentId) {
      broadcastToClients({
        event: 'runtime',
        payload: {
          kind: 'project:executing',
          projectId: req.params.id,
          pipelineId: rt.config.pipelineId,
          agentId: caller.agentId,
        },
      })
    }
    const snap = getPipeline(rt)
    return { project: reg.getProject(req.params.id), pipeline: snap, workspace: reg.getWorkspace() }
  })

  app.post<{ Params: ProjectIdParams }>('/api/v1/projects/:id/close', async (req, reply) => {
    const reg = await getProjectRegistry()
    const res = reg.releaseProjectLock(req.params.id, extractCaller(req))
    if (!res.ok) return reply.code(409).send({ reason: res.reason })
    await rebindWsSubscriptions()
    return { ok: true, workspace: reg.getWorkspace() }
  })

  app.get('/api/v1/workspace', async () => {
    const reg = await getProjectRegistry()
    return reg.getWorkspace()
  })

  app.put('/api/v1/workspace', async (req) => {
    const reg = await getProjectRegistry()
    const patch = (req.body ?? {}) as {
      viewingProjectId?: string
      activeProjectId?: string
      recentProjectIds?: string[]
    }
    const ws = reg.setWorkspace(patch)
    if (patch.viewingProjectId || patch.activeProjectId) await rebindWsSubscriptions()
    return ws
  })
}
