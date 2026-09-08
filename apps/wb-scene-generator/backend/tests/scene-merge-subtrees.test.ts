/**
 * scene_merge_subtrees regression suite.
 *
 * 锁定的修复：merge 收束时若两个 branch 在「同一父下的同名子节点」内各自新增了不同后代，
 * 旧实现按「同名整棵子树保留先到者」去重，会把后到 branch 的修改整棵丢弃。
 * 修复后改为递归深合并：同名子节点不跳过，递归下钻逐层合并，各 branch 的后代都保留，
 * 同时保持 z-order（order 递增）与 focus=ROOT_ID 输出。
 */

import { describe, it, expect } from 'vitest'

import {
  cellCount,
  childrenOf,
  emptyGraph,
  getNode,
  makeScenePort,
  projectSceneToVoxelLayers,
  resolvePath,
  ROOT_ID,
  type NodeId,
  type SceneGraph,
  type ScenePortValue,
} from '../../vendor/dist/shared/types/index.js'

import { grid2Node } from '../../batteries/scene/bridge/grid2node/index.js'
import { addChild } from '../../batteries/scene/manage/add_child/index.js'
import { sceneMergeSubtrees } from '../../batteries/special/scene/scene_merge_subtrees/index.js'

function findId(graph: SceneGraph, path: string): NodeId {
  const id = resolvePath(graph, ROOT_ID, path)
  if (id === null) throw new Error(`test fixture: path not found: "${path}"`)
  return id
}

function cellsAt(graph: SceneGraph, path: string): number {
  const id = resolvePath(graph, ROOT_ID, path)
  if (id === null) return 0
  const node = getNode(graph, id)
  return node?.content ? cellCount(node.content) : 0
}

function childNamesAt(graph: SceneGraph, path: string): string[] {
  return childrenOf(graph, findId(graph, path)).map((c) => c.name)
}

/** 搭一个共同 base：根下挂 building，building 下挂两个空容器 rest / arch。 */
function makeBase(): ScenePortValue {
  const building = grid2Node({ name: 'building', grid: [[0]] }).scene!
  const root = addChild({ scene: makeScenePort(emptyGraph(), ROOT_ID), nodes: [building] }).scene!
  // building 下挂两个空壳容器
  const rest = grid2Node({ name: 'rest', grid: [[0]] }).scene!
  const arch = grid2Node({ name: 'arch', grid: [[0]] }).scene!
  const buildingId = findId(root.graph, '/building')
  return addChild({ scene: makeScenePort(root.graph, buildingId), nodes: [rest, arch] }).scene!
}

