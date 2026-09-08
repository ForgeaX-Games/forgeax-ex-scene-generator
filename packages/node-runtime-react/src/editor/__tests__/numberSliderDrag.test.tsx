// NumberSliderNode drag-throttle test.
//
// The slider must give real-time LOCAL feedback during a drag while NOT writing
// the store (→ persist + execute round-trip) on every pointermove. We assert:
//   (1) a fast drag of many pointermoves coalesces into a small, throttled set
//       of updateNodeParam('value', …) writes (leading + trailing), and
//   (2) the FINAL value the user released at is always committed exactly once on
//       pointerup (so the kernel/persisted SSOT ends on the released value).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'

import NumberSliderNode from '../components/canvas/NumberSliderNode.js'
import { usePipelineStore } from '../stores/pipelineStore.js'
import type { Battery, Pipeline } from '../types.js'

const sliderBattery: Battery = {
  id: 'number_const',
  name: '数值',
  nameEn: 'Number',
  type: 'common',
  category: 'common/input',
  description: '',
  version: '1.0.0',
  inputs: [],
  outputs: [{ name: 'value', type: 'number' }],
  params: [],
}

function pipelineWithSlider(): Pipeline {
  const now = new Date().toISOString()
  return {
    id: 'p-slider',
    name: 'slider',
    description: '',
    nodes: [
      { id: 'sl-1', batteryId: 'number_const', name: '数值', position: { x: 0, y: 0 }, params: { value: 0, min: 0, max: 100, precision: 0 } },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    status: 'idle',
    createdAt: now,
    updatedAt: now,
  }
}

describe('NumberSliderNode drag throttling', () => {
  beforeEach(() => {
    usePipelineStore.setState({
      batteries: [sliderBattery],
      categories: [],
      currentPipeline: pipelineWithSlider(),
      sessionRestorePending: null,
      pipelineStatus: 'idle',
      selectedNode: null,
      selectedNodeIds: [],
      logs: [],
      nodeOutputs: {},
      dynamicOutputPorts: {},
      groupViewStack: [],
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('coalesces a fast drag into few store writes and commits the final value once on pointerup', () => {
    vi.useFakeTimers()
    const updateSpy = vi.fn()
    usePipelineStore.setState({ updateNodeParam: updateSpy })

    const { container } = render(
      <ReactFlowProvider>
        <NumberSliderNode
          id="sl-1"
          data={{ battery: sliderBattery, params: { value: 0, min: 0, max: 100, precision: 0 } }}
          selected={false}
          dragging={false}
        />
      </ReactFlowProvider>,
    )

    const track = container.querySelector('.ns-track') as HTMLDivElement
    expect(track).toBeTruthy()
    // jsdom returns a zero rect; give every element a deterministic 0..100px span
    // so clientX maps 1:1 onto the 0..100 value range (the captured track node may
    // be re-created on re-render, so stub the prototype rather than one instance).
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 100, bottom: 10, width: 100, height: 10, x: 0, y: 0, toJSON() {},
    } as DOMRect)

    // jsdom's PointerEvent ignores clientX in its init dict, so dispatch plain
    // MouseEvents (same `clientX` the handlers read) for deterministic coords.
    const pointerDownAt = (x: number) => {
      const ev = new MouseEvent('pointerdown', { bubbles: true, cancelable: true })
      Object.defineProperty(ev, 'clientX', { value: x })
      track.dispatchEvent(ev)
    }
    const pointerMoveAt = (x: number) => {
      const ev = new MouseEvent('pointermove', { bubbles: true })
      Object.defineProperty(ev, 'clientX', { value: x })
      document.dispatchEvent(ev)
    }
    const pointerUp = () => {
      document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
    }

    // pointerdown at x=10 (value≈10) starts the drag (leading-edge write).
    pointerDownAt(10)

    // 20 rapid pointermoves sweeping 11..30 — well within one throttle window.
    for (let x = 11; x <= 30; x++) {
      pointerMoveAt(x)
    }

    // Before any timer fires: only the leading-edge write landed (NOT 21 writes).
    const valueWrites = () => updateSpy.mock.calls.filter((c) => c[1] === 'value')
    expect(valueWrites().length).toBeLessThanOrEqual(2)

    // Release at x=30 → final value committed exactly once.
    pointerUp()
    vi.runAllTimers()

    const writes = valueWrites()
    // Far fewer writes than the 21 pointer events.
    expect(writes.length).toBeLessThanOrEqual(3)
    // The LAST write must be the released value (30), guaranteeing SSOT lands on it.
    expect(writes.at(-1)).toEqual(['sl-1', 'value', 30])
  })
})
