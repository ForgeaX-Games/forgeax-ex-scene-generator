import type { FastifyInstance, FastifyRequest } from 'fastify'
import { existsSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
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

/**
 * Gate mutations behind exclusive write access. Soft `projects.open` is shared
 * (many agents may analyze the same project); this is the only place the write
 * lock is claimed. AI callers block up to `waitMs` in the FIFO queue rather
 * than burning LLM turns on poll-and-retry — humans fail fast.
 *
 * Merely *checking* here (the pre-migration behavior) can never succeed now
 * that `openProject` is a shared attach that takes no lock: every AI mutation
 * would 403 `mutation-denied-not-open`, and the tool seam's re-open-and-replay
 * recovery would replay into the same 403 forever.
 */
export async function ensureMutationAccess(
  req: FastifyRequest,
  projectId: string,
  opts?: { waitMs?: number; pollMs?: number },
): Promise<{ ok: true; projectId: string } | { ok: false; reason: string; code: string; projectId: string }> {
  const reg = await getProjectRegistry()
  const caller = extractCaller(req)
  const rawWait = opts?.waitMs ?? (caller.kind === 'ai' ? 600_000 : 0)
  const rawPoll = opts?.pollMs ?? 2_000
  const waitMs = Number.isFinite(rawWait) ? Math.max(0, Math.min(rawWait, 30 * 60_000)) : 0
  const pollMs = Number.isFinite(rawPoll) ? Math.max(50, Math.min(rawPoll, 30_000)) : 2_000
  const deadline = Date.now() + waitMs

  let claimed = reg.claimWriteAccess(projectId, caller)
  while (!claimed.ok && claimed.queued && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs))
    claimed = reg.claimWriteAccess(projectId, caller)
  }

  if (!claimed.ok) {
    const reason =
      claimed.queued && waitMs > 0
        ? `${claimed.reason} (blocked ${waitMs}ms without write lock — retry the mutation once)`
        : claimed.reason
    return { ok: false, reason, code: claimed.code, projectId }
  }

  // claimWriteAccess already acquired; renew + confirm.
  const result = reg.checkMutationAccess(projectId, caller)
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

