import { describe, it, expect, vi } from 'vitest'
import { HttpApiClient, HttpApiRequestError, SceneScriptRequestError } from '../HttpApiClient'

// Minimal WebSocket stand-in so we can drive the client's onmessage path (the
// single source of graph reactivity) without a real server.
class FakeWebSocket {
  static last: FakeWebSocket | null = null
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  sent: string[] = []
  constructor(public url: string) {
    FakeWebSocket.last = this
  }
  send(d: string): void {
    this.sent.push(d)
  }
  close(): void {
    this.onclose?.()
  }
}

describe('HttpApiClient', () => {
  it('preserves structured active-game errors from the backend', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      status: 'waiting',
      code: 'ACTIVE_GAME_REQUIRED',
      message: 'Create or select a game before using Scene Generator.',
      retryable: true,
    }), { status: 409, headers: { 'content-type': 'application/json' } })))
    const client = new HttpApiClient({ baseUrl: '', pipelineId: 'main' })

    const error = await client.listProjects().catch((caught) => caught)
    expect(error).toBeInstanceOf(HttpApiRequestError)
    expect(error).toMatchObject({
      status: 409,
      code: 'ACTIVE_GAME_REQUIRED',
      retryable: true,
      message: 'Create or select a game before using Scene Generator.',
    })
  })

  it('listOps GETs /api/v1/ops and returns the array', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([{ id: 'relu', inputs: [], outputs: [] }]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const c = new HttpApiClient({ baseUrl: '', pipelineId: 'main' })
    const ops = await c.listOps()
    expect(ops[0].id).toBe('relu')
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/ops', expect.anything())
  })
  it('applyBatch POSTs ops to the viewing project batch route and does NOT synthesize a graph event', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/v1/workspace') {
        return new Response(JSON.stringify({ viewingProjectId: 'main', recentProjectIds: ['main'], lastOpenedAt: '' }), { status: 200 })
      }
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const c = new HttpApiClient({ baseUrl: '', pipelineId: 'main' })
    await c.getWorkspace()
    const graphEvents: unknown[] = []
    c.subscribe('graph', (e) => graphEvents.push(e))
    const r = await c.applyBatch([{ type: 'createNode', nodeId: 'n', opId: 'relu', position: { x: 0, y: 0 }, params: {} }] as never)
    expect(r.status).toBe('ok')
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/projects/main/batch', expect.objectContaining({ method: 'POST' }))
    expect(graphEvents.length).toBe(0)
  })
  it('forwards a WS runtime graph:applied frame to graph listeners (single source)', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('null', { status: 200 })))
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket)
    const c = new HttpApiClient({ baseUrl: 'http://localhost:9999', pipelineId: 'main' })
    const graphEvents: unknown[] = []
    c.subscribe('graph', (e) => graphEvents.push(e)) // opens the (fake) socket
    const sock = FakeWebSocket.last
    expect(sock).toBeTruthy()
    sock!.onmessage?.({
      data: JSON.stringify({
        event: 'runtime',
        payload: { kind: 'graph:applied', pipelineId: 'main', batchId: 'b1', newHash: 'h1' },
      }),
    })
    expect(graphEvents.length).toBe(1)
    expect((graphEvents[0] as { batchId: string }).batchId).toBe('b1')
    c.dispose()
  })
  it('forwards library:changed WS frames to asset listeners', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('null', { status: 200 })))
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket)
    const c = new HttpApiClient({ baseUrl: 'http://localhost:9999', pipelineId: 'main' })
    const assetEvents: unknown[] = []
    c.subscribe('asset', (e) => assetEvents.push(e))
    const sock = FakeWebSocket.last
    sock!.onmessage?.({
      data: JSON.stringify({ event: 'library:changed', payload: { source: 'game-sandbox' } }),
    })
    expect(assetEvents.length).toBe(1)
    expect((assetEvents[0] as { kind: string }).kind).toBe('asset:library-changed')
    c.dispose()
  })
  it('listNodes uses the workspace viewing project after ensureViewingProject', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/v1/workspace') {
        return new Response(JSON.stringify({ viewingProjectId: 'p1', recentProjectIds: ['p1'], lastOpenedAt: '' }), { status: 200 })
      }
      if (url === '/api/v1/projects/p1/nodes') {
        return new Response(JSON.stringify([{ id: 'n1', opId: 'relu', name: 'N1' }]), { status: 200 })
      }
      return new Response('null', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const c = new HttpApiClient({ baseUrl: '', pipelineId: 'main' })
    await c.ensureViewingProject()
    const nodes = await c.listNodes()
    expect(nodes).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/projects/p1/nodes', expect.anything())
  })
  it('uses an explicitly embedded project without changing the shared workspace view', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/v1/projects/p_embedded/nodes') {
        return new Response(JSON.stringify([{ id: 'n1', opId: 'relu', name: 'N1' }]), { status: 200 })
      }
      return new Response('null', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const c = new HttpApiClient({
      baseUrl: '',
      pipelineId: 'main',
      projectId: 'p_embedded',
    })

    await expect(c.listNodes()).resolves.toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/projects/p_embedded/nodes', expect.anything())
    expect(fetchMock).not.toHaveBeenCalledWith('/api/v1/workspace', expect.anything())
  })
  it('execute({}) POSTs to the viewing project execute route and returns the parsed ExecutionResult', async () => {
    const result = {
      executionId: 'e1',
      status: 'completed',
      outputs: {},
      durationMs: 5,
    }
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/v1/workspace') {
        return new Response(JSON.stringify({ viewingProjectId: 'main', recentProjectIds: ['main'], lastOpenedAt: '' }), { status: 200 })
      }
      return new Response(JSON.stringify(result), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const c = new HttpApiClient({ baseUrl: '', pipelineId: 'main' })
    await c.getWorkspace()
    const r = await c.execute({})
    expect(r.executionId).toBe('e1')
    expect(r.status).toBe('completed')
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/projects/main/execute', expect.objectContaining({ method: 'POST' }))
  })

  it('instantiates native Definitions through the project Scene Script route', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      status: 'ok',
      entityId: 'group-native',
      statementId: 'stmt-native',
      revision: 'rev-2',
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const c = new HttpApiClient({ baseUrl: '', pipelineId: 'main', projectId: 'p1' })

    await expect(c.instantiateNativeDefinition('addBaseGrid', { x: 123, y: 456 })).resolves.toEqual(
      expect.objectContaining({ entityId: 'group-native' }),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/projects/p1/scene-script/definitions/addBaseGrid/instantiate',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ position: { x: 123, y: 456 } }),
      }),
    )
  })

  it('reads revisions and posts canonical Scene Authoring Commands', async () => {
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(
      url.endsWith('/project-info')
        ? { canonical: true, canonicalModule: 'main.scene.ts', projectRevision: 'p1', moduleRevisions: {} }
        : { status: 'ok', projectRevision: 'p2', transaction: { applied: true, rolledBack: false, undoToken: 'u1' } },
    ), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new HttpApiClient({ baseUrl: '', pipelineId: 'main', projectId: 'p1' })

    await expect(client.getSceneAuthoringProjectInfo()).resolves.toMatchObject({ projectRevision: 'p1' })
    const request = {
      expectedProjectRevision: 'p1',
      commands: [{ type: 'ungroup', statementId: 'group-1' }],
    }
    await expect(client.applySceneAuthoringCommands(request)).resolves.toMatchObject({
      projectRevision: 'p2',
      transaction: expect.objectContaining({ undoToken: 'u1' }),
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/projects/p1/scene-script/commands',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(request) }),
    )
  })

  it('posts revision-guarded canonical undo and redo requests', async () => {
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify({
      status: 'ok',
      direction: url.endsWith('/undo') ? 'undo' : 'redo',
      projectRevision: url.endsWith('/undo') ? 'p1' : 'p2',
      history: { cursor: 0, length: 1, canUndo: false, canRedo: true },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new HttpApiClient({ baseUrl: '', pipelineId: 'main', projectId: 'p1' })

    await client.undoSceneAuthoring({ expectedProjectRevision: 'p2' })
    await client.redoSceneAuthoring({ expectedProjectRevision: 'p1' })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/projects/p1/scene-script/undo',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ expectedProjectRevision: 'p2' }) }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/projects/p1/scene-script/redo',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ expectedProjectRevision: 'p1' }) }),
    )
  })

  it('reads a selected Scene Script project file with its revision and source map', async () => {
    const stored = {
      file: 'groups/base.scene.ts',
      source: 'export const base = addBaseGrid({})',
      revision: 'rev-1',
      state: { schemaVersion: 1, sourceRevision: 'rev-1', updatedAt: '', modules: [], sourceMap: [] },
    }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(stored), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new HttpApiClient({ baseUrl: '', pipelineId: 'main', projectId: 'p1' })

    await expect(client.getSceneScriptModule('groups/base.scene.ts')).resolves.toEqual(stored)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/projects/p1/scene-script?file=groups%2Fbase.scene.ts',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('samples pipeline and groups together for semantic diff evidence', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/v1/projects/p1/pipeline') {
        return new Response(JSON.stringify({ id: 'main', hash: 'h1', nodes: {}, edges: {} }), { status: 200 })
      }
      if (url === '/api/v1/projects/p1/groups') {
        return new Response(JSON.stringify([{ id: 'g1', name: 'Group', nodes: [], edges: [] }]), { status: 200 })
      }
      return new Response('null', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const client = new HttpApiClient({ baseUrl: '', pipelineId: 'main', projectId: 'p1' })

    await expect(client.getSceneGraphSample()).resolves.toMatchObject({
      pipeline: { hash: 'h1' },
      groups: [{ id: 'g1' }],
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/projects/p1/pipeline', expect.anything())
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/projects/p1/groups', expect.anything())
  })

  it('saves Scene Script source with expectedRevision', async () => {
    const result = {
      status: 'ok',
      revision: 'rev-2',
      graphHash: 'graph-2',
      diagnostics: [],
      sourceMap: [],
      canonicalSource: 'const grid = addBaseGrid({})\n',
      entityCount: 1,
      operationCount: 1,
    }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(result), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new HttpApiClient({ baseUrl: '', pipelineId: 'main', projectId: 'p1' })

    await client.saveSceneScript({
      file: 'main.scene.ts',
      source: 'const grid=addBaseGrid({})',
      expectedRevision: 'rev-1',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/projects/p1/scene-script',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          file: 'main.scene.ts',
          source: 'const grid=addBaseGrid({})',
          expectedRevision: 'rev-1',
        }),
      }),
    )
  })

  it('posts executable Scene Script drafts with generation metadata', async () => {
    const result = {
      valid: true,
      diagnostics: [],
      previewRevision: 'preview-7',
      projectRevision: 'project-1',
      status: 'visible',
      sync: { aligned: true, previewRevision: 'preview-7', projectRevision: 'project-1' },
    }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(result), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new HttpApiClient({ baseUrl: '', pipelineId: 'main', projectId: 'p1' })
    const request = {
      files: [{ file: 'main.scene.ts', source: 'const scene = emptyScene({})\n' }],
      entryFile: 'main.scene.ts',
      expectedProjectRevision: 'project-1',
      execute: true,
      draftId: 'studio-p1',
      generation: 7,
    }

    await expect(client.executeSceneScriptDraft(request)).resolves.toMatchObject({
      status: 'visible',
      previewRevision: 'preview-7',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/projects/p1/scene-script/draft',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(request) }),
    )
  })

  it('preserves structured 409 conflict details for the Studio', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      reason: 'Scene Script changed since the edit lens was created.',
      code: 'scene-source-revision-conflict',
      expectedRevision: 'rev-local',
      actualRevision: 'rev-remote',
    }), { status: 409 })))
    const client = new HttpApiClient({ baseUrl: '', pipelineId: 'main', projectId: 'p1' })

    const error = await client.saveSceneScript({
      file: 'main.scene.ts',
      source: 'local source',
      expectedRevision: 'rev-local',
    }).catch((caught) => caught)

    expect(error).toBeInstanceOf(SceneScriptRequestError)
    expect(error).toMatchObject({
      status: 409,
      code: 'scene-source-revision-conflict',
      expectedRevision: 'rev-local',
      actualRevision: 'rev-remote',
    })
  })

  it('applies safe diagnostic fixes as revision-guarded authoring commands', async () => {
    const result = {
      status: 'ok',
      revision: 'rev-2',
      graphHash: 'graph-2',
      canonicalSource: 'fixed',
      sourceMap: [],
      diagnostics: [],
      applied: 1,
    }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(result), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new HttpApiClient({ baseUrl: '', pipelineId: 'main', projectId: 'p1' })
    await client.applySceneScriptFix({
      file: 'main.scene.ts',
      expectedRevision: 'rev-1',
      fix: {
        fixId: 'use-latest-rest',
        title: 'Use latest rest',
        edits: [{
          type: 'ReplaceReference',
          statementId: 'decorate',
          argument: 'scene',
          sourceStatementId: 'mountain',
          sourceOutput: 'rest',
        }],
      },
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/projects/p1/scene-script/commands',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          file: 'main.scene.ts',
          expectedRevision: 'rev-1',
          commands: [{
            type: 'connectValue',
            statementId: 'decorate',
            input: 'scene',
            sourceStatementId: 'mountain',
            output: 'rest',
          }],
          label: 'Apply diagnostic fix use-latest-rest',
        }),
      }),
    )
  })

  it('limits diagnostics and preserves transaction details on conflicts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      reason: 'changed',
      code: 'scene-source-revision-conflict',
      expectedRevision: 'rev-1',
      actualRevision: 'rev-2',
      transaction: { applied: false, rolledBack: false },
      diagnostics: Array.from({ length: 6 }, (_, index) => ({
        code: `SCENE_${index}`,
        phase: 'compile',
        severity: 'error',
        message: `error ${index}`,
        fixes: Array.from({ length: 6 }, (__, fixIndex) => ({
          fixId: `fix-${fixIndex}`,
          title: `Fix ${fixIndex}`,
          edits: [],
        })),
      })),
    }), { status: 409 })))
    const client = new HttpApiClient({ baseUrl: '', pipelineId: 'main', projectId: 'p1' })
    const error = await client.saveSceneScript({
      file: 'main.scene.ts',
      source: 'local',
      expectedRevision: 'rev-1',
    }).catch((caught) => caught as SceneScriptRequestError)
    expect(error.diagnostics).toHaveLength(3)
    expect(error.diagnostics[0].fixes).toHaveLength(3)
    expect(error.transaction).toEqual({ applied: false, rolledBack: false })
  })
})
