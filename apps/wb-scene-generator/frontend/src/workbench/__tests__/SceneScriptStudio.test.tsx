/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { SceneScriptRequestError, type HttpApiClient } from '../../api/HttpApiClient.js'

const pipelineMock = vi.hoisted(() => {
  let state = {
    selectedNodeIds: [] as string[],
    requestSelectNodes: vi.fn<(ids: string[]) => void>(),
  }
  const listeners = new Set<() => void>()
  const setSelected = (ids: string[]) => {
    state = { ...state, selectedNodeIds: ids }
    listeners.forEach((listener) => listener())
  }
  state.requestSelectNodes.mockImplementation(setSelected)
  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setSelected,
    reset: () => {
      state.requestSelectNodes.mockClear()
      setSelected([])
    },
  }
})

vi.mock('@forgeax/node-runtime-react/editor', async () => {
  const React = await import('react')
  const usePipelineStore = Object.assign(
    <T,>(selector: (state: ReturnType<typeof pipelineMock.getState>) => T): T =>
      React.useSyncExternalStore(
        pipelineMock.subscribe,
        () => selector(pipelineMock.getState()),
        () => selector(pipelineMock.getState()),
      ),
    { getState: pipelineMock.getState, subscribe: pipelineMock.subscribe },
  )
  return { usePipelineStore }
})

import { SceneScriptStudio } from '../SceneScriptStudio.js'

const capturePreview = vi.fn(async () => ({
  dataUrl: 'data:image/png;base64,before',
  width: 320,
  height: 180,
  capturedAt: '2026-08-11T00:00:00.000Z',
}))

const sourceMap = [
  {
    statementId: 'stmt-grid',
    entityId: 'node-grid',
    runtimeNodeIds: ['runtime-grid'],
    source: { file: 'main.scene.ts', start: 0, end: 10, line: 1, column: 1 },
  },
  {
    statementId: 'stmt-output',
    entityId: 'node-output',
    runtimeNodeIds: [],
    source: { file: 'main.scene.ts', start: 12, end: 24, line: 2, column: 1 },
  },
]