describe('scene_merge_subtrees — recursive deep merge', () => {
  it('preserves both branches modifying different subtrees under a shared parent (focus="/")', () => {
    const base = makeBase()

    // branch A: 在 /building/rest 下加 wallA
    const wallA = grid2Node({ name: 'wallA', grid: [[1]] }).scene!
    const treeA = addChild({ scene: makeScenePort(base.graph, findId(base.graph, '/building/rest')), nodes: [wallA] }).scene!

    // branch B: 在 /building/arch 下加 roofB
    const roofB = grid2Node({ name: 'roofB', grid: [[1, 1]] }).scene!
    const treeB = addChild({ scene: makeScenePort(base.graph, findId(base.graph, '/building/arch')), nodes: [roofB] }).scene!

    const out = sceneMergeSubtrees({
      scenes: [
        makeScenePort(treeA.graph, ROOT_ID),
        makeScenePort(treeB.graph, ROOT_ID),
      ],
    })

    expect(out.error).toBeUndefined()
    expect(out.scene?.focus).toBe(ROOT_ID)
    expect(out.mergedCount).toBe(2)

    const m = out.scene!.graph
    // 两个 branch 各自的修改都要保留
    expect(cellsAt(m, '/building/rest/wallA')).toBe(1)
    expect(cellsAt(m, '/building/arch/roofB')).toBe(2)
    expect(childNamesAt(m, '/building').sort()).toEqual(['arch', 'rest'])
  })

  it('preserves both branches when focus points at the shared parent', () => {
    const base = makeBase()
    const wallA = grid2Node({ name: 'wallA', grid: [[1]] }).scene!
    const treeA = addChild({ scene: makeScenePort(base.graph, findId(base.graph, '/building/rest')), nodes: [wallA] }).scene!
    const roofB = grid2Node({ name: 'roofB', grid: [[1, 1]] }).scene!
    const treeB = addChild({ scene: makeScenePort(base.graph, findId(base.graph, '/building/arch')), nodes: [roofB] }).scene!

    const out = sceneMergeSubtrees({
      scenes: [
        makeScenePort(treeA.graph, findId(treeA.graph, '/building')),
        makeScenePort(treeB.graph, findId(treeB.graph, '/building')),
      ],
    })

    expect(out.error).toBeUndefined()
    const m = out.scene!.graph
    expect(cellsAt(m, '/building/rest/wallA')).toBe(1)
    expect(cellsAt(m, '/building/arch/roofB')).toBe(2)
  })

  it('preserves both branches in the real fanout protocol (focus on distinct children)', () => {
    const base = makeBase()
    const wallA = grid2Node({ name: 'wallA', grid: [[1]] }).scene!
    const treeA = addChild({ scene: makeScenePort(base.graph, findId(base.graph, '/building/rest')), nodes: [wallA] }).scene!
    const roofB = grid2Node({ name: 'roofB', grid: [[1, 1]] }).scene!
    const treeB = addChild({ scene: makeScenePort(base.graph, findId(base.graph, '/building/arch')), nodes: [roofB] }).scene!

    const out = sceneMergeSubtrees({
      scenes: [
        makeScenePort(treeA.graph, findId(treeA.graph, '/building/rest')),
        makeScenePort(treeB.graph, findId(treeB.graph, '/building/arch')),
      ],
    })

    expect(out.error).toBeUndefined()
    const m = out.scene!.graph
    expect(cellsAt(m, '/building/rest/wallA')).toBe(1)
    expect(cellsAt(m, '/building/arch/roofB')).toBe(2)
  })

  it('preserves z-order: later-arriving siblings get strictly higher order', () => {
    // base 根下先后挂 first / second（order 递增）
    const first = grid2Node({ name: 'first', grid: [[1]] }).scene!
    const second = grid2Node({ name: 'second', grid: [[1]] }).scene!
    const base = addChild({ scene: makeScenePort(emptyGraph(), ROOT_ID), nodes: [first, second] }).scene!

    // branch B 在根下追加一个新兄弟 third
    const third = grid2Node({ name: 'third', grid: [[1]] }).scene!
    const treeB = addChild({ scene: makeScenePort(base.graph, ROOT_ID), nodes: [third] }).scene!

    const out = sceneMergeSubtrees({
      scenes: [
        makeScenePort(base.graph, ROOT_ID),
        makeScenePort(treeB.graph, ROOT_ID),
      ],
    })
    expect(out.error).toBeUndefined()
    const m = out.scene!.graph

    const oFirst = getNode(m, findId(m, '/first'))!.order
    const oSecond = getNode(m, findId(m, '/second'))!.order
    const oThird = getNode(m, findId(m, '/third'))!.order
    // base 原有顺序保持，新增的 third z-order 排在最后（order 最大）
    expect(oFirst).toBeLessThan(oSecond)
    expect(oThird).toBeGreaterThan(oSecond)

    // projection 顺序（z-order）：first < second < third
    const { layers } = projectSceneToVoxelLayers(m, ROOT_ID)
    const order = layers.filter((l) => l.cells.length > 0).map((l) => l.nodePath)
    expect(order).toEqual(['/first', '/second', '/third'])
  })

  it('keeps first arrival on a genuine same-named leaf conflict', () => {
    // 两个 branch 在根下都新建了同名最终节点 dup（各自不同 cells）→ 保留先到者
    const dupA = grid2Node({ name: 'dup', grid: [[1]] }).scene! // 1 cell
    const treeA = addChild({ scene: makeScenePort(emptyGraph(), ROOT_ID), nodes: [dupA] }).scene!
    const dupB = grid2Node({ name: 'dup', grid: [[1, 1, 1]] }).scene! // 3 cells
    const treeB = addChild({ scene: makeScenePort(emptyGraph(), ROOT_ID), nodes: [dupB] }).scene!

    const out = sceneMergeSubtrees({
      scenes: [
        makeScenePort(treeA.graph, ROOT_ID),
        makeScenePort(treeB.graph, ROOT_ID),
      ],
    })
    expect(out.error).toBeUndefined()
    // 先到者（1 cell）保留，后到者不覆盖
    expect(cellsAt(out.scene!.graph, '/dup')).toBe(1)
  })
})
