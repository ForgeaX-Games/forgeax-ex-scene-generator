// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'

// Stub the kernel editor module the left pane mounts (ProjectPanel + transport +
// project store), so the test exercises only the Open/Save wiring. Open now
// lives in the panel header (headerActions) and Save is a per-project action
// (renderProjectActions), so the ProjectPanel mock renders both slots.
const createProject = vi.fn().mockResolvedValue({ id: 'p2', name: 'asset', type: 'asset2d' })
const switchProject = vi.fn().mockResolvedValue(undefined)
const PROJECTS = [{ id: 'p1', name: 'My Asset Workspace', type: 'asset2d' }]

vi.mock('@forgeax/node-runtime-react/editor', () => ({
  ProjectPanel: ({
    headerActions,
    renderProjectActions,
  }: {
    headerActions?: React.ReactNode
    renderProjectActions?: (p: { id: string; name: string; type: string }) => React.ReactNode
  }) => (
    <div data-testid="project-panel">
      {headerActions}
      {PROJECTS.map((p) => (
        <div key={p.id}>{renderProjectActions?.(p)}</div>
      ))}
    </div>
  ),
  configureEditorTransport: vi.fn(),
  createEditorTransport: () => ({ dispose: vi.fn() }),
  useProjectStore: {
    getState: () => ({
      fetchProjects: vi.fn().mockResolvedValue(undefined),
      subscribeProjectActivation: () => () => {},
      projects: PROJECTS,
      viewingProjectId: 'p1',
      createProject,
      switchProject,
    }),
  },
}))
// The lower-half controls panel is unrelated to Open/Save — stub it out.
vi.mock('../SceneGeneratorControlsPanel', () => ({ SceneGeneratorControlsPanel: () => null }))

import { WorkbenchLeftPane } from '../WorkbenchLeftPane'
import type { HttpApiClient } from '../../api/HttpApiClient'

const SAMPLE_GRAPH = {
  id: 'main',
  nodes: { n1: { id: 'n1', opId: 'image_resize' } },
  edges: {},
}

function fakeClient(over: Partial<HttpApiClient> = {}): HttpApiClient {
  return {
    subscribe: () => () => {},
    async listProjects() { return [] },
    async getWorkspace() { return { viewingProjectId: 'p1', recentProjectIds: ['p1'], lastOpenedAt: '' } },
    async listOps() { return [] },
    async listNodes() { return [] },
    async getPipeline() { return SAMPLE_GRAPH },
    async listGroups() { return [] },
    importPipelineInline: vi.fn().mockResolvedValue({ status: 'ok', executed: true }),
    ...over,
  } as unknown as HttpApiClient
}

// jsdom (this version) does not implement Blob/File .text(); the component relies
// on the standard File.text() that real browsers ship. Provide minimal fakes that
// preserve the string parts so both the component and assertions can read them.
class FakeBlob {
  parts: unknown[]
  type: string
  constructor(parts: unknown[] = [], opts: { type?: string } = {}) {
    this.parts = parts
    this.type = opts.type ?? ''
  }
  text(): Promise<string> {
    return Promise.resolve(this.parts.map((p) => (typeof p === 'string' ? p : '')).join(''))
  }
}
class FakeFile extends FakeBlob {
  name: string
  constructor(parts: unknown[], name: string, opts: { type?: string } = {}) {
    super(parts, opts)
    this.name = name
  }
}

beforeEach(() => {
  createProject.mockClear()
  switchProject.mockClear()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  )
  // Open reads the uploaded file via File.text(), which this jsdom build lacks.
  vi.stubGlobal('File', FakeFile)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('WorkbenchLeftPane — Open / Save', () => {
  it('renders the Open icon button (panel header) and a per-project Save', async () => {
    const { getByText, getByLabelText } = render(<WorkbenchLeftPane client={fakeClient()} />)
    await waitFor(() => {
      expect(getByLabelText('Open an asset graph JSON as a new project')).toBeTruthy()
      expect(getByText('Save')).toBeTruthy()
    })
  })

  it('Save shows the project canvas as copyable kernel-graph-v1 JSON (iframe sandbox blocks download)', async () => {
    const { getByText, container } = render(<WorkbenchLeftPane client={fakeClient()} />)
    await act(async () => {
      fireEvent.click(getByText('Save'))
    })
    const textarea = await waitFor(() => {
      const el = container.querySelector('.scene-left-pane__save-json') as HTMLTextAreaElement | null
      if (!el) throw new Error('save modal not shown')
      return el
    })
    // The surfaced text is a re-importable kernel-graph-v1 wrapper named after
    // the project (it is the active one here → no switch needed).
    expect(switchProject).not.toHaveBeenCalled()
    expect(JSON.parse(textarea.value)).toMatchObject({
      format: 'kernel-graph-v1',
      name: 'My Asset Workspace',
      graph: { nodes: { n1: {} } },
    })
  })

  it('Open creates a new project named after the file, then imports the JSON into it', async () => {
    const client = fakeClient()
    const { container } = render(<WorkbenchLeftPane client={client} />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(
      [JSON.stringify({ format: 'kernel-graph-v1', name: 'Saved Asset', graph: SAMPLE_GRAPH })],
      'asset.json',
      { type: 'application/json' },
    )
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await act(async () => {
      fireEvent.change(input)
    })
    await waitFor(() => {
      expect(client.importPipelineInline as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1)
    })
    // A new project is created (prefers the wrapper's saved name) and opened,
    // BEFORE the graph is imported into it.
    expect(createProject).toHaveBeenCalledWith({ type: 'asset2d', name: 'Saved Asset' })
    const arg = (client.importPipelineInline as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg.options.mode).toBe('replace')
    expect(arg.graph).toMatchObject({ nodes: { n1: {} } })
  })

  it('Open falls back to the filename (sans extension) when the file has no name', async () => {
    const client = fakeClient()
    const { container } = render(<WorkbenchLeftPane client={client} />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([JSON.stringify({ graph: SAMPLE_GRAPH })], 'my-room.json', { type: 'application/json' })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await act(async () => {
      fireEvent.change(input)
    })
    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith({ type: 'asset2d', name: 'my-room' })
    })
  })
})