function createClient() {
  const validateImpl = async ({ source }: { source: string }) => ({
    valid: !source.includes('broken'),
    diagnostics: source.includes('broken') ? [{
      code: 'SCENE_PARSE',
      phase: 'parse',
      severity: 'error',
      title: 'Broken syntax',
      message: 'Broken call',
      source: { file: 'main.scene.ts', start: 0, end: 6, line: 1, column: 1, endLine: 1, endColumn: 7, statementId: 'stmt-grid' },
      graph: { authoringNodeId: 'stmt-grid' },
      expected: { syntax: 'call' },
      actual: { syntax: 'broken' },
      transaction: { applied: false, rolledBack: false },
      retryable: true,
      escalation: 'compiler',
      debugAttachment: 'debug/parse-1.json',
      fixes: [{
        fixId: 'use-grid',
        title: 'Use grid reference',
        edits: [{
          type: 'ReplaceReference',
          statementId: 'stmt-output',
          argument: 'scene',
          sourceStatementId: 'stmt-grid',
        }],
      }],
    }] : [],
    canonicalSource: source,
    sourceMap,
    entityCount: 2,
    operationCount: 2,
  })
  return {
    subscribe: vi.fn((_channel: string, _listener: (event: { kind: string }) => void) => () => {}),
    getSceneScriptProjectInfo: vi.fn(async () => ({
      projectId: 'p1',
      canonicalModule: 'main.scene.ts',
      revision: 'rev-1',
      moduleCount: 2,
      sourceMapEntries: 2,
      updatedAt: null,
      files: [
        { path: 'main.scene.ts', kind: 'module', bytes: 30, updatedAt: '' },
        { path: 'groups/base.scene.ts', kind: 'module', bytes: 20, updatedAt: '' },
      ],
    })),
    getSceneScriptModule: vi.fn(async (file: string) => ({
      file,
      source: file === 'main.scene.ts' ? 'gridCall()\noutputCall()\n' : 'baseCall()\n',
      revision: file === 'main.scene.ts' ? 'rev-1' : 'rev-base',
      state: {
        schemaVersion: 1,
        sourceRevision: 'rev-1',
        updatedAt: '',
        modules: ['main.scene.ts', 'groups/base.scene.ts'],
        sourceMap: file === 'main.scene.ts' ? sourceMap : [],
      },
    })),
    validateSceneScript: vi.fn(validateImpl),
    executeSceneScriptDraft: vi.fn(async (request: {
      files: Array<{ file: string; source: string }>
      entryFile: string
      expectedProjectRevision: string
      generation: number
    }) => {
      const validation = await validateImpl({
        source: request.files.find((item) => item.file === request.entryFile)?.source ?? '',
      })
      return {
        valid: validation.valid,
        diagnostics: validation.diagnostics,
        status: validation.valid ? 'visible' : 'failed',
        previewRevision: validation.valid ? `preview-${request.generation}` : null,
        projectRevision: request.expectedProjectRevision,
        sync: {
          aligned: validation.valid,
          previewRevision: validation.valid ? `preview-${request.generation}` : null,
          projectRevision: request.expectedProjectRevision,
        },
        lastGood: validation.valid ? undefined : { previewRevision: 'preview-last-good' },
      }
    }),
    saveSceneScript: vi.fn(async ({ source }: { source: string }) => ({
      status: 'ok',
      revision: 'rev-2',
      graphHash: 'graph-2',
      diagnostics: [],
      sourceMap,
      canonicalSource: source,
      entityCount: 2,
      operationCount: 2,
    })),
    execute: vi.fn(async () => ({
      executionId: 'exec-2',
      status: 'completed',
      durationMs: 12,
      outputs: {},
    })),
    getRendererInfo: vi.fn(async () => ({
      sync: { executionId: 'exec-2', executionStatus: 'completed', aligned: true, staleReasons: [] },
    })),
    getSceneGraphSample: vi.fn()
      .mockResolvedValueOnce({
        pipeline: {
          id: 'main',
          hash: 'graph-1',
          createdAt: '',
          updatedAt: '',
          nodes: {
            'node-grid': { id: 'node-grid', opId: 'grid', position: { x: 0, y: 0 }, params: { size: 8 } },
          },
          edges: {},
        },
        groups: [],
      })
      .mockResolvedValue({
        pipeline: {
          id: 'main',
          hash: 'graph-2',
          createdAt: '',
          updatedAt: '',
          nodes: {
            'node-grid': { id: 'node-grid', opId: 'grid', position: { x: 0, y: 0 }, params: { size: 12 } },
            'node-output': { id: 'node-output', opId: 'output', position: { x: 10, y: 0 }, params: {} },
          },
          edges: {
            e1: {
              id: 'e1',
              source: { nodeId: 'node-grid', port: 'grid' },
              target: { nodeId: 'node-output', port: 'scene' },
            },
          },
        },
        groups: [],
      }),
    applySceneScriptFix: vi.fn(async () => ({
      status: 'ok',
      revision: 'rev-fixed',
      graphHash: 'graph-fixed',
      diagnostics: [],
      sourceMap,
      canonicalSource: 'gridCall()\nfixedOutput()\n',
      applied: 1,
      transaction: { applied: true, rolledBack: false, undoToken: 'batch-fix' },
    })),
  }
}

