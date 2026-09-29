import { describe, expect, it } from 'vitest'

import { mergeNodeParams } from '../layer2/apply-batch-ops.js'
import {
  defaultNumberConstSlider,
  overlayNumberConstSliderPatches,
  stampNumberConstSliderParams,
} from '../layer2/number-const-slider.js'

describe('number_const slider chrome', () => {
  it('initializes max to twice the value and integer precision', () => {
    expect(defaultNumberConstSlider(1200)).toEqual({ min: 0, max: 2400, precision: 0 })
    expect(defaultNumberConstSlider(1.5)).toEqual({ min: 0, max: 3, precision: 1 })
    expect(defaultNumberConstSlider(-40)).toEqual({ min: -80, max: 0, precision: 0 })
    expect(defaultNumberConstSlider(0)).toEqual({ min: 0, max: 100, precision: 0 })
  })

  it('keeps a previously chosen max when the value changes', () => {
    const nodes = [{ id: 'width', opId: 'number_const', params: { value: 800 } }]
    stampNumberConstSliderParams(nodes, {
      width: { opId: 'number_const', params: { value: 1200, min: 0, max: 2400, precision: 0 } },
    })
    expect(nodes[0]?.params).toMatchObject({ value: 800, min: 0, max: 2400, precision: 0 })
  })

  it('initializes when the node is new', () => {
    const nodes = [{ id: 'width', opId: 'number_const', params: { value: 1200 } }]
    stampNumberConstSliderParams(nodes, {})
    expect(nodes[0]?.params).toMatchObject({ value: 1200, min: 0, max: 2400, precision: 0 })
  })

  it('overlays a context-menu max onto the compiled node', () => {
    const nodes = [{ id: 'width', opId: 'number_const', params: { value: 12, min: 0, max: 24, precision: 0 } }]
    overlayNumberConstSliderPatches(nodes, [
      { type: 'updateNode', nodeId: 'width', params: { max: 99, precision: 1 } },
    ])
    expect(nodes[0]?.params).toMatchObject({ value: 12, min: 0, max: 99, precision: 1 })
  })

  it('does not keep slider chrome on a non-number node after a compile import merge', () => {
    expect(mergeNodeParams(
      'base_plane',
      { origin: [0, 1200], value: 0, min: 0, max: 800, precision: 0, __sceneScriptFunctionName: 'basePlane' },
      { origin: [0, 1200], __sceneScriptFunctionName: 'basePlane' },
    )).toEqual({ origin: [0, 1200], __sceneScriptFunctionName: 'basePlane' })
  })
})
