// Thin Fastify routes over the kernel ProjectRegistry — multi-project
// management with viewing (UI) vs executing (agent lock) separation.

import type { FastifyInstance, FastifyRequest } from 'fastify'
import { existsSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { getPipeline } from '@forgeax/node-runtime'
import type { CallerIdentity, ImportGraphFormat, ImportGraphInput } from '@forgeax/node-runtime'
import { getProjectRegistry, getProjectDir, resolveActiveGameSlug, resolveWorkspaceRoot } from '../runtime.js'
import { reloadGameTexturesBinding } from '../library/gameSandboxStore.js'
import { countLivePrivateAssets } from '../library/privateStore.js'
import { broadcastToClients, rebindWsSubscriptions } from './ws.js'
import { writeSceneModule, canonicalEmptySceneSource } from '../scene-script/persist/store.js'
import { releaseSceneRun } from '../scene-script/run/runProject.js'
import { clearSceneProjection } from '../scene-script/display/projectionRevision.js'

interface ProjectIdParams {
  id: string
}

const CALLER_KINDS: ReadonlyArray<CallerIdentity['kind']> = ['ai', 'user', 'extension', 'cli', 'skill']

export function extractCaller(req: FastifyRequest): CallerIdentity {
  const rawKind = req.headers['x-forgeax-caller-kind']
  const kind = (CALLER_KINDS as readonly string[]).includes(rawKind as string)
    ? (rawKind as CallerIdentity['kind'])
    : 'user'
  const agentId = req.headers['x-forgeax-caller-agent-id']
  const sessionId = req.headers['x-forgeax-caller-session-id']
  const extensionId = req.headers['x-forgeax-caller-extension-id']
  return {
    kind,
    ...(typeof agentId === 'string' ? { agentId } : {}),
    ...(typeof sessionId === 'string' ? { sessionId } : {}),
    ...(typeof extensionId === 'string' ? { extensionId } : {}),
  }
}

/**
 * Gate mutations behind exclusive write access. Soft `projects.open` is shared
 * (many agents may analyze); this is where we claim/wait for the write lock.
 * AI callers block up to `waitMs` (default 10min) so they do not burn LLM turns
 * polling — humans fail fast when another agent holds the write lock.
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
  const parsed = JSON.parse(readFileSync(full, 'utf-8')) as { format?: string; graph?: unknown }
  const graph = parsed.graph ?? parsed
  return { format: detectFormat(graph, parsed.format), graph } as ImportGraphInput
}

function broadcastViewing(projectId: string, pipelineId: string, newHash: string): void {
  const payload = { kind: 'project:viewing' as const, projectId, pipelineId, newHash }
  broadcastToClients({ event: 'runtime', payload })
  // Legacy alias consumed by older frontends until fully migrated.
  broadcastToClients({ event: 'runtime', payload: { kind: 'project:activated', projectId, pipelineId, newHash } })
}

export async function registerProjectRoutes(app: FastifyInstance): Promise<void> {
  // `?gameSlug=<slug>` scopes the list to that game's projects only; omit (or
  // pass `?all=1`) to get every project in the workspace ("show all" toggle).
  app.get<{ Querystring: { gameSlug?: string; all?: string } }>('/api/v1/projects', async (req) => {
    const reg = await getProjectRegistry()
    const showAll = req.query.all === '1' || req.query.all === 'true'
    const gameSlug = showAll ? undefined : req.query.gameSlug
    return reg.listProjects(gameSlug ? { gameSlug } : undefined)
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

  app.get<{ Params: ProjectIdParams }>('/api/v1/projects/:id/assets/summary', async (req, reply) => {
    const reg = await getProjectRegistry()
    if (!reg.getProject(req.params.id)) {
      return reply.code(404).send({ reason: `project not found: ${req.params.id}` })
    }
    const dir = await getProjectDir(req.params.id)
    const producedCount = dir ? countLivePrivateAssets(dir) : 0
    return { producedCount }
  })

  app.post('/api/v1/projects', async (req, reply) => {
    const reg = await getProjectRegistry()
    const body = (req.body ?? {}) as {
      type?: string
      name?: string
      description?: string
      fromTemplate?: string
      gameSlug?: string
    }
    const activeGameSlug = resolveActiveGameSlug()
    const projectName = body.name?.trim() || `${activeGameSlug ?? 'Untitled'} Scene`
    if (body.fromTemplate) {
      return reply.code(410).send({
        status: 'rejected',
        code: 'runtime-template-project-creation-removed',
        reason: 'New projects must start from a canonical Scene Project, not a Runtime Graph template.',
      })
    }
    if (body.gameSlug !== undefined && body.gameSlug !== activeGameSlug) {
      return reply.code(400).send({
        reason: 'gameSlug must match the Studio active game; switch the active game before creating a project',
      })
    }
    let fromTemplate: ImportGraphInput | undefined
    if (body.fromTemplate) {
      const resolved = await resolveTemplate(body.fromTemplate)
      if (!resolved) return reply.code(404).send({ reason: `template not found: ${body.fromTemplate}` })
      fromTemplate = resolved
    }
    try {
      const meta = await reg.createProject({
        name: projectName,
        ...(body.type ? { type: body.type } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(activeGameSlug ? { gameSlug: activeGameSlug } : {}),
        ...(fromTemplate ? { fromTemplate } : {}),
      })
      const projectDir = await getProjectDir(meta.id)
      if (!projectDir) throw new Error(`created project directory not found: ${meta.id}`)
      await writeSceneModule(
        projectDir,
        'main.scene.ts',
        canonicalEmptySceneSource(meta.id),
        [],
      )
      broadcastToClients({
        event: 'runtime',
        payload: { kind: 'project:list-changed', reason: 'created' },
      })
      return reply.code(201).send(meta)
    } catch (e) {
      return reply.code(400).send({ reason: (e as Error).message })
    }
  })

  app.put<{ Params: ProjectIdParams }>('/api/v1/projects/:id', async (req, reply) => {
    const reg = await getProjectRegistry()
    const patch = (req.body ?? {}) as { name?: string; description?: string; thumbnail?: string; type?: string; gameSlug?: string }
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
        broadcastToClients({
          event: 'runtime',
          payload: { kind: 'project:list-changed', reason: 'deleted' },
        })
        return { ok: true, assetPolicy, workspace: reg.getWorkspace() }
      } catch (e) {
        return reply.code(404).send({ reason: (e as Error).message })
      }
    },
  )

  // UI viewing — sets viewingProjectId, does NOT acquire agent locks.
  app.post<{ Params: ProjectIdParams }>('/api/v1/projects/:id/view', async (req, reply) => {
    const reg = await getProjectRegistry()
    const __t0 = Date.now()
    try {
      const prevViewing = reg.getViewingProjectId()
      const rt = reg.viewProject(req.params.id)
      const __t1 = Date.now()
      await rebindWsSubscriptions()
      const __t2 = Date.now()
      const snap = getPipeline(rt)
      const __t3 = Date.now()
      // Re-viewing the same project must not broadcast — that clears preview caches.
      if (prevViewing !== req.params.id) {
        broadcastViewing(req.params.id, rt.config.pipelineId, snap?.hash ?? '')
      }
      // Defer game-textures rebind so browse switches return before asset-library I/O.
      void reloadGameTexturesBinding()
        .then(() => {
          broadcastToClients({ event: 'library:changed', payload: { source: 'project-view' } })
        })
        .catch(() => undefined)
      const result = { project: reg.getProject(req.params.id), pipeline: snap, workspace: reg.getWorkspace() }
      const __t4 = Date.now()
      const mem = process.memoryUsage()
      process.stderr.write(
        `[switch-trace] POST /view id=${req.params.id} viewProject=${__t1 - __t0}ms rebindWs=${__t2 - __t1}ms ` +
          `getPipeline=${__t3 - __t2}ms getProject/Workspace=${__t4 - __t3}ms TOTAL=${__t4 - __t0}ms ` +
          `rss=${(mem.rss / 1024 / 1024).toFixed(1)}MB heapUsed=${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB\n`,
      )
      return result
    } catch (e) {
      return reply.code(404).send({ reason: (e as Error).message })
    }
  })

  // Agent open — shared session attach for analysis (NOT exclusive write lock).
  // Multiple AI agents may open the same project and read concurrently.
  // Write exclusivity is claimed later by mutation routes via ensureMutationAccess.
  app.post<{ Params: ProjectIdParams }>('/api/v1/projects/:id/open', async (req, reply) => {
    const reg = await getProjectRegistry()
    const caller = extractCaller(req)
    const open = reg.openProject(req.params.id, caller)
    if (!open.ok) {
      return reply.code(409).send({ reason: open.reason, code: open.code })
    }
    const rt = reg.getRuntimeFor(req.params.id)
    await rebindWsSubscriptions()
    // Soft open is not "executing" — only write-lock holders are.
    const snap = getPipeline(rt)
    return {
      project: reg.getProject(req.params.id),
      pipeline: snap,
      workspace: reg.getWorkspace(),
      openMode: 'shared',
      writeLockedBy: reg.getProjectLock(req.params.id)?.agentId ?? null,
    }
  })

  // Explicit lease renewal — call between mutations during a long
  // non-writing stretch (reading/reasoning) so idle time alone never expires
  // an otherwise-active agent's lock out from under it.
  app.post<{ Params: ProjectIdParams }>('/api/v1/projects/:id/heartbeat', async (req, reply) => {
    const reg = await getProjectRegistry()
    const res = reg.renewLock(req.params.id, extractCaller(req))
    if (!res.ok) return reply.code(409).send({ reason: res.reason, code: res.code })
    return { ok: true, lock: reg.getProjectLock(req.params.id) }
  })

  // Current wait-queue snapshot for a project (FIFO, position 1 = next in line).
  app.get<{ Params: ProjectIdParams }>('/api/v1/projects/:id/queue', async (req, reply) => {
    const reg = await getProjectRegistry()
    if (!reg.getProject(req.params.id)) {
      return reply.code(404).send({ reason: `project not found: ${req.params.id}` })
    }
    return { queue: reg.getProjectQueue(req.params.id) }
  })

  // Voluntarily leave a project's wait queue (e.g. the agent switched to a
  // different project while waiting). Idempotent; a no-op if not queued.
  app.post<{ Params: ProjectIdParams }>('/api/v1/projects/:id/queue/leave', async (req, reply) => {
    const reg = await getProjectRegistry()
    const res = reg.leaveQueue(req.params.id, extractCaller(req))
    if (!res.ok) return reply.code(409).send({ reason: res.reason, code: res.code })
    return { ok: true, queue: reg.getProjectQueue(req.params.id) }
  })

  app.post<{ Params: ProjectIdParams }>('/api/v1/projects/:id/close', async (req, reply) => {
    const reg = await getProjectRegistry()
    const caller = extractCaller(req)
    const held = reg.getProjectLock(req.params.id)
    const heldByCaller =
      !!held &&
      caller.kind === 'ai' &&
      held.agentId === caller.agentId &&
      (held.sessionId ?? undefined) === (caller.sessionId ?? undefined)
    // Soft detach: always clears this caller's session; releases write lock
    // only if this caller holds it (other agents may keep writing).
    const res = reg.detachProject(req.params.id, caller)
    if (!res.ok) return reply.code(409).send({ reason: res.reason })
    await rebindWsSubscriptions()
    if(reg.releaseIdleRuntime(req.params.id)) {
      releaseSceneRun(req.params.id)
      clearSceneProjection(req.params.id)
    }
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

  // Soft-open session for the calling AI agent (projectId they attached to).
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

  // Human/authoring-only emergency reset: clears a project's lock + wait
  // queue outright. Last-resort manual override for the (expected-never)
  // case where automatic lease-expiry self-healing somehow doesn't recover a
  // stuck project — never callable by an AI caller.
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