beforeEach(() => {
  pipelineMock.reset()
  capturePreview.mockClear()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 1
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('SceneScriptStudio', () => {
  it('offers a wider editor mode and keeps diagnostics collapsible', async () => {
    const client = createClient()
    const onToggleExpanded = vi.fn()
    render(
      <SceneScriptStudio
        client={client as unknown as HttpApiClient}
        projectId="p1"
        capturePreview={capturePreview}
        onToggleExpanded={onToggleExpanded}
      />,
    )

    await screen.findByRole('textbox', { name: 'Scene Script source' })
    fireEvent.click(screen.getByRole('button', { name: 'Expand Scene Script editor' }))
    expect(onToggleExpanded).toHaveBeenCalledOnce()

    const diagnostics = screen.getByRole('button', { name: /Diagnostics/ })
    expect(diagnostics.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(diagnostics)
    expect(diagnostics.getAttribute('aria-expanded')).toBe('true')
  })

  it('loads and switches editable project Scene Script files', async () => {
    const client = createClient()
    render(<SceneScriptStudio client={client as unknown as HttpApiClient} projectId="p1" capturePreview={capturePreview} />)

    const editor = await screen.findByRole('textbox', { name: 'Scene Script source' }) as HTMLTextAreaElement
    await waitFor(() => expect(editor.value).toContain('gridCall'))

    fireEvent.change(screen.getByLabelText('Scene Script project file'), {
      target: { value: 'groups/base.scene.ts' },
    })
    await waitFor(() => expect(editor.value).toBe('baseCall()\n'))
    expect(client.getSceneScriptModule).toHaveBeenLastCalledWith('groups/base.scene.ts', 'p1')
  })

  it('opens canonical module initially', async () => {
    const client = createClient()
    client.getSceneScriptProjectInfo.mockResolvedValue({
      projectId: 'p1',
      canonicalModule: 'main.scene.ts',
      revision: 'rev-1',
      moduleCount: 2,
      sourceMapEntries: 2,
      updatedAt: null,
      files: [
        { path: 'main.scene.ts', kind: 'module', bytes: 30, updatedAt: '' },
        { path: 'valley.scene.ts', kind: 'module', bytes: 40, updatedAt: '' },
      ],
    })
    client.getSceneScriptModule.mockImplementation(async (file: string) => ({
      file,
      source: file === 'valley.scene.ts' ? 'export const valley = emptyScene({})\n' : 'gridCall()\noutputCall()\n',
      revision: 'rev-1',
      state: {
        schemaVersion: 1,
        sourceRevision: 'rev-1',
        updatedAt: '',
        modules: ['main.scene.ts', 'valley.scene.ts'],
        sourceMap,
      },
    }))
    render(<SceneScriptStudio client={client as unknown as HttpApiClient} projectId="p1" capturePreview={capturePreview} />)
    const editor = await screen.findByRole('textbox', { name: 'Scene Script source' }) as HTMLTextAreaElement
    await waitFor(() => expect(editor.value).toContain('gridCall()'))
    expect(client.getSceneScriptModule).toHaveBeenCalledWith('main.scene.ts', 'p1')
  })

  it('shows parse diagnostics and selects their source range', async () => {
    const client = createClient()
    render(<SceneScriptStudio client={client as unknown as HttpApiClient} projectId="p1" capturePreview={capturePreview} />)
    const editor = await screen.findByRole('textbox', { name: 'Scene Script source' }) as HTMLTextAreaElement
    await waitFor(() => expect(editor.value).toContain('gridCall'))

    fireEvent.change(editor, { target: { value: 'broken()' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))

    const diagnostic = await screen.findByRole('button', { name: /Broken call/ })
    fireEvent.click(diagnostic)
    expect(editor.selectionStart).toBe(0)
    expect(editor.selectionEnd).toBe(6)
    expect(pipelineMock.getState().requestSelectNodes).toHaveBeenCalledWith(['node-grid'])
    expect(screen.getByText('Expected')).toBeTruthy()
    expect(screen.getByText('{"syntax":"call"}')).toBeTruthy()
    expect(screen.getByText(/applied=false/)).toBeTruthy()
    expect(screen.getByText('true')).toBeTruthy()
    expect(screen.getByText('compiler')).toBeTruthy()
    expect(screen.getByText('debug/parse-1.json').closest('code')).toBeTruthy()
  })

  it('debounces executable drafts and shows preview/project revisions', async () => {
    const client = createClient()
    render(<SceneScriptStudio client={client as unknown as HttpApiClient} projectId="p1" capturePreview={capturePreview} />)
    const editor = await screen.findByRole('textbox', { name: 'Scene Script source' }) as HTMLTextAreaElement
    await waitFor(() => expect(editor.value).toContain('gridCall'))

    fireEvent.change(editor, { target: { value: 'draftScene()\n' } })
    await waitFor(() => expect(client.executeSceneScriptDraft).toHaveBeenCalledOnce(), { timeout: 1500 })
    expect(client.executeSceneScriptDraft).toHaveBeenCalledWith(expect.objectContaining({
      files: [{ file: 'main.scene.ts', source: 'draftScene()\n' }],
      entryFile: 'main.scene.ts',
      expectedProjectRevision: 'rev-1',
      execute: true,
      generation: expect.any(Number),
      draftId: expect.stringContaining('studio-p1-'),
    }), 'p1')
    expect(await screen.findByText(/Draft · visible · preview preview-/)).toBeTruthy()
    expect(screen.getByText(/project rev-1/)).toBeTruthy()
  })

  it('keeps draft execution single-flight and runs only the latest queued generation', async () => {
    const client = createClient()
    let resolveFirst!: (value: {
      valid: boolean
      diagnostics: never[]
      status: 'visible'
      previewRevision: string
      projectRevision: string
      sync: { aligned: boolean; previewRevision: string; projectRevision: string }
      lastGood: undefined
    }) => void
    const first = new Promise<{
      valid: boolean
      diagnostics: never[]
      status: 'visible'
      previewRevision: string
      projectRevision: string
      sync: { aligned: boolean; previewRevision: string; projectRevision: string }
      lastGood: undefined
    }>((resolve) => { resolveFirst = resolve })
    client.executeSceneScriptDraft.mockImplementationOnce(() => first)
    render(<SceneScriptStudio client={client as unknown as HttpApiClient} projectId="p1" capturePreview={capturePreview} />)
    const editor = await screen.findByRole('textbox', { name: 'Scene Script source' }) as HTMLTextAreaElement
    await waitFor(() => expect(editor.value).toContain('gridCall'))

    fireEvent.change(editor, { target: { value: 'draftOne()\n' } })
    await waitFor(() => expect(client.executeSceneScriptDraft).toHaveBeenCalledOnce(), { timeout: 1500 })
    fireEvent.change(editor, { target: { value: 'draftTwo()\n' } })
    await new Promise((resolve) => setTimeout(resolve, 550))
    expect(client.executeSceneScriptDraft).toHaveBeenCalledTimes(1)

    resolveFirst({
      valid: true,
      diagnostics: [],
      status: 'visible',
      previewRevision: 'preview-old',
      projectRevision: 'rev-1',
      sync: { aligned: true, previewRevision: 'preview-old', projectRevision: 'rev-1' },
      lastGood: undefined,
    })
    await waitFor(() => expect(client.executeSceneScriptDraft).toHaveBeenCalledTimes(2))
    expect(client.executeSceneScriptDraft.mock.calls[1][0]).toMatchObject({
      files: [{ file: 'main.scene.ts', source: 'draftTwo()\n' }],
    })
  })

  it('reports a failed draft while keeping the last-good preview hint', async () => {
    const client = createClient()
    client.executeSceneScriptDraft.mockResolvedValueOnce({
      valid: false,
      diagnostics: [],
      status: 'failed',
      previewRevision: null,
      projectRevision: 'rev-1',
      sync: { aligned: false, previewRevision: null, projectRevision: 'rev-1' },
      lastGood: { previewRevision: 'good-123' },
    })
    render(<SceneScriptStudio client={client as unknown as HttpApiClient} projectId="p1" capturePreview={capturePreview} />)
    const editor = await screen.findByRole('textbox', { name: 'Scene Script source' }) as HTMLTextAreaElement
    await waitFor(() => expect(editor.value).toContain('gridCall'))

    fireEvent.change(editor, { target: { value: 'broken draft\n' } })
    expect(await screen.findByText(/last good good-123 still visible/, {}, { timeout: 1500 })).toBeTruthy()
    expect(screen.getByText(/last good preview remains visible/i)).toBeTruthy()
  })

  it('applies a safe structured fix with expectedRevision', async () => {
    const client = createClient()
    render(<SceneScriptStudio client={client as unknown as HttpApiClient} projectId="p1" capturePreview={capturePreview} />)
    const editor = await screen.findByRole('textbox', { name: 'Scene Script source' }) as HTMLTextAreaElement
    await waitFor(() => expect(editor.value).toContain('gridCall'))
    fireEvent.change(editor, { target: { value: 'broken()' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))

    fireEvent.click(await screen.findByRole('button', { name: 'Fix: Use grid reference' }))
    await waitFor(() => expect(editor.value).toContain('fixedOutput'))
    expect(client.applySceneScriptFix).toHaveBeenCalledWith(expect.objectContaining({
      file: 'main.scene.ts',
      expectedRevision: 'rev-1',
      fix: expect.objectContaining({ fixId: 'use-grid' }),
    }), 'p1')
  })

  it('keeps local text when a structured fix gets a 409', async () => {
    const client = createClient()
    client.applySceneScriptFix.mockRejectedValueOnce(new SceneScriptRequestError(409, {
      reason: 'changed remotely',
      code: 'scene-source-revision-conflict',
      expectedRevision: 'rev-1',
      actualRevision: 'rev-remote',
      transaction: { applied: false, rolledBack: false },
    }))
    render(<SceneScriptStudio client={client as unknown as HttpApiClient} projectId="p1" capturePreview={capturePreview} />)
    const editor = await screen.findByRole('textbox', { name: 'Scene Script source' }) as HTMLTextAreaElement
    await waitFor(() => expect(editor.value).toContain('gridCall'))
    fireEvent.change(editor, { target: { value: 'broken()' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Fix: Use grid reference' }))

    await screen.findByRole('alert')
    expect(editor.value).toBe('broken()')
    expect(screen.getByText(/not overwritten/)).toBeTruthy()
  })

  it('shows draft text diff and accepted graph/real-preview evidence for one Save transaction', async () => {
    const client = createClient()
    capturePreview
      .mockResolvedValueOnce({
        dataUrl: 'data:image/png;base64,before',
        width: 320,
        height: 180,
        capturedAt: '2026-08-11T00:00:00.000Z',
      })
      .mockResolvedValueOnce({
        dataUrl: 'data:image/png;base64,after',
        width: 320,
        height: 180,
        capturedAt: '2026-08-11T00:00:01.000Z',
      })
    render(<SceneScriptStudio client={client as unknown as HttpApiClient} projectId="p1" capturePreview={capturePreview} />)
    const editor = await screen.findByRole('textbox', { name: 'Scene Script source' }) as HTMLTextAreaElement
    await waitFor(() => expect(editor.value).toContain('gridCall'))

    fireEvent.change(editor, { target: { value: 'gridCall({ size: 12 })\noutputCall()\n' } })
    fireEvent.click(screen.getByRole('button', { name: /Diff/ }))
    expect(screen.getByText(/Current draft text/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText(/Saved, executed, and captured/)

    expect(client.execute).toHaveBeenCalled()
    expect(client.getRendererInfo).toHaveBeenCalled()
    expect(capturePreview).toHaveBeenCalledTimes(2)
    expect(client.getSceneGraphSample).toHaveBeenCalledTimes(2)
    expect(screen.getByText(/rev-1 → rev-2/)).toBeTruthy()
    expect(screen.getByText('Renderer preview · changed')).toBeTruthy()
    expect(screen.getByText(/entity: \+1 −0 ~1/)).toBeTruthy()
    expect(screen.getByAltText('before Renderer preview').getAttribute('src')).toContain('before')
    expect(screen.getByAltText('after Renderer preview').getAttribute('src')).toContain('after')

    const acceptedTransaction = screen.getByText(/save-/).textContent
    client.saveSceneScript.mockRejectedValueOnce(new SceneScriptRequestError(409, {
      reason: 'changed remotely',
      code: 'scene-source-revision-conflict',
      expectedRevision: 'rev-2',
      actualRevision: 'rev-remote',
    }))
    fireEvent.change(editor, { target: { value: 'anotherLocalEdit()\n' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('alert')
    expect(screen.getByText(/save-/).textContent).toBe(acceptedTransaction)
    expect(screen.getByAltText('after Renderer preview').getAttribute('src')).toContain('after')
  })

  it('saves with expectedRevision and leaves local text intact on 409', async () => {
    const client = createClient()
    client.saveSceneScript.mockRejectedValueOnce(new SceneScriptRequestError(409, {
      reason: 'changed remotely',
      code: 'scene-source-revision-conflict',
      expectedRevision: 'rev-1',
      actualRevision: 'rev-remote',
    }))
    render(<SceneScriptStudio client={client as unknown as HttpApiClient} projectId="p1" capturePreview={capturePreview} />)
    const editor = await screen.findByRole('textbox', { name: 'Scene Script source' }) as HTMLTextAreaElement
    await waitFor(() => expect(editor.value).toContain('gridCall'))

    fireEvent.change(editor, { target: { value: 'localCall()\n' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await screen.findByRole('alert')
    expect(editor.value).toBe('localCall()\n')
    expect(client.saveSceneScript).toHaveBeenCalledWith(expect.objectContaining({
      file: 'main.scene.ts',
      source: 'localCall()\n',
      expectedRevision: 'rev-1',
    }), 'p1')
    expect(screen.getByText(/Local text is preserved/)).toBeTruthy()
  })

  it('reloads source when the canvas commits a graph:applied edit', async () => {
    const client = createClient()
    render(<SceneScriptStudio client={client as unknown as HttpApiClient} projectId="p1" capturePreview={capturePreview} />)
    const editor = await screen.findByRole('textbox', { name: 'Scene Script source' }) as HTMLTextAreaElement
    await waitFor(() => expect(editor.value).toContain('gridCall'))

    client.getSceneScriptModule.mockImplementation(async (file: string) => ({
      file,
      source: 'const n = cellularNoise({})\n',
      revision: 'rev-live',
      state: {
        schemaVersion: 1,
        sourceRevision: 'rev-live',
        updatedAt: '',
        modules: ['main.scene.ts'],
        sourceMap,
      },
    }))
    const listener = client.subscribe.mock.calls.find((call) => call[0] === 'graph')?.[1] as
      | ((event: { kind: string }) => void)
      | undefined
    expect(listener).toBeTruthy()
    listener!({ kind: 'graph:applied' })
    await waitFor(() => expect(editor.value).toContain('cellularNoise'), { timeout: 1500 })
  })

  it('keeps unsaved Studio text when the canvas updates Scene Script', async () => {
    const client = createClient()
    render(<SceneScriptStudio client={client as unknown as HttpApiClient} projectId="p1" capturePreview={capturePreview} />)
    const editor = await screen.findByRole('textbox', { name: 'Scene Script source' }) as HTMLTextAreaElement
    await waitFor(() => expect(editor.value).toContain('gridCall'))
    fireEvent.change(editor, { target: { value: 'localDraft()\n' } })

    const listener = client.subscribe.mock.calls.find((call) => call[0] === 'graph')?.[1] as
      | ((event: { kind: string }) => void)
      | undefined
    expect(listener).toBeTruthy()
    listener!({ kind: 'graph:applied' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy(), { timeout: 1500 })
    expect(editor.value).toBe('localDraft()\n')
  })

  it('bridges code cursor and Authoring node selection in both directions', async () => {
    const client = createClient()
    render(<SceneScriptStudio client={client as unknown as HttpApiClient} projectId="p1" capturePreview={capturePreview} />)
    const editor = await screen.findByRole('textbox', { name: 'Scene Script source' }) as HTMLTextAreaElement
    await waitFor(() => expect(editor.value).toContain('gridCall'))

    editor.setSelectionRange(3, 3)
    fireEvent.keyUp(editor)
    expect(pipelineMock.getState().requestSelectNodes).toHaveBeenCalledWith(['node-grid'])

    pipelineMock.setSelected(['node-output'])
    await waitFor(() => {
      expect(editor.selectionStart).toBe(12)
      expect(editor.selectionEnd).toBe(24)
    })
  })
})
