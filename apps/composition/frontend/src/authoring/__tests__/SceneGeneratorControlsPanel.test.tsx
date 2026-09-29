/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { EditorMirrorSnapshot } from '@forgeax/node-runtime-react/editor'
import { ensureSceneI18n } from '../../sceneI18n.js'
import { publishSceneScriptDiagnostics } from '../sceneScriptDiagnosticBridge.js'

const { useProjectStoreMock } = vi.hoisted(() => {
  HTMLCanvasElement.prototype.getContext = (() => ({
    measureText: (text: string) => ({ width: text.length * 8 }),
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext

  const state = { viewingProjectId: null as string | null }
  const useProjectStoreMock = Object.assign(
    (selector: (s: typeof state) => unknown) => selector(state),
    {
      setState: (partial: Partial<typeof state>) => {
        Object.assign(state, partial)
      },
    },
  )
  return { useProjectStoreMock }
})

const mirrorRef: { current: EditorMirrorSnapshot | null } = { current: null }
const sendCommand = vi.fn()

vi.mock('../useEditorMirror.js', () => ({
  useEditorMirror: () => ({
    mirror: mirrorRef.current,
    bridgeRef: { current: { sendCommand } },
  }),
}))

vi.mock('@forgeax/node-runtime-react/editor', () => ({
  SettingsHistoryPanel: () => <div>History panel</div>,
  SettingsDataTypesPanel: () => <div>Data types panel</div>,
  getPortTypeColor: () => '#888888',
  useProjectStore: useProjectStoreMock,
}))

import { NodeInfoDashboard, SceneGeneratorControlsPanel } from '../SceneGeneratorControlsPanel.js'

beforeEach(() => {
  localStorage.clear()
  ensureSceneI18n()
  mirrorRef.current = null
  sendCommand.mockReset()
  useProjectStoreMock.setState({ viewingProjectId: null })
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    disconnect(): void {}
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('SceneGeneratorControlsPanel Node Info', () => {
  it('renders the Node Info section in the left pane with scene i18n labels', () => {
    const { container } = render(<SceneGeneratorControlsPanel syncKey="test-sync" />)

    expect(screen.getByText('Node Info')).toBeTruthy()
    expect(screen.getByText('Click a battery on the canvas to inspect its connections.')).toBeTruthy()
    const stats = container.querySelector('.scene-node-info__stats')
    expect(stats?.textContent).toContain('0 Batteries')
    expect(stats?.textContent).toContain('0 Links')
  })

  it('shows canvas stats and empty selection copy from the shared mirror', () => {
    mirrorRef.current = {
      history: { entries: [], cursor: 0 },
      status: {
        connectionStatus: 'connected',
        pipelineStatus: 'idle',
        selectedNodeName: 'Echo',
        selectedNodeBatteryId: 'demo.echo',
        nodeCount: 3,
        edgeCount: 2,
      },
      stats: {
        batteryCount: 3,
        edgeCount: 2,
        groupCount: 1,
        annotationCount: 0,
        frameCount: 0,
        selectedCount: 1,
      },
      selectedNode: null,
    }

    const { container } = render(<SceneGeneratorControlsPanel syncKey="test-sync" />)

    const stats = container.querySelector('.scene-node-info__stats')
    expect(stats?.textContent).toContain('3 Batteries')
    expect(stats?.textContent).toContain('2 Links')
    expect(stats?.textContent).toContain('1 Groups')
    expect(stats?.textContent).toContain('1 Selected')
    expect(screen.getByText('Click a battery on the canvas to inspect its connections.')).toBeTruthy()
  })

  it('keeps History, Data Types, and Help reachable in the new Node Info card', () => {
    render(<NodeInfoDashboard syncKey="test-sync" />)

    fireEvent.click(screen.getByRole('tab', { name: 'History' }))
    expect(screen.getByText('History panel')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Data Types' }))
    expect(screen.getByText('Data types panel')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Help' }))
    expect(screen.getByText('Build a scene')).toBeTruthy()
  })

  it('shows the selected project script tree in its own tab', async () => {
    const client = {
      getSceneScriptProjectInfo: vi.fn().mockResolvedValue({
        projectId: 'atomic-pilot',
        canonicalModule: 'main.scene.ts',
        revision: 'r1',
        moduleCount: 2,
        sourceMapEntries: 15,
        updatedAt: '2026-08-10T13:49:03.754Z',
        files: [
          { path: 'main.scene.ts', kind: 'module', bytes: 1200, updatedAt: '2026-08-10T13:49:03.754Z' },
          { path: 'pilots/atomic-pilot.scene.ts', kind: 'module', bytes: 1200, updatedAt: '2026-08-10T13:49:03.754Z' },
        ],
      }),
    }
    render(<NodeInfoDashboard syncKey="test-sync" client={client as never} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Project' }))
    await waitFor(() => expect(screen.getByText('atomic-pilot')).toBeTruthy())
    expect(screen.getByText('pilots/atomic-pilot.scene.ts')).toBeTruthy()
    expect(screen.getByText('15')).toBeTruthy()
  })

  it('shows the same statement diagnostic code for the selected Node Info entity', async () => {
    const { useProjectStore } = await import('@forgeax/node-runtime-react/editor')
    useProjectStore.setState({ viewingProjectId: 'p1' })
    mirrorRef.current = {
      history: { entries: [], cursor: 0 },
      status: {
        connectionStatus: 'connected',
        pipelineStatus: 'idle',
        selectedNodeName: 'Grid',
        selectedNodeBatteryId: 'grid',
        nodeCount: 1,
        edgeCount: 0,
      },
      stats: {
        batteryCount: 1,
        edgeCount: 0,
        groupCount: 0,
        annotationCount: 0,
        frameCount: 0,
        selectedCount: 1,
      },
      selectedNode: {
        id: 'node-grid',
        name: 'Grid',
        batteryId: 'grid',
        inputs: [],
        outputs: [],
      },
    }
    publishSceneScriptDiagnostics('p1', [{
      code: 'SCENE_TYPE_MISMATCH',
      phase: 'type',
      severity: 'error',
      message: 'Wrong type',
      graph: { authoringNodeId: 'stmt-grid' },
    }], [{
      statementId: 'stmt-grid',
      entityId: 'node-grid',
      runtimeNodeIds: ['runtime-grid'],
      source: { file: 'main.scene.ts', start: 0, end: 10, line: 1, column: 1 },
    }])

    render(<NodeInfoDashboard syncKey="test-sync" />)
    fireEvent.click(screen.getByRole('tab', { name: 'Node Info' }))
    expect(screen.getByLabelText('Selected node Scene Script diagnostics').textContent).toContain('SCENE_TYPE_MISMATCH')
    expect(screen.getByLabelText('Selected node Scene Script diagnostics').textContent).toContain('Wrong type')
  })

  it('shows schema: voxel in Node Info when the selected battery outputs a scene port', () => {
    mirrorRef.current = {
      history: { entries: [], cursor: 0 },
      status: {
        connectionStatus: 'connected',
        pipelineStatus: 'idle',
        selectedNodeName: 'sceneOutput',
        selectedNodeBatteryId: 'scene_output',
        nodeCount: 1,
        edgeCount: 0,
      },
      stats: {
        batteryCount: 1,
        edgeCount: 0,
        groupCount: 0,
        annotationCount: 0,
        frameCount: 0,
        selectedCount: 1,
      },
      selectedNode: {
        id: 'node-scene-output',
        name: 'sceneOutput',
        batteryId: 'scene_output',
        inputs: [],
        outputs: [{ name: 'scene', type: 'scene', peers: [] }],
      },
    }
    render(<NodeInfoDashboard syncKey="test-sync" />)
    fireEvent.click(screen.getByRole('tab', { name: 'Node Info' }))
    const schema = screen.getByText('schema: voxel')
    expect(schema.getAttribute('data-content-schema')).toBe('voxel')
  })
})
