// ProjectRegistry — multi-project CRUD + activate/open cascade.
//
// Covers: create→list→activate→delete lifecycle; activate swaps the active
// graph so subsequent applyBatch / queries hit the right project's isolated
// storage; per-project history isolation; fromTemplate seeds via the kernel
// importPipelineGraph; and default-project backfill that adopts an existing
// implicit `<root>/state/graph.json` in place (current work survives).

import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  applyBatch,
  createRuntime,
  getHistory,
  getPipeline,
  ProjectRegistry,
} from '../layer2/index.js'
import type { ProjectRuntimeFactory } from '../layer2/index.js'
import { OpRegistry } from '../layer1/op-registry.js'
import type { OpSpec } from '../layer1/types/op-spec.js'

let root: string

beforeEach(() => {
  root = join(tmpdir(), `forgeax-projects-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(root, { recursive: true })
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function op(id: string): OpSpec {
  return {
    id,
    name: id,
    inputs: [{ name: 'in', type: 'any' }],
    outputs: [{ name: 'out', type: 'any' }],
    params: [],
    execute: () => null,
  }
}

/** A shared OpRegistry + a factory that builds isolated per-project runtimes. */
function makeFactory(opIds: string[] = ['demo.a', 'demo.b']): {
  registry: OpRegistry
  factory: ProjectRuntimeFactory
} {
  const registry = new OpRegistry()
  for (const id of opIds) registry.register(op(id))
  const factory: ProjectRuntimeFactory = (req) =>
    createRuntime({
      projectRoot: root,
      pipelineId: req.pipelineId,
      pluginId: 'plugin.test',
      registry,
      layout: {
        graphFile: req.graphFile,
        historyFile: req.historyFile,
        outputsDir: req.outputsDir,
      },
    })
  return { registry, factory }
}

function makeRegistry(
  opIds?: string[],
  extra?: Partial<{ lockLeaseMs: number; queueEntryIdleMs: number; sessionIdleMs: number }>,
): ProjectRegistry {
  const { factory } = makeFactory(opIds)
  return new ProjectRegistry({
    workspaceRoot: root,
    createRuntime: factory,
    defaultType: 'scene',
    defaultProjectName: 'Default Scene',
    defaultProjectId: 'main',
    ...extra,
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('ProjectRegistry — backfill', () => {
  it('disposes every materialized runtime when the workspace registry is released', async () => {
    const { factory } = makeFactory()
    const disposeSpies: Array<ReturnType<typeof vi.spyOn>> = []
    const reg = new ProjectRegistry({
      workspaceRoot: root,
      createRuntime: (req) => {
        const runtime = factory(req)
        disposeSpies.push(vi.spyOn(runtime, 'dispose'))
        return runtime
      },
      defaultType: 'scene',
      defaultProjectName: 'Default Scene',
      defaultProjectId: 'main',
    })
    reg.init()
    await reg.createProject({ name: 'Second' })

    reg.dispose()

    expect(disposeSpies).toHaveLength(2)
    expect(disposeSpies.every((spy) => spy.mock.calls.length === 1)).toBe(true)
  })

  it('creates a default project on first init', () => {
    const reg = makeRegistry()
    reg.init()
    const list = reg.listProjects()
    expect(list).toHaveLength(1)
    expect(list[0]!.id).toBe('main')
    expect(list[0]!.type).toBe('scene')
    expect(reg.getWorkspace().viewingProjectId).toBe('main')
    expect(reg.getWorkspace().recentProjectIds).toEqual(['main'])
  })

  it('adopts an existing implicit <root>/state/graph.json in place (work survives)', async () => {
    // Seed the legacy implicit pipeline directly at <root>/state/graph.json.
    const { registry } = makeFactory()
    const legacy = createRuntime({
      projectRoot: root,
      pipelineId: 'main',
      pluginId: 'plugin.test',
      registry,
    })
    await applyBatch(legacy, [
      { type: 'createNode', nodeId: 'legacy1', opId: 'demo.a', position: { x: 1, y: 2 }, params: {} },
    ])
    expect(existsSync(join(root, 'state', 'graph.json'))).toBe(true)

    // A fresh registry must adopt that graph as the default project.
    const reg = makeRegistry()
    reg.init()
    expect(reg.listProjects()).toHaveLength(1)
    const snap = getPipeline(reg.getViewingRuntime())!
    expect(snap.nodes.legacy1).toBeDefined()
    expect(snap.nodes.legacy1!.opId).toBe('demo.a')
  })
})

describe('ProjectRegistry — lifecycle + activate swap', () => {
  it('create → list → activate → delete, with isolated graphs per project', async () => {
    const reg = makeRegistry()
    reg.init()

    const a = await reg.createProject({ type: 'scene', name: 'Project A' })
    const b = await reg.createProject({ type: 'scene', name: 'Project B' })
    expect(reg.listProjects().map((p) => p.id).sort()).toEqual(['main', a.id, b.id].sort())

    // Put a distinct graph into each project's storage via the active runtime.
    reg.viewProject(a.id)
    await applyBatch(reg.getViewingRuntime(), [
      { type: 'createNode', nodeId: 'aNode', opId: 'demo.a', position: { x: 0, y: 0 }, params: {} },
    ])

    reg.viewProject(b.id)
    await applyBatch(reg.getViewingRuntime(), [
      { type: 'createNode', nodeId: 'bNode', opId: 'demo.b', position: { x: 5, y: 5 }, params: {} },
    ])

    // Activate A: the active graph must reflect A only.
    reg.viewProject(a.id)
    let snap = getPipeline(reg.getViewingRuntime())!
    expect(Object.keys(snap.nodes)).toEqual(['aNode'])
    expect(reg.getWorkspace().viewingProjectId).toBe(a.id)

    // Activate B: the active graph must reflect B only.
    reg.viewProject(b.id)
    snap = getPipeline(reg.getViewingRuntime())!
    expect(Object.keys(snap.nodes)).toEqual(['bNode'])

    // A subsequent applyBatch lands in the active (B) project's storage.
    await applyBatch(reg.getViewingRuntime(), [
      { type: 'createNode', nodeId: 'bNode2', opId: 'demo.a', position: { x: 9, y: 9 }, params: {} },
    ])
    expect(Object.keys(getPipeline(reg.getRuntimeFor(b.id))!.nodes).sort()).toEqual(['bNode', 'bNode2'])
    expect(Object.keys(getPipeline(reg.getRuntimeFor(a.id))!.nodes)).toEqual(['aNode'])

    // Delete B (the active one) → falls back to another project, never empty.
    await reg.deleteProject(b.id)
    expect(reg.listProjects().some((p) => p.id === b.id)).toBe(false)
    expect(reg.getWorkspace().viewingProjectId).not.toBe(b.id)
    expect(reg.getWorkspace().viewingProjectId).toBeTruthy()
  })

  it('isolates per-project history (history.jsonl is per project)', async () => {
    const reg = makeRegistry()
    reg.init()
    const a = await reg.createProject({ name: 'A' })
    const b = await reg.createProject({ name: 'B' })

    reg.viewProject(a.id)
    await applyBatch(reg.getViewingRuntime(), [
      { type: 'createNode', nodeId: 'a1', opId: 'demo.a', position: { x: 0, y: 0 }, params: {} },
    ], { actor: 'ai:a', label: 'A op' })

    reg.viewProject(b.id)
    await applyBatch(reg.getViewingRuntime(), [
      { type: 'createNode', nodeId: 'b1', opId: 'demo.a', position: { x: 0, y: 0 }, params: {} },
    ], { actor: 'ai:b', label: 'B op' })

    const histA = getHistory(reg.getRuntimeFor(a.id))
    const histB = getHistory(reg.getRuntimeFor(b.id))
    expect(histA).toHaveLength(1)
    expect(histB).toHaveLength(1)
    expect(histA.at(-1)!.label).toBe('A op')
    expect(histB.at(-1)!.label).toBe('B op')
  })

  it('seeds a new project graph from a template via importPipelineGraph', async () => {
    const reg = makeRegistry()
    reg.init()
    const p = await reg.createProject({
      name: 'From Template',
      fromTemplate: {
        format: 'kernel-graph-v1',
        graph: {
          nodes: [
            { id: 't1', opId: 'demo.a', position: { x: 0, y: 0 }, params: { seeded: true } },
            { id: 't2', opId: 'demo.b', position: { x: 1, y: 1 }, params: {} },
          ],
          edges: [{ id: 'e1', source: { nodeId: 't1', port: 'out' }, target: { nodeId: 't2', port: 'in' } }],
        },
      },
    })
    const snap = getPipeline(reg.getRuntimeFor(p.id))!
    expect(Object.keys(snap.nodes).sort()).toEqual(['t1', 't2'])
    expect(snap.nodes.t1!.params).toEqual({ seeded: true })
    expect(Object.keys(snap.edges)).toEqual(['e1'])
    // The seed is recorded in the new project's own history.
    expect(getHistory(reg.getRuntimeFor(p.id)).length).toBeGreaterThan(0)
  })

  it('bootstraps an empty (but readable) graph for a non-template project', async () => {
    const reg = makeRegistry()
    reg.init()
    const p = await reg.createProject({ name: 'Empty' })
    const snap = getPipeline(reg.getRuntimeFor(p.id))!
    expect(snap.id).toBe(p.id)
    expect(snap.nodes).toEqual({})
    expect(snap.edges).toEqual({})
  })

  it('persists index + workspace across registry instances', async () => {
    const reg1 = makeRegistry()
    reg1.init()
    const p = await reg1.createProject({ name: 'Persisted' })
    reg1.viewProject(p.id)

    const reg2 = makeRegistry()
    reg2.init()
    expect(reg2.listProjects().some((x) => x.id === p.id)).toBe(true)
    expect(reg2.getWorkspace().viewingProjectId).toBe(p.id)
  })
})

describe('ProjectRegistry — exclusive per-agent lock', () => {
  const ai = (agentId: string) => ({ kind: 'ai' as const, agentId })

  it('humans (kind!=ai) always bypass the lock', async () => {
    const reg = makeRegistry()
    reg.init()
    const p = await reg.createProject({ name: 'P' })
    expect(reg.acquireProjectLock(p.id, { kind: 'user' })).toEqual({ ok: true })
    // No lock recorded for a human.
    expect(reg.getProjectLock(p.id)).toBeNull()
    expect(reg.checkMutationAccess(p.id, { kind: 'user' })).toEqual({ ok: true })
  })

  it('a second agent cannot open a project held by another', async () => {
    const reg = makeRegistry()
    reg.init()
    const p = await reg.createProject({ name: 'P' })
    expect(reg.acquireProjectLock(p.id, ai('A'))).toEqual({ ok: true })
    expect(reg.getProjectLock(p.id)?.agentId).toBe('A')
    const blocked = reg.acquireProjectLock(p.id, ai('B'))
    expect(blocked.ok).toBe(false)
    expect((blocked as { reason: string }).reason).toMatch(/^project-locked-by-other/)
    // Re-acquire by the same agent is idempotent.
    expect(reg.acquireProjectLock(p.id, ai('A'))).toEqual({ ok: true })
  })

  it('an agent cannot open a second project until it closes the first', async () => {
    const reg = makeRegistry()
    reg.init()
    const a = await reg.createProject({ name: 'A' })
    const b = await reg.createProject({ name: 'B' })
    expect(reg.acquireProjectLock(a.id, ai('A'))).toEqual({ ok: true })
    const blocked = reg.acquireProjectLock(b.id, ai('A'))
    expect(blocked.ok).toBe(false)
    expect((blocked as { reason: string }).reason).toMatch(/^agent-holds-another/)
    // Release A, then B opens.
    expect(reg.releaseProjectLock(a.id, ai('A'))).toEqual({ ok: true })
    expect(reg.acquireProjectLock(b.id, ai('A'))).toEqual({ ok: true })
  })

  it('rejects a release from the wrong agent; missing agentId is rejected', async () => {
    const reg = makeRegistry()
    reg.init()
    const p = await reg.createProject({ name: 'P' })
    reg.acquireProjectLock(p.id, ai('A'))
    const wrong = reg.releaseProjectLock(p.id, ai('B'))
    expect(wrong.ok).toBe(false)
    expect((wrong as { reason: string }).reason).toMatch(/^lock-not-owned/)
    const noAgent = reg.acquireProjectLock(p.id, { kind: 'ai' })
    expect(noAgent.ok).toBe(false)
    expect((noAgent as { reason: string }).reason).toMatch(/^lock-requires-agent-id/)
  })

  it('checkMutationAccess: only the holding agent may mutate its active project', async () => {
    const reg = makeRegistry()
    reg.init()
    const p = await reg.createProject({ name: 'P' })
    // No lock yet → an AI mutation is denied (must open first).
    expect(reg.checkMutationAccess(p.id, ai('A')).ok).toBe(false)
    reg.acquireProjectLock(p.id, ai('A'))
    expect(reg.checkMutationAccess(p.id, ai('A'))).toEqual({ ok: true })
    expect(reg.checkMutationAccess(p.id, ai('B')).ok).toBe(false)
    // Humans always pass regardless of who holds it.
    expect(reg.checkMutationAccess(p.id, { kind: 'workbench' })).toEqual({ ok: true })
  })

  it('checkMutationAccess surfaces machine-readable codes (recoverable vs conflict)', async () => {
    const reg = makeRegistry()
    reg.init()
    const p = await reg.createProject({ name: 'P' })
    // No lock yet (the post-restart state) → RECOVERABLE code so the AI tool seam
    // can transparently re-open + retry.
    const notOpen = reg.checkMutationAccess(p.id, ai('A'))
    expect(notOpen).toEqual({
      ok: false,
      code: 'mutation-denied-not-open',
      reason: expect.stringContaining('is not open by any agent'),
    })
    // Held by a DIFFERENT agent → NON-recoverable conflict code (never retried).
    reg.acquireProjectLock(p.id, ai('A'))
    const conflict = reg.checkMutationAccess(p.id, ai('B'))
    expect(conflict.ok).toBe(false)
    expect((conflict as { code: string }).code).toBe('mutation-denied-locked-by-other')
    // No active project → its own code.
    const noActive = reg.checkMutationAccess(null, ai('A'))
    expect((noActive as { code: string }).code).toBe('mutation-denied-no-project')
  })

  it('agents can mutate write-locked projects while UI views a different project', async () => {
    const reg = makeRegistry()
    reg.init()
    const a = await reg.createProject({ name: 'A' })
    const b = await reg.createProject({ name: 'B' })
    expect(reg.claimWriteAccess(a.id, ai('A'))).toEqual({ ok: true, queued: false })
    expect(reg.claimWriteAccess(b.id, ai('B'))).toEqual({ ok: true, queued: false })
    reg.viewProject(a.id)
    expect(reg.checkMutationAccess(a.id, ai('A'))).toEqual({ ok: true })
    expect(reg.checkMutationAccess(b.id, ai('B'))).toEqual({ ok: true })
    await applyBatch(reg.getRuntimeFor(b.id), [
      { type: 'createNode', nodeId: 'bOnly', opId: 'demo.a', position: { x: 0, y: 0 }, params: {} },
    ])
    expect(Object.keys(getPipeline(reg.getRuntimeFor(b.id))!.nodes)).toEqual(['bOnly'])
    expect(reg.getViewingProjectId()).toBe(a.id)
  })

  it('deleting a locked project releases its lock', async () => {
    const reg = makeRegistry()
    reg.init()
    const a = await reg.createProject({ name: 'A' })
    const b = await reg.createProject({ name: 'B' })
    reg.acquireProjectLock(a.id, ai('A'))
    await reg.deleteProject(a.id)
    expect(reg.getProjectLock(a.id)).toBeNull()
    // The agent is free to open a different project now.
    expect(reg.acquireProjectLock(b.id, ai('A'))).toEqual({ ok: true })
  })
})

describe('ProjectRegistry — holder identity distinguishes concurrent sessions sharing one agentId', () => {
  // Real callers: every construction-queue item in aw-support dispatches to
  // the SAME fixed ForgeaX agent role name (e.g. 'sino-constructor') even
  // when several items run as independent concurrent sessions — only
  // `sessionId` actually distinguishes them. These tests pin down that the
  // lock/queue tables key on (agentId, sessionId) together, not agentId
  // alone, so two such concurrent sessions never alias each other's lock.
  const aiSession = (agentId: string, sessionId: string) => ({ kind: 'ai' as const, agentId, sessionId })

  it('two sessions sharing one agentId can each hold a different project at once', async () => {
    const reg = makeRegistry()
    reg.init()
    const a = await reg.createProject({ name: 'A' })
    const b = await reg.createProject({ name: 'B' })
    expect(reg.acquireProjectLock(a.id, aiSession('sino-constructor', 'sess-1'))).toEqual({ ok: true })
    // Same agentId, different sessionId — must NOT hit "agent-holds-another".
    expect(reg.acquireProjectLock(b.id, aiSession('sino-constructor', 'sess-2'))).toEqual({ ok: true })
    expect(reg.getProjectLock(a.id)?.sessionId).toBe('sess-1')
    expect(reg.getProjectLock(b.id)?.sessionId).toBe('sess-2')
  })

  it('a same-agentId different-session caller cannot mutate or release a project it does not hold', async () => {
    const reg = makeRegistry()
    reg.init()
    const p = await reg.createProject({ name: 'P' })
    reg.acquireProjectLock(p.id, aiSession('sino-constructor', 'sess-1'))
    const otherSession = aiSession('sino-constructor', 'sess-2')
    expect(reg.checkMutationAccess(p.id, otherSession)).toMatchObject({
      ok: false,
      code: 'mutation-denied-locked-by-other',
    })
    const released = reg.releaseProjectLock(p.id, otherSession)
    expect(released).toMatchObject({ ok: false, code: 'lock-not-owned' })
    // The true holder is unaffected and can still mutate + release normally.
    expect(reg.checkMutationAccess(p.id, aiSession('sino-constructor', 'sess-1'))).toEqual({ ok: true })
    expect(reg.releaseProjectLock(p.id, aiSession('sino-constructor', 'sess-1'))).toEqual({ ok: true })
  })

  it('two sessions sharing one agentId can both soft-open; write claims queue independently', async () => {
    const reg = makeRegistry()
    reg.init()
    const p = await reg.createProject({ name: 'P' })
    reg.acquireProjectLock(p.id, aiSession('sino-constructor', 'sess-holder'))
    expect(reg.openProject(p.id, aiSession('sino-constructor', 'sess-1'))).toEqual({ ok: true, queued: false })
    expect(reg.openProject(p.id, aiSession('sino-constructor', 'sess-2'))).toEqual({ ok: true, queued: false })
    const first = reg.claimWriteAccess(p.id, aiSession('sino-constructor', 'sess-1'))
    const second = reg.claimWriteAccess(p.id, aiSession('sino-constructor', 'sess-2'))
    expect(first).toMatchObject({ queued: true, position: 1 })
    expect(second).toMatchObject({ queued: true, position: 2 })
    reg.releaseProjectLock(p.id, aiSession('sino-constructor', 'sess-holder'))
    expect(reg.getProjectLock(p.id)?.sessionId).toBe('sess-1')
    expect(reg.checkMutationAccess(p.id, aiSession('sino-constructor', 'sess-2')).ok).toBe(false)
  })

  it('a caller without sessionId still degrades to plain agentId identity (unchanged legacy behavior)', async () => {
    const reg = makeRegistry()
    reg.init()
    const p = await reg.createProject({ name: 'P' })
    const ai = (agentId: string) => ({ kind: 'ai' as const, agentId })
    expect(reg.acquireProjectLock(p.id, ai('A'))).toEqual({ ok: true })
    // Re-acquiring with the same session-less agentId is still idempotent.
    expect(reg.acquireProjectLock(p.id, ai('A'))).toEqual({ ok: true })
    // A different agentId is still rejected exactly as before.
    const blocked = reg.acquireProjectLock(p.id, ai('B'))
    expect(blocked).toMatchObject({ ok: false, code: 'project-locked-by-other' })
  })
})

describe('ProjectRegistry — lock lease + FIFO wait queue', () => {
  const ai = (agentId: string) => ({ kind: 'ai' as const, agentId })

  it('openProject is shared — many agents attach without queuing', async () => {
    const reg = makeRegistry()
    reg.init()
    const p = await reg.createProject({ name: 'P' })
    expect(reg.openProject(p.id, ai('A'))).toEqual({ ok: true, queued: false })
    expect(reg.openProject(p.id, ai('B'))).toEqual({ ok: true, queued: false })
    expect(reg.openProject(p.id, ai('C'))).toEqual({ ok: true, queued: false })
    expect(reg.getProjectQueue(p.id)).toEqual([])
    expect(reg.getProjectLock(p.id)).toBeNull()
  })

  it('claimWriteAccess enqueues writers on a busy project, reporting FIFO position', async () => {
    const reg = makeRegistry()
    reg.init()
    const p = await reg.createProject({ name: 'P' })
    expect(reg.claimWriteAccess(p.id, ai('A'))).toEqual({ ok: true, queued: false })

    const claimB = reg.claimWriteAccess(p.id, ai('B'))
    expect(claimB).toMatchObject({ ok: false, queued: true, code: 'project-queued', position: 1, aheadOf: [] })

    const claimC = reg.claimWriteAccess(p.id, ai('C'))
    expect(claimC).toMatchObject({ ok: false, queued: true, code: 'project-queued', position: 2, aheadOf: ['B'] })

    // Re-polling is idempotent: same position, not pushed to the back.
    expect(reg.claimWriteAccess(p.id, ai('B'))).toMatchObject({ position: 1, aheadOf: [] })
    expect(reg.getProjectQueue(p.id)).toEqual([
      { agentId: 'B', position: 1, aheadOf: [] },
      { agentId: 'C', position: 2, aheadOf: ['B'] },
    ])
  })

  it('non-queueable conflicts (unknown project, agent already holding another) still hard-fail', async () => {
    const reg = makeRegistry()
    reg.init()
    const a = await reg.createProject({ name: 'A' })
    const b = await reg.createProject({ name: 'B' })
    expect(reg.openProject('no-such-project', ai('A'))).toEqual({
      ok: false,
      code: 'project-not-found',
      reason: 'project-not-found: no-such-project',
    })
    reg.openProject(a.id, ai('A'))
    const blocked = reg.openProject(b.id, ai('A'))
    expect(blocked.ok).toBe(false)
    expect((blocked as { queued?: boolean }).queued).toBeFalsy()
    expect((blocked as { code: string }).code).toBe('agent-holds-another')
  })

  it('detachProject clears the soft session so the agent can open a different project', async () => {
    const reg = makeRegistry()
    reg.init()
    const a = await reg.createProject({ name: 'A' })
    const b = await reg.createProject({ name: 'B' })

    expect(reg.openProject(a.id, ai('A'))).toEqual({ ok: true, queued: false })
    expect(reg.openProject(b.id, ai('A'))).toMatchObject({ ok: false, code: 'agent-holds-another' })

    // Releasing only the write lock is NOT enough — the soft session is what
    // `agent-holds-another` is keyed on, and only detach clears it.
    reg.releaseProjectLock(a.id, ai('A'))
    expect(reg.openProject(b.id, ai('A'))).toMatchObject({ ok: false, code: 'agent-holds-another' })

    expect(reg.detachProject(a.id, ai('A'))).toEqual({ ok: true })
    expect(reg.getAgentOpenProjectId(ai('A'))).toBeNull()
    expect(reg.openProject(b.id, ai('A'))).toEqual({ ok: true, queued: false })
  })

  it('an idle soft session is swept — a crashed agent is not locked out of every other project', async () => {
    const reg = makeRegistry(undefined, { sessionIdleMs: 20 })
    reg.init()
    const a = await reg.createProject({ name: 'A' })
    const b = await reg.createProject({ name: 'B' })

    reg.openProject(a.id, ai('A')) // never closes — simulates a crash
    await sleep(40)

    expect(reg.getAgentOpenProjectId(ai('A'))).toBeNull()
    expect(reg.openProject(b.id, ai('A'))).toEqual({ ok: true, queued: false })
  })

  it('a soft session backing a live write lock is never swept as idle', async () => {
    const reg = makeRegistry(undefined, { sessionIdleMs: 20, lockLeaseMs: 60_000 })
    reg.init()
    const a = await reg.createProject({ name: 'A' })
    const b = await reg.createProject({ name: 'B' })

    reg.claimWriteAccess(a.id, ai('A'))
    await sleep(40)

    expect(reg.getAgentOpenProjectId(ai('A'))).toBe(a.id)
    expect(reg.openProject(b.id, ai('A'))).toMatchObject({ ok: false, code: 'agent-holds-another' })
  })

  it('forceUnlockProject also detaches soft sessions, so the project is fully released', async () => {
    const reg = makeRegistry()
    reg.init()
    const a = await reg.createProject({ name: 'A' })
    const b = await reg.createProject({ name: 'B' })

    reg.claimWriteAccess(a.id, ai('A'))
    expect(reg.forceUnlockProject(a.id, { kind: 'workbench' })).toEqual({ ok: true })

    expect(reg.getProjectLock(a.id)).toBeNull()
    expect(reg.getAgentOpenProjectId(ai('A'))).toBeNull()
    expect(reg.openProject(b.id, ai('A'))).toEqual({ ok: true, queued: false })
  })

  it('deleting a project drops the soft sessions pointing at it', async () => {
    const reg = makeRegistry()
    reg.init()
    const a = await reg.createProject({ name: 'A' })
    const b = await reg.createProject({ name: 'B' })

    reg.openProject(a.id, ai('A'))
    await reg.deleteProject(a.id)

    expect(reg.getAgentOpenProjectId(ai('A'))).toBeNull()
    expect(reg.openProject(b.id, ai('A'))).toEqual({ ok: true, queued: false })
  })

  it('humans always bypass the write queue, even while an AI holds the lock', async () => {
    const reg = makeRegistry()
    reg.init()
    const p = await reg.createProject({ name: 'P' })
    reg.claimWriteAccess(p.id, ai('A'))
    expect(reg.openProject(p.id, { kind: 'user' })).toEqual({ ok: true, queued: false })
    expect(reg.claimWriteAccess(p.id, { kind: 'user' })).toEqual({ ok: true, queued: false })
    expect(reg.getProjectQueue(p.id)).toEqual([])
  })

  it('releasing the write lock hands it straight to the queue head', async () => {
    const reg = makeRegistry()
    reg.init()
    const p = await reg.createProject({ name: 'P' })
    reg.claimWriteAccess(p.id, ai('A'))
    reg.claimWriteAccess(p.id, ai('B'))
    reg.claimWriteAccess(p.id, ai('C'))

    expect(reg.releaseProjectLock(p.id, ai('A'))).toEqual({ ok: true })
    expect(reg.getProjectLock(p.id)?.agentId).toBe('B')
    expect(reg.getProjectQueue(p.id)).toEqual([{ agentId: 'C', position: 1, aheadOf: [] }])

    // B did not have to call anything to claim it — but its own next claim is
    // an idempotent no-op confirming it already holds the write lock.
    expect(reg.claimWriteAccess(p.id, ai('B'))).toEqual({ ok: true, queued: false })

    expect(reg.releaseProjectLock(p.id, ai('B'))).toEqual({ ok: true })
    expect(reg.getProjectLock(p.id)?.agentId).toBe('C')
    expect(reg.getProjectQueue(p.id)).toEqual([])
  })

  it('an expired write lease is swept and handed to the queue head — a crashed agent cannot wedge a project shut', async () => {
    const reg = makeRegistry(undefined, { lockLeaseMs: 20 })
    reg.init()
    const p = await reg.createProject({ name: 'P' })
    reg.claimWriteAccess(p.id, ai('A')) // never closes — simulates a crash
    reg.claimWriteAccess(p.id, ai('B')) // queues behind A

    await sleep(40)
    // Nobody touched the lock: the next lock-table read must self-heal.
    expect(reg.getProjectLock(p.id)?.agentId).toBe('B')
    expect(reg.checkMutationAccess(p.id, ai('B'))).toEqual({ ok: true })
    expect(reg.checkMutationAccess(p.id, ai('A')).ok).toBe(false)
  })

  it('checkMutationAccess renews the lease so an actively-mutating agent is never timed out', async () => {
    const reg = makeRegistry(undefined, { lockLeaseMs: 40 })
    reg.init()
    const p = await reg.createProject({ name: 'P' })
    reg.claimWriteAccess(p.id, ai('A'))

    vi.useFakeTimers()
    try {
      // Two mutation "heartbeats" spaced under the lease window, spanning more
      // than one full lease window in total — must never expire in between.
      vi.advanceTimersByTime(25)
      expect(reg.checkMutationAccess(p.id, ai('A'))).toEqual({ ok: true })
      vi.advanceTimersByTime(25)
      expect(reg.checkMutationAccess(p.id, ai('A'))).toEqual({ ok: true })
      expect(reg.getProjectLock(p.id)?.agentId).toBe('A')
    } finally {
      vi.useRealTimers()
    }
  })

  it('renewLock (explicit heartbeat) keeps an idle-but-alive agent from expiring', async () => {
    const reg = makeRegistry(undefined, { lockLeaseMs: 30 })
    reg.init()
    const p = await reg.createProject({ name: 'P' })
    reg.claimWriteAccess(p.id, ai('A'))

    vi.useFakeTimers()
    try {
      vi.advanceTimersByTime(20)
      expect(reg.renewLock(p.id, ai('A'))).toEqual({ ok: true })
      vi.advanceTimersByTime(20)
      // 40ms have elapsed since claim, but the heartbeat at 20ms reset the
      // 30ms window, so the lock must still be A's.
      expect(reg.getProjectLock(p.id)?.agentId).toBe('A')
    } finally {
      vi.useRealTimers()
    }
  })

  it('renewLock rejects an agent that does not hold the project', async () => {
    const reg = makeRegistry()
    reg.init()
    const p = await reg.createProject({ name: 'P' })
    const res = reg.renewLock(p.id, ai('nobody'))
    expect(res.ok).toBe(false)
    expect((res as { code: string }).code).toBe('mutation-denied-not-open')
  })

  it('a stale (idle) write-queue entry is dropped and never blocks the agent behind it', async () => {
    const reg = makeRegistry(undefined, { queueEntryIdleMs: 20 })
    reg.init()
    const p = await reg.createProject({ name: 'P' })
    reg.claimWriteAccess(p.id, ai('A'))
    reg.claimWriteAccess(p.id, ai('B')) // queues, then goes silent (never polls again)
    await sleep(30)
    reg.claimWriteAccess(p.id, ai('C')) // polls after B's slot has gone stale

    expect(reg.getProjectQueue(p.id).map((e) => e.agentId)).toEqual(['C'])
    reg.releaseProjectLock(p.id, ai('A'))
    // C, not the abandoned B, gets the write lock.
    expect(reg.getProjectLock(p.id)?.agentId).toBe('C')
  })

  it('leaveQueue removes an agent from the write wait line without side effects on others', async () => {
    const reg = makeRegistry()
    reg.init()
    const p = await reg.createProject({ name: 'P' })
    reg.claimWriteAccess(p.id, ai('A'))
    reg.claimWriteAccess(p.id, ai('B'))
    reg.claimWriteAccess(p.id, ai('C'))
    expect(reg.leaveQueue(p.id, ai('B'))).toEqual({ ok: true })
    expect(reg.getProjectQueue(p.id)).toEqual([{ agentId: 'C', position: 1, aheadOf: [] }])
    // Idempotent — leaving twice, or leaving while never queued, is a no-op.
    expect(reg.leaveQueue(p.id, ai('B'))).toEqual({ ok: true })
  })

  it('forceUnlockProject is denied for AI callers and fully resets lock+queue for humans', async () => {
    const reg = makeRegistry()
    reg.init()
    const p = await reg.createProject({ name: 'P' })
    reg.claimWriteAccess(p.id, ai('A'))
    reg.claimWriteAccess(p.id, ai('B'))

    const deniedForAi = reg.forceUnlockProject(p.id, ai('A'))
    expect(deniedForAi.ok).toBe(false)
    expect((deniedForAi as { code: string }).code).toBe('force-unlock-denied')
    expect(reg.getProjectLock(p.id)?.agentId).toBe('A') // unchanged

    expect(reg.forceUnlockProject(p.id, { kind: 'workbench' })).toEqual({ ok: true })
    expect(reg.getProjectLock(p.id)).toBeNull()
    expect(reg.getProjectQueue(p.id)).toEqual([])

    // The project is fully writable again — by anyone, including the
    // previously-queued B, with no leftover queue entries surfacing.
    expect(reg.claimWriteAccess(p.id, ai('B'))).toEqual({ ok: true, queued: false })
  })
})

describe('ProjectRegistry — delete asset hook', () => {
  it('forwards the asset policy to the app-supplied hook', async () => {
    const { factory } = makeFactory()
    const calls: Array<{ id: string; policy: string }> = []
    const reg = new ProjectRegistry({
      workspaceRoot: root,
      createRuntime: factory,
      defaultType: 'scene',
      defaultProjectId: 'main',
      onDeleteProjectAssets: (id, policy) => {
        calls.push({ id, policy })
      },
    })
    reg.init()
    const p = await reg.createProject({ name: 'Disposable' })
    await reg.deleteProject(p.id, { assetPolicy: 'delete' })
    expect(calls).toEqual([{ id: p.id, policy: 'delete' }])
  })
})