async function resolveTemplate(rel: string): Promise<ImportGraphInput | null> {
  const ws = resolveWorkspaceRoot()
  const dir = resolve(ws, 'templates')
  const full = resolve(dir, basename(rel))
  if (!full.startsWith(resolve(dir)) || !existsSync(full)) return null
  try {
    const parsed = JSON.parse(readFileSync(full, 'utf-8')) as { format?: string; graph?: unknown }
    const graph = parsed.graph ?? parsed
    return { format: detectFormat(graph, parsed.format), graph } as ImportGraphInput
  } catch {
    // Corrupt/malformed template file — treat as "not found" rather than a 500.
    return null
  }
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
      // Announce the new project so sibling clients (the workbench navigation
      // pane, other tabs) refetch their list. Agents create via this route but
      // never `view`, so without this broadcast the left nav stayed stale.
      broadcastToClients({ event: 'runtime', payload: { kind: 'project:created', projectId: meta.id } })
      return reply.code(201).send(meta)
    } catch (e) {
      return reply.code(400).send({ reason: (e as Error).message })
    }
  })

  app.put<{ Params: ProjectIdParams }>('/api/v1/projects/:id', async (req, reply) => {
    const reg = await getProjectRegistry()
    const access = await ensureMutationAccess(req, req.params.id)
    if (!access.ok) return reply.code(403).send({ status: 'rejected', reason: access.reason, code: access.code, projectId: access.projectId })
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
      const access = await ensureMutationAccess(req, req.params.id)
      if (!access.ok) return reply.code(403).send({ status: 'rejected', reason: access.reason, code: access.code, projectId: access.projectId })
      const assetPolicy = req.query.assetPolicy === 'delete' ? 'delete' : 'detach'
      try {
        await reg.deleteProject(req.params.id, { assetPolicy })
        await rebindWsSubscriptions()
        broadcastToClients({ event: 'runtime', payload: { kind: 'project:deleted', projectId: req.params.id } })
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

  // Agent open — shared session attach for analysis, NOT the exclusive write
  // lock (that is claimed later by ensureMutationAccess). Several AI agents may
  // hold a shared open on the same project and read concurrently.
  //
  // Unlike wb-scene-generator, an AI open here ALSO follows the UI viewing
  // pointer. lowpoly's screenshot/GLB-export routes render through the single
  // global `?pane=viewer3d` viewer, and `resolveAgentTarget` (agent/routes.ts)
  // rejects any target that is not the viewing project. Without this, an agent
  // that opened a freshly-created project got a permanent 409 on every capture
  // and had no AI-facing way to switch viewing.
  app.post<{ Params: ProjectIdParams }>('/api/v1/projects/:id/open', async (req, reply) => {
    const reg = await getProjectRegistry()
    const caller = extractCaller(req)
    const open = reg.openProject(req.params.id, caller)
    if (!open.ok) return reply.code(409).send({ reason: open.reason, code: open.code })
    const isAgent = caller.kind === 'ai' && !!caller.agentId
    const rt = isAgent ? reg.viewProject(req.params.id) : reg.getRuntimeFor(req.params.id)
    await rebindWsSubscriptions()
    const snap = getPipeline(rt)
    if (isAgent) {
      broadcastViewing(req.params.id, rt.config.pipelineId, snap?.hash ?? '')
    }
    return {
      project: reg.getProject(req.params.id),
      pipeline: snap,
      workspace: reg.getWorkspace(),
      openMode: 'shared',
      writeLockedBy: reg.getProjectLock(req.params.id)?.agentId ?? null,
    }
  })

  // Explicit lease renewal — call between mutations during a long non-writing
  // stretch (reading/reasoning) so idle time alone never expires an otherwise
  // active agent's write lock out from under it.
  app.post<{ Params: ProjectIdParams }>('/api/v1/projects/:id/heartbeat', async (req, reply) => {
    const reg = await getProjectRegistry()
    const res = reg.renewLock(req.params.id, extractCaller(req))
    if (!res.ok) return reply.code(409).send({ reason: res.reason, code: res.code })
    return { ok: true, lock: reg.getProjectLock(req.params.id) }
  })

  // Current write wait-queue snapshot (FIFO, position 1 = next in line).
  // Side-effect free: unlike a mutation call, this never joins the queue.
  app.get<{ Params: ProjectIdParams }>('/api/v1/projects/:id/queue', async (req, reply) => {
    const reg = await getProjectRegistry()
    if (!reg.getProject(req.params.id)) {
      return reply.code(404).send({ reason: `project not found: ${req.params.id}` })
    }
    return { queue: reg.getProjectQueue(req.params.id) }
  })

  // Voluntarily leave a project's write wait queue. Idempotent.
  app.post<{ Params: ProjectIdParams }>('/api/v1/projects/:id/queue/leave', async (req, reply) => {
    const reg = await getProjectRegistry()
    const res = reg.leaveQueue(req.params.id, extractCaller(req))
    if (!res.ok) return reply.code(409).send({ reason: res.reason, code: res.code })
    return { ok: true, queue: reg.getProjectQueue(req.params.id) }
  })

  // Soft detach: ALWAYS clears this caller's shared session, and releases the
  // write lock only if this caller holds it. `releaseProjectLock` alone (the
  // old behavior) left the session behind, so an agent that closed one project
  // could never open another for the rest of the backend's lifetime.
  app.post<{ Params: ProjectIdParams }>('/api/v1/projects/:id/close', async (req, reply) => {
    const reg = await getProjectRegistry()
    const caller = extractCaller(req)
    const held = reg.getProjectLock(req.params.id)
    const heldByCaller =
      !!held &&
      caller.kind === 'ai' &&
      held.agentId === caller.agentId &&
      (held.sessionId ?? undefined) === (caller.sessionId ?? undefined)
    const res = reg.detachProject(req.params.id, caller)
    if (!res.ok) return reply.code(409).send({ reason: res.reason })
    await rebindWsSubscriptions()
    const handedTo = reg.getProjectLock(req.params.id)
    if (heldByCaller && handedTo && handedTo.agentId !== held?.agentId) {
      broadcastToClients({
        event: 'runtime',
        payload: {
          kind: 'project:executing',
          projectId: req.params.id,
          agentId: handedTo.agentId,
          ...(handedTo.sessionId ? { sessionId: handedTo.sessionId } : {}),
        },
      })
    } else if (heldByCaller && held && !handedTo) {
      broadcastToClients({
        event: 'runtime',
        payload: { kind: 'project:idle', projectId: req.params.id, agentId: held.agentId },
      })
    }
    return { ok: true, workspace: reg.getWorkspace() }
  })

  // Human/workbench-only emergency reset of a project's lock + wait queue +
  // shared sessions. Last-resort override for the (expected-never) case where
  // lease-expiry self-healing doesn't recover a stuck project.
  app.post<{ Params: ProjectIdParams }>('/api/v1/projects/:id/force-unlock', async (req, reply) => {
    const reg = await getProjectRegistry()
    const res = reg.forceUnlockProject(req.params.id, extractCaller(req))
    if (!res.ok) return reply.code(403).send({ reason: res.reason, code: res.code })
    await rebindWsSubscriptions()
    broadcastToClients({
      event: 'runtime',
      payload: { kind: 'project:idle', projectId: req.params.id, agentId: null },
    })
    return { ok: true, workspace: reg.getWorkspace() }
  })

  app.get('/api/v1/workspace/locks', async () => {
    const reg = await getProjectRegistry()
    return { locks: reg.listAllProjectLocks() }
  })

  // What THIS caller is attached to. `viewingProjectId` is a single global
  // pointer shared by every client, so a concurrent agent's open (or a human
  // switching views) silently redirects an omitted-`projectId` tool call to the
  // wrong project. The caller's own shared session is the real SSOT for "what
  // am I working on" — resolveProjectId prefers it over viewing.
  app.get('/api/v1/workspace/mine', async (req) => {
    const reg = await getProjectRegistry()
    const caller = extractCaller(req)
    const openProjectId = reg.getAgentOpenProjectId(caller)
    const writeLock = openProjectId ? reg.getProjectLock(openProjectId) : null
    return {
      openProjectId,
      holdsWriteLock:
        !!writeLock &&
        caller.kind === 'ai' &&
        writeLock.agentId === caller.agentId &&
        (writeLock.sessionId ?? undefined) === (caller.sessionId ?? undefined),
    }
  })

  app.get('/api/v1/workspace', async (req) => {
    const reg = await getProjectRegistry()
    const ws = reg.getWorkspace()
    // `agentProjectId` = this AI caller's own target (see /workspace/mine).
    // Prefer the shared session over the write lock: with the split open/claim
    // model an agent legitimately has an open project long before it holds any
    // lock, and would otherwise fall back to the global viewing pointer.
    const caller = extractCaller(req)
    if (caller.kind === 'ai' && caller.agentId) {
      const mine =
        reg.getAgentOpenProjectId(caller) ??
        reg.listLockedProjectIds().find((projectId) => reg.getProjectLock(projectId)?.agentId === caller.agentId)
      if (mine) return { ...ws, agentProjectId: mine }
    }
    return ws
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
