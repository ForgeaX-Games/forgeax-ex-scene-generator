// projectStore — the faithful open cascade reuses the live-sync machinery.
//
// Proves switchProject():
//   1. calls the transport viewProject (server sets the UI viewing target),
//   2. drives loadPipeline() so pipelineRevision bumps (→ useCanvasGraphSync
//      reconcile rebuild) and currentPipeline reflects the OPENED project,
//   3. clears the undo history (it must not cross projects),
//   4. resets the node-output cache,
//   5. sets the active project type (keeps the battery filter correct).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  ApiClient,
  PipelineSnapshot,
  ProjectMeta,
  ProjectRecord,
  RuntimeChannel,
  RuntimeEvent,
  WorkspaceState,
} from '@forgeax/node-runtime'
import type { CreateProjectRequest, ViewProjectResult } from '../../api/ApiClient.js'

import { configureEditorTransport, createEditorTransport, type EditorTransport } from '../transport/index.js'
import { usePipelineStore } from '../stores/pipelineStore.js'
import { useHistoryStore } from '../stores/historyStore.js'
import { useUIStore } from '../stores/uiStore.js'
import { useProjectStore } from '../stores/projectStore.js'

function snap(id: string, nodeId: string): PipelineSnapshot {
  return {
    id,
    hash: `${id}-hash`,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    nodes: { [nodeId]: { id: nodeId, opId: 'a.one', name: nodeId, position: { x: 0, y: 0 }, params: {} } },
    edges: {},
  }
}

function workspace(active: string, recent: string[], executing: string[] = []): WorkspaceState {
  return { viewingProjectId: active, recentProjectIds: recent, lastOpenedAt: '', executingProjectIds: executing }
}

/** A minimal in-memory ApiClient with the project surface + per-project graphs. */
function makeClient(): ApiClient {
  const graphs: Record<string, PipelineSnapshot> = {
    p1: snap('p1', 'oneNode'),
    p2: snap('p2', 'twoNode'),
  }
  const metas: Record<string, ProjectMeta> = {
    p1: { id: 'p1', type: 'scene', name: 'P1', description: '', createdAt: '', updatedAt: '' },
    p2: { id: 'p2', type: 'lowpoly', name: 'P2', description: '', createdAt: '', updatedAt: '' },
  }
  let viewing = 'p1'
  const recent = ['p1']
  const viewResult = (id: string): ViewProjectResult => ({
    project: { manifest: { schemaVersion: 1, ...metas[id], storage: { graphFile: '', historyFile: '', outputsDir: '' } } },
    pipeline: graphs[id] ?? null,
  })
  return {
    pipelineId: 'main',
    applyBatch: async () => ({ status: 'ok', newHash: 'h', batchId: 'b' }),
    execute: async () => ({ status: 'completed' }) as never,
    getPipeline: async () => graphs[viewing] ?? null,
    getNode: async () => null,
    listNodes: async () => Object.values(graphs[viewing]?.nodes ?? {}),
    listEdges: async () => [],
    getNodeOutput: async () => undefined,
    getHistory: async () => [],
    listOps: async () => [],
    getGroup: async () => null,
    listGroups: async () => [],
    subscribe: (_c: RuntimeChannel, _l: (e: RuntimeEvent) => void) => () => {},
    resolveAssetPath: async (t: string) => t,
    listProjects: async () => Object.values(metas),
    getProject: async (id: string): Promise<ProjectRecord | null> =>
      metas[id] ? { manifest: { schemaVersion: 1, ...metas[id], storage: { graphFile: '', historyFile: '', outputsDir: '' } } } : null,
    createProject: async (_req: CreateProjectRequest) => metas.p2,
    updateProject: async (id: string) => metas[id],
    deleteProject: async () => ({ ok: true as const, workspace: workspace(viewing, recent) }),
    viewProject: async (id: string): Promise<ViewProjectResult> => {
      viewing = id
      if (!recent.includes(id)) recent.unshift(id)
      return viewResult(id)
    },
    getWorkspace: async (): Promise<WorkspaceState> => workspace(viewing, recent),
    setWorkspace: async (): Promise<WorkspaceState> => workspace(viewing, recent),
  }
}

let transport: EditorTransport

beforeEach(() => {
  transport = createEditorTransport(makeClient())
  configureEditorTransport(transport)
  usePipelineStore.setState({
    currentPipeline: null,
    pipelineRevision: 0,
    nodeOutputs: {},
    dynamicOutputPorts: {},
  })
  useHistoryStore.setState({ entries: [], cursor: 0, _redoTip: null })
  useProjectStore.setState({
    projects: [],
    viewingProjectId: null,
    hydratedProjectId: null,
    executingProjectIds: [],
    recentProjectIds: [],
    isSwitching: false,
    projectSwitchRole: 'host',
  })
})

