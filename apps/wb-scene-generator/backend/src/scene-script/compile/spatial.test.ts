import { describe, expect, it } from 'vitest'

import { asPlane, basePlaneOp, controlWorldPosition, instantiatePlacementsOp, placeOp, workGridOp } from '../../../../batteries/scene/spatial/lib.js'
import {
  addChildren,
  childrenOf,
  emptyScene,
  makeScenePort,
  setAttribute,
} from '../../../../vendor/dist/shared/types/index.js'

describe('spatial protocol', () => {
  it('keeps Control world metres when cellSize changes 1 → 0.5', () => {
    const plane = basePlaneOp({ width: 128, height: 128 }).plane
    const coarse = workGridOp({ plane, cellSize: 1 }).grid
    const fine = workGridOp({ plane, cellSize: 0.5 }).grid
    const control: readonly [number, number] = [24, 18]
    expect(controlWorldPosition(coarse.plane, control[0], control[1])).toEqual(
      controlWorldPosition(fine.plane, control[0], control[1]),
    )
    expect(fine.columns).toBe(256)
    expect(asPlane(plane)?.width).toBe(128)
  })

  it('place write-back stays in child-local metres', () => {
    const parent = emptyScene()
    const child = emptyScene()
    const childScene = makeScenePort(
      setAttribute(child.graph, child.focus, 'cv', [12, 8]),
      child.focus,
    )
    const placed = placeOp({
      scene: makeScenePort(parent.graph, parent.focus),
      child: childScene,
      name: 'City',
      x: 720,
      y: 780,
    })
    expect(placed.error).toBeUndefined()
    expect(placed.localOrigin).toEqual([720, 780])
    const kids = placed.scene ? [...childrenOf(placed.scene.graph, placed.scene.focus)] : []
    const node = kids.find((child) => child.name === 'City')
    expect(node?.transform?.translation).toEqual([720, 780, 0])
    expect(node?.attributes?.cv).toEqual([12, 8])
  })

  it('instantiatePlacements stores one prototype mesh and transform-only instances', () => {
    const protoBase = emptyScene()
    const { graph: protoGraph } = addChildren(protoBase.graph, protoBase.focus, [
      {
        name: 'RowHouse',
        schema: 'mesh',
        content: { schema: 'mesh', mesh: { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] } },
      },
    ])
    const host = emptyScene()
    const placed = instantiatePlacementsOp({
      scene: makeScenePort(host.graph, host.focus),
      catalog: { 'row-house': makeScenePort(protoGraph, protoBase.focus) },
      placements: {
        placements: [
          { key: 'bldg-a', prototypeKey: 'row-house', x: 90, y: 80, rotation: 0 },
          { key: 'bldg-b', prototypeKey: 'row-house', x: 170, y: 140, rotation: 0.2 },
        ],
      },
    })
    expect(placed.error).toBeUndefined()
    expect(placed.count).toBe(2)
    const graph = placed.scene!.graph
    const kids = childrenOf(graph, placed.scene!.focus)
    expect(kids.map((n) => n.name).sort()).toEqual(['Prototypes', 'bldg-a', 'bldg-b'])
    const protoFolder = kids.find((n) => n.name === 'Prototypes')!
    const protoKids = childrenOf(graph, protoFolder.id)
    expect(protoKids).toHaveLength(1)
    const house = childrenOf(graph, protoKids[0]!.id)[0]
    expect((house?.content as { mesh?: { positions?: number[] } } | undefined)?.mesh?.positions).toHaveLength(9)
    const inst = kids.find((n) => n.name === 'bldg-a')!
    expect(inst.attributes?.prototypeKey).toBe('row-house')
    expect((inst.content as { mesh?: unknown } | undefined)?.mesh).toBeUndefined()
    expect(inst.transform?.translation).toEqual([90, 80, 0])
  })

  it('keeps placement translation in authoring +Y so preview can flip once onto the terrain mesh', () => {
    const host = emptyScene()
    const proto = emptyScene()
    const placed = instantiatePlacementsOp({
      scene: makeScenePort(host.graph, host.focus),
      catalog: { cottage: makeScenePort(proto.graph, proto.focus) },
      placements: {
        placements: [{ key: 'hut', prototypeKey: 'cottage', x: 1185, y: 1612, z: 4.5, rotation: 0.4 }],
      },
    })
    const inst = [...(placed.scene?.graph.values() ?? [])].find((node) => node.name === 'hut')
    expect(inst?.transform?.translation).toEqual([1185, 1612, 4.5])
    expect(inst?.transform?.translation?.[1]).toBeGreaterThan(0)
  })
})
