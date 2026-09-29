import { describe, expect, it } from 'vitest'
import { attachGuideSources, collectManualPointNodes, parseGuidePoints } from '../guidePoints'

describe('guidePoints', () => {
  it('attaches guide points to the matching control_points node, not the first one', () => {
    const road = parseGuidePoints([[4, 24], [16, 24], [36, 32]])
    const river = {
      id: 'river',
      opId: 'control_points',
      params: { points: [[0, 24], [16, 25], [30, 24], [46, 26], [64, 25]] },
    }
    const mainRoad = {
      id: 'road',
      opId: 'control_points',
      params: { points: [[4, 24], [16, 24], [36, 32]] },
    }
    expect(attachGuideSources(road, [], [river, mainRoad]).map((pt) => pt.sourceNodeId)).toEqual([
      'road', 'road', 'road',
    ])
  })

  it('parses point2d lists and attaches matching manual_points sources', () => {
    const pts = parseGuidePoints([[6, 24], { x: 18, y: 20 }])
    expect(pts).toEqual([{ x: 6, y: 24 }, { x: 18, y: 20 }])
    const manuals = collectManualPointNodes([
      { id: 'n0', opId: 'manual_points', params: { x: 6, y: 24 } },
      { id: 'n1', opId: 'manual_points', params: { x: 18, y: 20 } },
      { id: 'other', opId: 'grid_to_boxes', params: { x: 6, y: 24 } },
    ])
    expect(attachGuideSources(pts, manuals)).toEqual([
      { x: 6, y: 24, sourceNodeId: 'n0', sourceOpId: 'manual_points' },
      { x: 18, y: 20, sourceNodeId: 'n1', sourceOpId: 'manual_points' },
    ])
  })
})