afterEach(() => {
  transport.dispose()
  configureEditorTransport(null)
})

describe('projectStore open cascade', () => {
  it('switchProject swaps the graph via loadPipeline (revision++) and clears history', async () => {
    useHistoryStore.setState({ entries: [{ id: 'x' } as never], cursor: 1, _redoTip: null })
    usePipelineStore.setState({ nodeOutputs: { ghost: { out: 1 } } })
    const revBefore = usePipelineStore.getState().pipelineRevision

    await useProjectStore.getState().switchProject('p2')

    const pipe = usePipelineStore.getState()
    expect(pipe.currentPipeline?.id).toBe('p2')
    expect(pipe.currentPipeline?.nodes.some((n) => n.id === 'twoNode')).toBe(true)
    expect(pipe.pipelineRevision).toBeGreaterThan(revBefore)
    expect(pipe.nodeOutputs.ghost).toBeUndefined()
    expect(useHistoryStore.getState().entries).toHaveLength(0)
    expect(useUIStore.getState().activeProjectType).toBe('lowpoly')
    expect(useProjectStore.getState().viewingProjectId).toBe('p2')
  })

  it('bootstrap opens the viewing project even when viewingProjectId is already set (page refresh)', async () => {
    await useProjectStore.getState().fetchProjects()
    expect(useProjectStore.getState().viewingProjectId).toBe('p1')
    expect(usePipelineStore.getState().currentPipeline).toBeNull()

    const refreshSpy = vi.spyOn(usePipelineStore.getState(), 'refreshConnectedOutputs').mockResolvedValue()
    await useProjectStore.getState().switchProject('p1')

    expect(usePipelineStore.getState().currentPipeline?.id).toBe('p1')
    expect(refreshSpy).toHaveBeenCalledWith('project-switch')
    refreshSpy.mockRestore()
  })

  it('does not persist a read-only hydrated snapshot before switching', async () => {
    await useProjectStore.getState().bootstrap()
    const persistSpy = vi.spyOn(usePipelineStore.getState(), 'persistSession')

    await useProjectStore.getState().switchProject('p2')

    expect(persistSpy).not.toHaveBeenCalled()
    persistSpy.mockRestore()
  })

  it('persists local graph mutations before switching', async () => {
    await useProjectStore.getState().bootstrap()
    usePipelineStore.getState().updateNode('oneNode', { position: { x: 10, y: 0 } })
    const persistSpy = vi.spyOn(usePipelineStore.getState(), 'persistSession').mockResolvedValue()

    await useProjectStore.getState().switchProject('p2')

    expect(persistSpy).toHaveBeenCalledOnce()
    persistSpy.mockRestore()
  })

  it('fetchProjects loads the list + syncs the viewing project type', async () => {
    await useProjectStore.getState().fetchProjects()
    expect(useProjectStore.getState().projects.map((p) => p.id).sort()).toEqual(['p1', 'p2'])
    expect(useProjectStore.getState().viewingProjectId).toBe('p1')
    expect(useUIStore.getState().activeProjectType).toBe('scene')
  })

  it('fetchProjects falls back to legacy activeProjectId in workspace', async () => {
    const base = makeClient()
    const client: ApiClient = {
      ...base,
      getWorkspace: async () =>
        ({ activeProjectId: 'p2', recentProjectIds: ['p2'], lastOpenedAt: '' }) as WorkspaceState,
    }
    transport.dispose()
    transport = createEditorTransport(client)
    configureEditorTransport(transport)
    await useProjectStore.getState().fetchProjects()
    expect(useProjectStore.getState().viewingProjectId).toBe('p2')
  })

  it('hydrates __group__ (template) nodes with their group definitions on a plain viewProject switch — no extra loadPipeline needed', async () => {
    // Regression: viewProject() used to return the bare kernel snapshot
    // (nodes/edges only, no `groups`). hydratePipelineFromSnapshot() hydrated
    // straight from that, so `__group__` nodes had no matching group and
    // buildCanvasNodes dropped them — templates vanished after a refresh
    // until some other action (e.g. dropping a new template) forced a full
    // loadPipeline() (which does fetch groups).
    const base = makeClient()
    const groupSnap: PipelineSnapshot = {
      id: 'p1',
      hash: 'p1-group-hash',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      edges: {},
      nodes: {
        oneNode: { id: 'oneNode', opId: 'a.one', name: 'oneNode', position: { x: 0, y: 0 }, params: {} },
        tpl1: { id: 'tpl1', opId: '__group__', name: 'tpl1', position: { x: 0, y: 0 }, params: { groupId: 'g1' } },
      },
    }
    const client: ApiClient = {
      ...base,
      getPipeline: async () => groupSnap,
      viewProject: async (id: string) => ({
        project: { manifest: { schemaVersion: 1, id: 'p1', type: 'scene', name: 'P1', description: '', createdAt: '', updatedAt: '', storage: { graphFile: '', historyFile: '', outputsDir: '' } } },
        pipeline: id === 'p1' ? groupSnap : null,
      }),
      listGroups: async () => [
        { id: 'g1', name: 'Template One', nodes: [], edges: [], position: { x: 0, y: 0 }, exposedInputs: [], exposedOutputs: [] },
      ],
    }
    transport.dispose()
    transport = createEditorTransport(client)
    configureEditorTransport(transport)

    await useProjectStore.getState().bootstrap()

    const pipe = usePipelineStore.getState().currentPipeline
    expect(pipe?.nodes.some((n) => n.id === 'tpl1')).toBe(true)
    expect(pipe?.groups?.some((g) => g.id === 'g1')).toBe(true)
  })

  it('satellite switchProject only calls viewProject — no pipeline hydration or output refresh', async () => {
    useProjectStore.getState().setProjectSwitchRole('satellite')
    await useProjectStore.getState().fetchProjects()
    const refreshSpy = vi.spyOn(usePipelineStore.getState(), 'refreshConnectedOutputs').mockResolvedValue()
    const loadSpy = vi.spyOn(usePipelineStore.getState(), 'loadPipeline').mockResolvedValue()
    await useProjectStore.getState().switchProject('p2')
    expect(useProjectStore.getState().viewingProjectId).toBe('p2')
    expect(usePipelineStore.getState().currentPipeline).toBeNull()
    expect(refreshSpy).not.toHaveBeenCalled()
    expect(loadSpy).not.toHaveBeenCalled()
    refreshSpy.mockRestore()
    loadSpy.mockRestore()
  })
})

