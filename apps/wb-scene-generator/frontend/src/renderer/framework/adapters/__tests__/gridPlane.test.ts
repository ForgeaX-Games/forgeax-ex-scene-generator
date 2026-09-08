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
})
