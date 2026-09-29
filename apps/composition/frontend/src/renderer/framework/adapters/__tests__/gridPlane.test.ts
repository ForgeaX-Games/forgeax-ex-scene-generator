import { describe, expect, it } from 'vitest'
import type { GridLayer } from '../../../types'
import { buildGridPlaneMesh, disposeGridPlaneMesh } from '../gridPlane'

function grid(data: number[][]): GridLayer {
  return {
    key: 'noise:grid',
    nodeId: 'noise',
    portName: 'grid',
    nodeName: 'Noise',
    data,
    rows: data.length,
    cols: Math.max(0, ...data.map((row) => row.length)),
    outputType: 'grid',
    visible: true,
    updatedAt: 1,
  }
}

describe('buildGridPlaneMesh', () => {
  it('builds a full-extent heatmap even when some or all cells are zero', () => {
    const mixed = buildGridPlaneMesh({ layer: grid([[0, 1], [2, 0]]) })
    expect(mixed).not.toBeNull()
    expect(mixed!.geometry.boundingBox).toBeTruthy()
    disposeGridPlaneMesh(mixed!)

    const zeros = buildGridPlaneMesh({ layer: grid([[0, 0], [0, 0]]) })
    expect(zeros).not.toBeNull()
    disposeGridPlaneMesh(zeros!)
  })

  it('returns null only when the grid has no extent', () => {
    expect(buildGridPlaneMesh({ layer: grid([]) })).toBeNull()
  })

  it('paints a signed field with a transparent diverging card, not token hues', () => {
    const mesh = buildGridPlaneMesh({ layer: grid([[-1, 0, 1]]) })
    expect(mesh).not.toBeNull()
    const pixels = (mesh!.userData.gridTexture as { image: { data: Uint8Array } }).image.data
    const neg = { r: pixels[0]!, g: pixels[1]!, b: pixels[2]!, a: pixels[3]! }
    const zero = { r: pixels[4]!, g: pixels[5]!, b: pixels[6]!, a: pixels[7]! }
    const pos = { r: pixels[8]!, g: pixels[9]!, b: pixels[10]!, a: pixels[11]! }
    expect(neg.b).toBeGreaterThan(neg.r)
    expect(pos.r).toBeGreaterThan(pos.b)
    expect(zero.a).toBeLessThan(neg.a)
    expect(zero.a).toBeLessThan(pos.a)
    disposeGridPlaneMesh(mesh!)
  })
})
