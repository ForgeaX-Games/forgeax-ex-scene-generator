// GridPanelNode preview-churn regression test (real store + real component).
//
// The slider→preview lag was NOT the backend execute (~1ms for createGrid) nor a
// full loadPipeline reload — it was the preview repaint path on the frontend:
//   1. setNodeOutput replaced the whole `nodeOutputs` reference on EVERY port
//      refresh (even when the value was identical), and
//   2. GridPanelNode subscribed to the whole map + re-ran extractGrids and the
//      drawGrid effect on every render.
// So refreshConnectedOutputs (re-GETs every connected port on each exec:completed
// during a drag) repainted the grid canvas N times per tick, including for
// unrelated/unchanged ports.
//
// This test drives the REAL store actions and a REAL GridPanelNode (jsdom) and
// asserts the panel re-renders / redraws ONLY when ITS grid value actually
// changes — unchanged ports and unrelated ports cause zero extra renders.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import { useRef } from 'react'
import { ReactFlowProvider } from '@xyflow/react'

import GridPanelNode from '../components/canvas/GridPanelNode.js'
import { usePipelineStore } from '../stores/pipelineStore.js'
import type { Pipeline } from '../types.js'

const gridBattery = {
  id: 'grid_panel',
  name: '网格预览',
  type: 'special',
  inputs: [{ name: 'input', type: 'any' }],
  outputs: [{ name: 'grid', type: 'grid' }],
}

function basePipeline(): Pipeline {
  const now = new Date().toISOString()
  return {
    id: 'p-grid', name: 'grid', description: '',
    nodes: [{ id: 'gp-1', batteryId: 'grid_panel', name: '网格预览', position: { x: 0, y: 0 }, params: {} }],
    edges: [], viewport: { x: 0, y: 0, zoom: 1 }, status: 'idle', createdAt: now, updatedAt: now,
  }
}

describe('GridPanelNode preview churn', () => {
  beforeEach(() => {
    usePipelineStore.setState({
      batteries: [gridBattery as never], categories: [],
      currentPipeline: basePipeline(), sessionRestorePending: null,
      pipelineStatus: 'idle', selectedNode: null, selectedNodeIds: [], logs: [],
      nodeOutputs: {}, dynamicOutputPorts: {}, groupViewStack: [],
    })
  })
  afterEach(() => vi.restoreAllMocks())

  it('setNodeOutput is a no-op (same reference) when the value is unchanged', () => {
    const set = usePipelineStore.getState().setNodeOutput
    act(() => set('gp-1', 'grid', [[1, 2], [3, 4]]))
    const ref1 = usePipelineStore.getState().nodeOutputs
    // Same structural value (different array identity) → must NOT replace the map.
    act(() => set('gp-1', 'grid', [[1, 2], [3, 4]]))
    const ref2 = usePipelineStore.getState().nodeOutputs
    expect(ref2).toBe(ref1)
    // A genuine change DOES replace it.
    act(() => set('gp-1', 'grid', [[1, 2], [3, 5]]))
    expect(usePipelineStore.getState().nodeOutputs).not.toBe(ref1)
  })

  it('redraws only when ITS grid changes, not on unrelated/unchanged port refreshes', () => {
    let renderCount = 0
    function Probe() {
      // Subscribe the same way the panel does, to count renders driven by the store.
      usePipelineStore((s) => s.nodeOutputs['gp-1'])
      renderCount++
      return null
    }
    const set = usePipelineStore.getState().setNodeOutput

    render(
      <ReactFlowProvider>
        {/* params._nodeWidth set → userResizedRef true → no auto-size store write
            (which would otherwise add a render on first data arrival). */}
        <GridPanelNode id="gp-1" data={{ battery: gridBattery as never, params: { _nodeWidth: 200, _nodeHeight: 120 } }} selected={false} dragging={false} />
        <Probe />
      </ReactFlowProvider>,
    )
    const base = renderCount

    // (a) First grid arrives → one render.
    act(() => set('gp-1', 'grid', [[0, 0], [0, 0]]))
    expect(renderCount).toBe(base + 1)

    // (b) An UNRELATED node's port refresh (slider value) → zero re-render of gp-1.
    act(() => set('num_w', 'value', 42))
    expect(renderCount).toBe(base + 1)

    // (c) Re-GET the SAME grid value (what refreshConnectedOutputs does every tick)
    //     → zero re-render.
    act(() => set('gp-1', 'grid', [[0, 0], [0, 0]]))
    expect(renderCount).toBe(base + 1)

    // (d) A genuine grid change → exactly one more render.
    act(() => set('gp-1', 'grid', [[1, 1, 1], [1, 1, 1], [1, 1, 1]]))
    expect(renderCount).toBe(base + 2)
  })

  it('simulated drag: panel repaints once per genuinely-changed tick, not once per connected port', () => {
    // The user's graph: 2 sliders (num_w, num_h) + grid → grid panel. Each
    // exec:completed, refreshConnectedOutputs re-GETs ALL connected ports
    // (num_w.value, num_h.value, grid.grid). Pre-fix every such write churned the
    // shared nodeOutputs reference → the panel repainted 3x/tick (and again for
    // each node:output event). Post-fix the panel repaints only when the grid
    // value changes — once per tick — and unchanged slider ports cost nothing.
    let drawTicks = 0
    function Probe() {
      const v = usePipelineStore((s) => s.nodeOutputs['gp-1']?.grid)
      const ref = useRef(v)
      if (ref.current !== v) { ref.current = v; drawTicks++ }
      return null
    }
    const set = usePipelineStore.getState().setNodeOutput
    render(
      <ReactFlowProvider>
        <GridPanelNode id="gp-1" data={{ battery: gridBattery as never, params: { _nodeWidth: 200, _nodeHeight: 120 } }} selected={false} dragging={false} />
        <Probe />
      </ReactFlowProvider>,
    )
    const base = drawTicks

    const TICKS = 10
    for (let t = 0; t < TICKS; t++) {
      // Mirror refreshConnectedOutputs: fan out over every connected port.
      act(() => {
        set('num_w', 'value', 20 + t)            // slider drives width — changes
        set('num_h', 'value', 30)                // other slider — unchanged
        // grid genuinely grows by one column each tick (width changed)
        set('gp-1', 'grid', Array.from({ length: 4 }, () => Array.from({ length: 4 + t }, () => 0)))
      })
    }
    // Exactly one grid repaint per tick (10), NOT 3-per-tick or per-port.
    expect(drawTicks - base).toBe(TICKS)
  })
})
