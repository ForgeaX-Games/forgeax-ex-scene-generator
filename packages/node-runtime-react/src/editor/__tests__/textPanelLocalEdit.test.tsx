// Typing into a Panel writes to the store silently; the ReactFlow `data.params`
// prop only refreshes on a committed snapshot rebuild, so it can still carry the
// pre-edit text when editing ends. Leaving edit mode must not re-apply that
// stale prop over what the user just typed (which also emptied the
// "save as preset" source text).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'

import TextPanelNode from '../components/canvas/TextPanelNode.js'
import { usePipelineStore } from '../stores/pipelineStore.js'
import { useUIStore } from '../stores/uiStore.js'
import type { Battery, Pipeline } from '../types.js'

const panelBattery: Battery = {
  id: 'text_panel',
  name: '文本面板',
  nameEn: 'Panel',
  type: 'input',
  category: 'input',
  description: '',
  version: '1.0.0',
  inputs: [{ name: 'input', type: 'any' }],
  outputs: [{ name: 'output', type: 'string' }],
  params: [],
}

function pipelineWithPanel(): Pipeline {
  const now = new Date().toISOString()
  return {
    id: 'p-root',
    name: 'root',
    description: '',
    nodes: [
      { id: 'panel-1', batteryId: 'text_panel', name: 'Panel', position: { x: 0, y: 0 }, params: {} },
    ],
    edges: [],
    groups: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    status: 'idle',
    createdAt: now,
    updatedAt: now,
  } as Pipeline
}

function renderPanel() {
  // `params` is deliberately the stale (empty) snapshot prop, as ReactFlow keeps
  // it until the next committed rebuild.
  return render(
    <ReactFlowProvider>
      <TextPanelNode
        id="panel-1"
        data={{ battery: panelBattery, params: {} }}
        selected={false}
        dragging={false}
      />
    </ReactFlowProvider>,
  )
}

describe('TextPanelNode local editing', () => {
  beforeEach(() => {
    usePipelineStore.setState({
      batteries: [panelBattery],
      categories: [],
      currentPipeline: pipelineWithPanel(),
      sessionRestorePending: null,
      pipelineStatus: 'idle',
      selectedNode: null,
      selectedNodeIds: [],
      logs: [],
      nodeOutputs: {},
      dynamicOutputPorts: {},
      groupViewStack: [],
    })
    vi.spyOn(usePipelineStore.getState(), 'incrementalExecute').mockResolvedValue(undefined)
  })

  it('keeps the typed text after leaving edit mode', () => {
    const { container } = renderPanel()
    const body = container.querySelector('.text-panel-body') as HTMLElement
    act(() => { fireEvent.doubleClick(body) })
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    act(() => { fireEvent.change(textarea, { target: { value: 'hello panel' } }) })
    act(() => { fireEvent.blur(textarea) })

    expect(container.textContent).toContain('hello panel')
    expect(container.querySelector('.text-panel-placeholder')).toBeNull()
    const stored = usePipelineStore.getState().currentPipeline?.nodes[0]?.params.text
    expect(stored).toBe('hello panel')
  })

  it('saves the typed text as a preset after leaving edit mode', () => {
    useUIStore.setState({ textPresets: [] })
    const { container } = renderPanel()
    const body = container.querySelector('.text-panel-body') as HTMLElement
    act(() => { fireEvent.doubleClick(body) })
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    act(() => { fireEvent.change(textarea, { target: { value: 'preset body' } }) })
    act(() => { fireEvent.blur(textarea) })

    const saveBtn = container.querySelector('.text-panel-save-btn') as HTMLButtonElement
    act(() => { fireEvent.click(saveBtn) })
    const titleInput = document.querySelector('.tp-save-input') as HTMLInputElement
    expect(titleInput).not.toBeNull()
    act(() => { fireEvent.change(titleInput, { target: { value: 'My preset' } }) })
    const confirm = document.querySelector('.tp-save-btn--save') as HTMLButtonElement
    act(() => { fireEvent.click(confirm) })

    const presets = useUIStore.getState().textPresets
    expect(presets.map((p) => [p.title, p.text])).toContainEqual(['My preset', 'preset body'])
  })

  it('saves an upstream-driven panel content as a preset', () => {
    useUIStore.setState({ textPresets: [] })
    usePipelineStore.setState({
      currentPipeline: {
        ...(usePipelineStore.getState().currentPipeline as Pipeline),
        nodes: [
          { id: 'grid-1', batteryId: 'rect_grid', name: 'Grid', position: { x: 0, y: 0 }, params: {} },
          { id: 'panel-1', batteryId: 'text_panel', name: 'Panel', position: { x: 0, y: 0 }, params: {} },
        ],
        edges: [
          {
            id: 'e-1',
            source: { nodeId: 'grid-1', port: 'grid' },
            target: { nodeId: 'panel-1', port: 'input' },
          },
        ],
      } as Pipeline,
      nodeOutputs: { 'panel-1': { output: [{ path: [0], items: [[[0, 1], [1, 0]]] }] } },
    })

    const { container } = renderPanel()
    const saveBtn = container.querySelector('.text-panel-save-btn') as HTMLButtonElement
    expect(saveBtn).not.toBeNull()
    act(() => { fireEvent.click(saveBtn) })
    const titleInput = document.querySelector('.tp-save-input') as HTMLInputElement
    act(() => { fireEvent.change(titleInput, { target: { value: 'Upstream grid' } }) })
    act(() => { fireEvent.click(document.querySelector('.tp-save-btn--save') as HTMLButtonElement) })

    const saved = useUIStore.getState().textPresets.find((p) => p.title === 'Upstream grid')
    expect(saved).toBeDefined()
    // Stored as displayed: one row per line, never one digit per line.
    expect(saved?.text).toContain('[0,1]')
    expect(saved?.text).not.toMatch(/^\s*\d+,?\s*$/m)
  })

  it('edits the compact form, not the pretty-printed source', () => {
    const pretty = JSON.stringify([[0, 1], [1, 0]], null, 2)
    const { container } = render(
      <ReactFlowProvider>
        <TextPanelNode
          id="panel-1"
          data={{ battery: panelBattery, params: { text: pretty } }}
          selected={false}
          dragging={false}
        />
      </ReactFlowProvider>,
    )
    act(() => { fireEvent.doubleClick(container.querySelector('.text-panel-body') as HTMLElement) })
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    // A row stays on one line: no line holding a lone digit.
    expect(textarea.value).not.toMatch(/^\s*\d+,?\s*$/m)
    expect(textarea.value).toContain('[0,1]')
  })

  it('still adopts an external param change (applyBatch / AI write)', () => {
    const { container, rerender } = renderPanel()
    rerender(
      <ReactFlowProvider>
        <TextPanelNode
          id="panel-1"
          data={{ battery: panelBattery, params: { text: 'from agent' } }}
          selected={false}
          dragging={false}
        />
      </ReactFlowProvider>,
    )
    expect(container.textContent).toContain('from agent')
  })
})
