import { describe, expect, it } from 'vitest'
import { addChildren, emptyScene, ROOT_ID } from '../../../../../vendor/shared/types/scene/graph.js'
import { meshContent, pointsContent } from '../../../../../vendor/shared/types/scene/content.js'
import { collectGuidesFromGraph, inferGuideStyle } from '../sceneGuideHydration'
import { invertWorldXformToXY } from '../sceneWorldXform'

describe('collectGuidesFromGraph', () => {
  it('collects nested RiverPath / Peaks / Center so Default can build handles', () => {
    const base = emptyScene()
    const { graph: withTerrain, ids } = addChildren(base.graph, ROOT_ID, [
      { name: 'Terrain', schema: 'mesh', content: meshContent({ positions: [0, 0, 0], indices: [0, 1, 2] }) },
    ])
    const { graph: withPeaks } = addChildren(withTerrain, ids[0]!, [
      { name: 'Peaks', schema: 'points', content: pointsContent([[18, 10], [42, 8]]) },
    ])
    const { graph: withRiver, ids: riverIds } = addChildren(withPeaks, ids[0]!, [
      { name: 'River', schema: 'mesh', content: meshContent({ positions: [0, 0, 0], indices: [0, 1, 2] }) },
    ])
    const { graph } = addChildren(withRiver, riverIds[0]!, [
      { name: 'RiverPath', schema: 'points', content: pointsContent([[0, 52], [22, 56]]) },
    ])
    const guides = collectGuidesFromGraph(graph, ids[0]!)
    expect(guides.map((g) => ({ name: g.name, path: g.path, style: g.style }))).toEqual([
      { name: 'Peaks', path: '/Terrain/Peaks', style: 'points' },
      { name: 'RiverPath', path: '/Terrain/River/RiverPath', style: 'polyline' },
    ])
  })

  it('reads guideStyle from attributes when present', () => {
    const base = emptyScene()
    const { graph, ids } = addChildren(base.graph, ROOT_ID, [
      {
        name: 'Ridge',
        schema: 'points',
        content: pointsContent([[1, 2], [3, 4]]),
        attributes: { guideStyle: 'points' },
      },
    ])
    expect(collectGuidesFromGraph(graph, ROOT_ID)[0]?.style).toBe('points')
    expect(ids).toHaveLength(1)
  })

  it('bakes ancestor translation into guide points so they stay with the placed city', () => {
    const base = emptyScene()
    const { graph: withCity, ids } = addChildren(base.graph, ROOT_ID, [
      { name: 'HarborCity', schema: 'scope', transform: { translation: [720, 780, 0] } },
    ])
    const { graph } = addChildren(withCity, ids[0]!, [
      {
        name: 'Hubs',
        schema: 'points',
        content: pointsContent([[90, 80], [260, 160]]),
      },
    ])
    expect(collectGuidesFromGraph(graph, ROOT_ID)[0]?.points).toEqual([
      expect.objectContaining({ x: 810, y: 860, localX: 90, localY: 80, parentTx: 720, parentTy: 780 }),
      expect.objectContaining({ x: 980, y: 940, localX: 260, localY: 160, parentTx: 720, parentTy: 780 }),
    ])
  })
})

describe('invertWorldXformToXY', () => {
  it('undoes a city place() translation', () => {
    expect(invertWorldXformToXY(830, 860, { tx: 720, ty: 780, tz: 0, yaw: 0 })).toEqual({ x: 110, y: 80 })
  })
})

describe('inferGuideStyle', () => {
  it('treats a single point and peak/center names as disconnected handles', () => {
    expect(inferGuideStyle('Center', 1)).toBe('points')
    expect(inferGuideStyle('Peaks', 7)).toBe('points')
    expect(inferGuideStyle('RiverPath', 6)).toBe('polyline')
  })
})