describe('projectStore cross-client sync (subscribeProjectActivation)', () => {
  function makeCapturingTransport(): {
    listeners: Record<string, Set<(e: RuntimeEvent) => void>>
    viewCalls: () => number
    listProjectsCalls: number[]
    setServerViewing: (id: string) => Promise<void>
  } {
    const base = makeClient()
    const listeners: Record<string, Set<(e: RuntimeEvent) => void>> = {}
    let viewCalls = 0
    const listProjectsCalls: number[] = []
    const client: ApiClient = {
      ...base,
      viewProject: async (id: string) => {
        viewCalls++
        return base.viewProject!(id)
      },
      listProjects: async () => {
        listProjectsCalls.push(Date.now())
        return base.listProjects!()
      },
      subscribe: (c: RuntimeChannel, l: (e: RuntimeEvent) => void) => {
        ;(listeners[c] ??= new Set()).add(l)
        return () => listeners[c]?.delete(l)
      },
    }
    transport.dispose()
    configureEditorTransport(null)
    transport = createEditorTransport(client)
    configureEditorTransport(transport)
    return {
      listeners,
      viewCalls: () => viewCalls,
      listProjectsCalls,
      setServerViewing: async (id) => {
        await base.viewProject!(id)
      },
    }
  }

  function emitProjectViewing(
    listeners: Record<string, Set<(e: RuntimeEvent) => void>>,
    projectId: string,
    kind: 'project:viewing' | 'project:activated' = 'project:viewing',
  ): void {
    for (const l of listeners.graph ?? []) {
      l({ kind, projectId, pipelineId: projectId, newHash: `${projectId}-hash` } as RuntimeEvent)
    }
  }

  it('re-syncs to a project viewed elsewhere WITHOUT re-calling viewProject', async () => {
    const { listeners, viewCalls, setServerViewing } = makeCapturingTransport()
    await useProjectStore.getState().fetchProjects()
    expect(useProjectStore.getState().viewingProjectId).toBe('p1')

    const unsub = useProjectStore.getState().subscribeProjectActivation()
    const revBefore = usePipelineStore.getState().pipelineRevision
    const callsBefore = viewCalls()

    await setServerViewing('p2')
    emitProjectViewing(listeners, 'p2')

    await vi.waitFor(() => {
      expect(useProjectStore.getState().isSwitching).toBe(false)
      expect(usePipelineStore.getState().currentPipeline?.id).toBe('p2')
    })
    expect(useProjectStore.getState().viewingProjectId).toBe('p2')
    expect(usePipelineStore.getState().pipelineRevision).toBeGreaterThan(revBefore)
    expect(useUIStore.getState().activeProjectType).toBe('lowpoly')
    expect(viewCalls()).toBe(callsBefore)
    unsub()
  })

  it('handles legacy project:activated alias', async () => {
    const { listeners, setServerViewing } = makeCapturingTransport()
    await useProjectStore.getState().fetchProjects()
    const unsub = useProjectStore.getState().subscribeProjectActivation()

    await setServerViewing('p2')
    emitProjectViewing(listeners, 'p2', 'project:activated')

    await vi.waitFor(() => {
      expect(useProjectStore.getState().viewingProjectId).toBe('p2')
    })
    unsub()
  })

  it('tracks project:executing in executingProjectIds', async () => {
    const { listeners, listProjectsCalls } = makeCapturingTransport()
    const unsub = useProjectStore.getState().subscribeProjectActivation()

    for (const l of listeners.graph ?? []) {
      l({ kind: 'project:executing', projectId: 'p2', pipelineId: 'p2', agentId: 'agent-1' } as RuntimeEvent)
    }

    await vi.waitFor(() => {
      expect(useProjectStore.getState().executingProjectIds).toContain('p2')
      expect(listProjectsCalls.length).toBeGreaterThan(0)
    })
    unsub()
  })

  it('refreshes project list on project:list-changed', async () => {
    const { listeners, listProjectsCalls } = makeCapturingTransport()
    const unsub = useProjectStore.getState().subscribeProjectActivation()
    const before = listProjectsCalls.length

    for (const l of listeners.graph ?? []) {
      l({ kind: 'project:list-changed', reason: 'created' } as RuntimeEvent)
    }

    await vi.waitFor(() => {
      expect(listProjectsCalls.length).toBeGreaterThan(before)
    })
    unsub()
  })

  it('removes project from executingProjectIds on project:idle', async () => {
    const { listeners } = makeCapturingTransport()
    useProjectStore.setState({ executingProjectIds: ['p2', 'p3'] })
    const unsub = useProjectStore.getState().subscribeProjectActivation()

    for (const l of listeners.graph ?? []) {
      l({ kind: 'project:idle', projectId: 'p2', agentId: 'agent-1' } as RuntimeEvent)
    }

    await vi.waitFor(() => {
      expect(useProjectStore.getState().executingProjectIds).toEqual(['p3'])
    })
    unsub()
  })

  it('ignores its own viewing echo (the canvas is already hydrated to that project)', async () => {
    const { listeners } = makeCapturingTransport()
    await useProjectStore.getState().switchProject('p1')
    const unsub = useProjectStore.getState().subscribeProjectActivation()
    const revBefore = usePipelineStore.getState().pipelineRevision

    emitProjectViewing(listeners, 'p1')
    await new Promise((r) => setTimeout(r, 10))

    expect(useProjectStore.getState().viewingProjectId).toBe('p1')
    expect(usePipelineStore.getState().pipelineRevision).toBe(revBefore)
    unsub()
  })

  // The "new project loses everything" bug: creating a project broadcasts
  // project:created BEFORE project:viewing. The former runs fetchProjects(),
  // which mirrors the server workspace into viewingProjectId — so by the time
  // project:viewing arrives the id already matches and the old equality guard
  // swallowed it. The canvas then stayed on the PREVIOUS project's graph while
  // every write was routed to the new project id.
  it('still hydrates project:viewing after a project:created refresh already moved viewingProjectId', async () => {
    const { listeners, setServerViewing } = makeCapturingTransport()
    await useProjectStore.getState().switchProject('p1')
    const unsub = useProjectStore.getState().subscribeProjectActivation()

    await setServerViewing('p2')
    for (const l of listeners.graph ?? []) {
      l({ kind: 'project:created', projectId: 'p2', pipelineId: 'p2' } as RuntimeEvent)
    }
    await vi.waitFor(() => {
      expect(useProjectStore.getState().viewingProjectId).toBe('p2')
    })
    expect(usePipelineStore.getState().currentPipeline?.id).toBe('p1')

    emitProjectViewing(listeners, 'p2')

    await vi.waitFor(() => {
      expect(usePipelineStore.getState().currentPipeline?.id).toBe('p2')
    })
    unsub()
  })

  it('a satellite pane tracks the viewing id without hydrating a graph it does not own', async () => {
    const { listeners, setServerViewing } = makeCapturingTransport()
    useProjectStore.getState().setProjectSwitchRole('satellite')
    const unsub = useProjectStore.getState().subscribeProjectActivation()

    await setServerViewing('p2')
    emitProjectViewing(listeners, 'p2')

    await vi.waitFor(() => {
      expect(useProjectStore.getState().viewingProjectId).toBe('p2')
    })
    expect(usePipelineStore.getState().currentPipeline).toBeNull()
    unsub()
  })
})
