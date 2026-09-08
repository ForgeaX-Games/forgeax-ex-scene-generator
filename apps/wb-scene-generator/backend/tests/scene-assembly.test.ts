/**
 * Scene assembly + tree_merge regression tests.
 *
 * Migrated/adapted from the legacy reference suites:
 *   - legacy-implicit-list backend suite scene-batteries.test.ts
 *     (add_child + node_explode + realistic composition)
 *   - legacy-implicit-list backend suite dispatcher.datatree-ops.test.ts
 *     (tree_merge item / default behaviour bands)
 *
 * Purpose: prove the FAITHFUL assembly path (add_child grafts scene subtrees into
 * SceneNodeSnapshot.children[]) end-to-end, and lock the tree_merge cross-module
 * `instanceof` fix (its branches must accept DataTree instances minted by a
 * *different* module copy — exactly what the dispatcher passes a dynamically
 * imported battery).
 */

import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  ROOT_ID,
  addChildren,
  emptyScene,
  getNode,
  iterCells,
  makeScenePort,
  pathOf,
  projectSceneToVoxelLayers,
  resolvePath,
  volumeFromCells,
  DataTree as VendorDataTree,
  type ScenePortValue,
} from '../../vendor/dist/shared/types/index.js'

// The dispatcher and dynamically-imported batteries resolve DataTree from
// *different* module copies; importing the kernel's DataTree here reproduces the
// cross-module boundary in a unit test.
import {
  applyBatch,
  createRuntime,
  DataTree as KernelDataTree,
  executeNode,
  executeWithDataTreeDispatch,
  type OpSpec,
} from '@forgeax/node-runtime'

import { grid2Node } from '../../batteries/scene/bridge/grid2node/index.js'
import { addChild } from '../../batteries/scene/manage/add_child/index.js'
import { nodeExplode } from '../../batteries/scene/query/node_explode/index.js'
import { treeMerge } from '../../../../packages/batteries-common/batteries/common/datatree/tree_merge/index.js'

function port(): ScenePortValue {
  const scene = emptyScene()
  return makeScenePort(scene.graph, scene.focus)
}

function idAt(scene: ScenePortValue, path: string): string {
  const id = resolvePath(scene.graph, ROOT_ID, path)
  if (!id) throw new Error(`missing scene path: ${path}`)
  return id
}

function cellCountAt(scene: ScenePortValue, path: string): number {
  const node = getNode(scene.graph, idAt(scene, path))
  return node?.content ? [...iterCells(node.content)].length : 0
}

function sceneWithLayer(name: string, cells: Array<{ x: number; y: number; z: number; token: string }>): ScenePortValue {
  const scene = emptyScene()
  const added = addChildren(scene.graph, ROOT_ID, [{ name, content: volumeFromCells(cells) }])
  return makeScenePort(added.graph, ROOT_ID)
}

function addChildMeta(): {
  inputs: Array<{ name: string; type: string; access?: 'item' | 'list' | 'tree'; required?: boolean; label?: string }>
  outputs: Array<{ name: string; type: string; access?: 'item' | 'list' | 'tree'; label?: string }>
} {
  return JSON.parse(
    readFileSync(new URL('../../batteries/scene/manage/add_child/meta.json', import.meta.url), 'utf8'),
  )
}

function entries(v: unknown): Array<{ path: number[]; items: unknown[] }> {
  if (Array.isArray(v)) return v as Array<{ path: number[]; items: unknown[] }>
  return (v as { toJSON(): Array<{ path: number[]; items: unknown[] }> }).toJSON()
}

describe('add_child — faithful multi-layer scene assembly', () => {
  it('declares nodes and childPaths as list access in battery metadata', () => {
    const meta = addChildMeta()

    expect(meta.inputs.find((p) => p.name === 'nodes')?.access).toBe('list')
    expect(meta.outputs.find((p) => p.name === 'childPaths')?.access).toBe('list')
  })

  it('grafts two grid2node outputs as siblings under root; node_explode lists sorted child paths', () => {
    const a = grid2Node({ name: 'A', grid: [[1]] }).scene!
    const b = grid2Node({ name: 'B', grid: [[1, 1]] }).scene!

    const out = addChild({ scene: port(), nodes: [a, b] })
    expect(out.error).toBeUndefined()
    expect(out.scene?.focus).toBe(ROOT_ID)

    // node_explode childPaths == sorted parent paths (matches add_child childPaths).
    const expl = nodeExplode({ scene: out.scene })
    expect((expl.childPaths as string[]).slice().sort()).toEqual(['/A', '/B'])
    expect((out.childPaths as string[]).slice().sort()).toEqual(['/A', '/B'])

    // projection yields one non-empty layer per voxel-bearing node → 2 layers.
    const { layers } = projectSceneToVoxelLayers(out.scene!.graph, ROOT_ID)
    const nonEmpty = layers.filter((l) => l.cells.length > 0)
    expect(nonEmpty.length).toBe(2)
    expect(nonEmpty.map((l) => l.nodePath).sort()).toEqual(['/A', '/B'])
  })

  it('nested: chaining add_child twice surfaces a deeper child path', () => {
    const a = grid2Node({ name: 'A', grid: [[1]] }).scene!
    const child = grid2Node({ name: 'Leaf', grid: [[1]] }).scene!

    // Step 1: graft A under root.
    const s1 = addChild({ scene: port(), nodes: [a] })
    expect(s1.error).toBeUndefined()

    // Step 2: graft Leaf under /A (deeper level).
    const aId = idAt(s1.scene!, '/A')
    const s2 = addChild({ scene: makeScenePort(s1.scene!.graph, aId), nodes: [child] })
    expect(s2.error).toBeUndefined()
    expect(pathOf(s2.scene!.graph, s2.scene!.focus)).toBe('/A')

    // Deeper child path present.
    expect(cellCountAt(s2.scene!, '/A/Leaf')).toBe(1)
    expect(nodeExplode({ scene: makeScenePort(s2.scene!.graph, aId) }).childPaths).toEqual(['/A/Leaf'])

    // Whole-tree projection still has both voxel nodes.
    const { layers } = projectSceneToVoxelLayers(s2.scene!.graph, ROOT_ID)
    expect(layers.filter((l) => l.cells.length > 0).map((l) => l.nodePath).sort()).toEqual(['/A', '/A/Leaf'])
  })

  it('grafts the focused subtree and preserves true child paths after tree_merge list concat', () => {
    const root = grid2Node({ name: 'Root', grid: [[0]] }).scene!
    const branch = grid2Node({ name: 'Branch', grid: [[1]] }).scene!
    const leaf = grid2Node({ name: 'Leaf', grid: [[1, 1]] }).scene!
    const nested = addChild({ scene: branch, nodes: [leaf] }).scene!

    const item0 = KernelDataTree.fromItem(nested)
    const merged = treeMerge({ portCount: 1, inferredAccess: 'item', item_0: item0 })
    expect(merged.error).toBeUndefined()

    const out = addChild({ scene: root, nodes: (merged.tree as InstanceType<typeof VendorDataTree>).toJSON()[0]!.items })
    expect(out.error).toBeUndefined()
    expect(pathOf(out.scene!.graph, out.scene!.focus)).toBe('/Root')
    expect(out.childPaths).toEqual(['/Root/Branch'])
    expect(cellCountAt(out.scene!, '/Root/Branch/Leaf')).toBe(2)

    const { layers } = projectSceneToVoxelLayers(out.scene!.graph, out.scene!.focus)
    expect(layers.map((l) => l.nodePath)).toEqual(['/Root/Branch', '/Root/Branch/Leaf'])
  })
})

describe('scene_output projection — multi-value (per-token) sub-layers', () => {
  // A node whose voxels carry a single token stays a single-value layer
  // (no tokens/cellsByToken fields → renderer shows one flat row).
  it('single-token node yields a single-value layer (no sub-layers)', () => {
    const scene = sceneWithLayer('Solid', [
      { x: 0, y: 0, z: 0, token: 'wall' },
      { x: 1, y: 0, z: 0, token: 'wall' },
    ])
    const { layers } = projectSceneToVoxelLayers(scene.graph, scene.focus)
    expect(layers).toHaveLength(1)
    expect(layers[0]!.cells).toHaveLength(2)
    expect(layers[0]!.tokens).toBeUndefined()
    expect(layers[0]!.cellsByToken).toBeUndefined()
  })

  // A node with >1 distinct token becomes a multi-value layer: cells stays the
  // full union, and tokens/cellsByToken expose the per-token split that the
  // renderer turns into collapsible sub-layer rows with their own visibility.
  it('multi-token node emits tokens + cellsByToken (sub-layer split)', () => {
    const scene = sceneWithLayer('House', [
      { x: 0, y: 0, z: 0, token: 'wall' },
      { x: 1, y: 0, z: 0, token: 'wall' },
      { x: 0, y: 0, z: 1, token: 'roof' },
      { x: 2, y: 0, z: 0, token: 'ground' },
    ])
    const { layers } = projectSceneToVoxelLayers(scene.graph, scene.focus)
    expect(layers).toHaveLength(1)
    const layer = layers[0]!
    // Full union preserved for back-compat single-surface rendering.
    expect(layer.cells).toHaveLength(4)
    // First-seen, de-duplicated token order.
    expect(layer.tokens).toEqual(['wall', 'roof', 'ground'])
    expect(layer.cellsByToken!.wall).toHaveLength(2)
    expect(layer.cellsByToken!.roof).toHaveLength(1)
    expect(layer.cellsByToken!.ground).toHaveLength(1)
  })
})

describe('tree_merge — DataTree wire-algebra (not scene assembly)', () => {
  it('item band: concat-by-path works with cross-module DataTree inputs', () => {
    const item0 = KernelDataTree.fromEntries([
      { path: [0], items: ['a', 'b'] },
      { path: [1], items: ['c'] },
    ])
    const item1 = KernelDataTree.fromEntries([
      { path: [0], items: ['x'] },
      { path: [1], items: ['y', 'z'] },
    ])
    // Guard: these are genuinely a different class than the battery's own copy.
    expect(item0 instanceof VendorDataTree).toBe(false)

    const out = treeMerge({ portCount: 2, inferredAccess: 'item', item_0: item0, item_1: item1 })
    expect(out.error).toBeUndefined()
    expect((out.tree as InstanceType<typeof VendorDataTree>).toJSON()).toEqual([
      { path: [0], items: ['a', 'b', 'x'] },
      { path: [1], items: ['c', 'y', 'z'] },
    ])
  })

  it('default (pack) band: no cross-module instanceof error after the fix', () => {
    const item0 = KernelDataTree.fromList(['x'])
    const item1 = KernelDataTree.fromList(['y'])
    expect(item0 instanceof VendorDataTree).toBe(false)

    // No inferredAccess → structural-pack default branch (the one that used the
    // cross-module-fragile `instanceof` check). Must NOT error now.
    const out = treeMerge({ portCount: 2, item_0: item0, item_1: item1 })
    expect(out.error).toBeUndefined()
    expect((out.tree as InstanceType<typeof VendorDataTree>).toJSON()).toEqual([
      { path: [0, 0], items: ['x'] },
      { path: [1, 0], items: ['y'] },
    ])
  })

  it('default band: still rejects genuinely non-DataTree inputs', () => {
    const out = treeMerge({ portCount: 2, item_0: { not: 'a tree' }, item_1: KernelDataTree.fromList(['y']) })
    expect(out.error).toMatch(/must be a DataTree/)
  })

  it('item band: scene values remain independent scene items for downstream list ports', () => {
    const a = grid2Node({ name: 'A', grid: [[1]] }).scene!
    const b = grid2Node({ name: 'B', grid: [[1, 1]] }).scene!
    const item0 = KernelDataTree.fromItem(a)
    const item1 = KernelDataTree.fromItem(b)

    const merged = treeMerge({ portCount: 2, inferredAccess: 'item', item_0: item0, item_1: item1 })
    expect(merged.error).toBeUndefined()
    expect((merged.tree as InstanceType<typeof VendorDataTree>).toJSON()).toEqual([
      { path: [0], items: [a, b] },
    ])

    // This mirrors the dispatcher boundary for add_child.nodes (access:list):
    // a merged branch's scene items are collected into the child list.
    const out = addChild({ scene: port(), nodes: (merged.tree as InstanceType<typeof VendorDataTree>).toJSON()[0]!.items })
    expect(out.error).toBeUndefined()
    expect(getNode(out.scene!.graph, idAt(out.scene!, '/A'))).not.toBeNull()
    expect(getNode(out.scene!.graph, idAt(out.scene!, '/B'))).not.toBeNull()
  })

  it('item band tree_merge output flows through add_child.nodes list access at the dispatcher boundary', async () => {
    const root = grid2Node({ name: 'Root', grid: [[0]] }).scene!
    const a = grid2Node({ name: 'A', grid: [[1]] }).scene!
    const b = grid2Node({ name: 'B', grid: [[1, 1]] }).scene!
    const item0 = KernelDataTree.fromItem(a)
    const item1 = KernelDataTree.fromItem(b)

    const merged = treeMerge({ portCount: 2, inferredAccess: 'item', item_0: item0, item_1: item1 })
    expect(merged.error).toBeUndefined()

    const meta = addChildMeta()
    const op: OpSpec = {
      id: 'add_child',
      inputs: meta.inputs,
      outputs: meta.outputs,
      params: [],
      execute: (_ctx, args) => addChild(args),
    }

    const dispatched = await executeWithDataTreeDispatch(
      op,
      {
        scene: KernelDataTree.fromItem(root),
        nodes: merged.tree,
      },
      {},
      (args) => addChild(args),
    )

    expect(entries(dispatched.childPaths)).toEqual([
      { path: [0, 0], items: ['/Root/A'] },
      { path: [0, 1], items: ['/Root/B'] },
    ])
    const sceneOut = entries(dispatched.scene)[0]!.items[0] as ScenePortValue
    expect(getNode(sceneOut.graph, idAt(sceneOut, '/Root/A'))).not.toBeNull()
    expect(getNode(sceneOut.graph, idAt(sceneOut, '/Root/B'))).not.toBeNull()
  })

  it('infers tree_merge item band at execution time for old graphs missing inferredAccess', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'scene-merge-infer-'))
    try {
      const runtime = createRuntime({ projectRoot: scratch, pipelineId: 'p1', pluginId: 'wb-scene-test' })
      const gridOp: OpSpec = {
        id: 'grid2node',
        inputs: [
          { name: 'name', type: 'string', access: 'item' },
          { name: 'grid', type: 'grid', access: 'item' },
        ],
        outputs: [{ name: 'scene', type: 'scene', access: 'item' }],
        params: [
          { name: 'name', type: 'string' },
          { name: 'grid', type: 'grid' },
        ],
        execute: (_ctx, args) => grid2Node(args),
      }
      const mergeOp: OpSpec = {
        id: 'tree_merge',
        inputs: [
          { name: 'item_0', type: 'any', access: 'tree' },
          { name: 'item_1', type: 'any', access: 'tree' },
        ],
        outputs: [{ name: 'tree', type: 'any', access: 'tree' }],
        params: [],
        dynamicInputs: { prefix: 'item_', labelTemplate: '[$i]', minCount: 2, type: 'any', access: 'tree' },
        execute: (_ctx, args) => treeMerge(args),
      }
      const meta = addChildMeta()
      const addOp: OpSpec = {
        id: 'add_child',
        inputs: meta.inputs,
        outputs: meta.outputs,
        params: [],
        execute: (_ctx, args) => addChild(args),
      }
      runtime.registry.register(gridOp)
      runtime.registry.register(mergeOp)
      runtime.registry.register(addOp)

      await applyBatch(runtime, [
        { type: 'createNode', nodeId: 'root', opId: 'grid2node', position: { x: 0, y: 0 }, params: { name: 'Root', grid: [[0]] } },
        { type: 'createNode', nodeId: 'a', opId: 'grid2node', position: { x: 0, y: 0 }, params: { name: 'A', grid: [[1]] } },
        { type: 'createNode', nodeId: 'b', opId: 'grid2node', position: { x: 0, y: 0 }, params: { name: 'B', grid: [[1, 1]] } },
        { type: 'createNode', nodeId: 'merge', opId: 'tree_merge', position: { x: 0, y: 0 }, params: { portCount: 2 } },
        { type: 'createNode', nodeId: 'add', opId: 'add_child', position: { x: 0, y: 0 }, params: {} },
        { type: 'connect', edgeId: 'e1', source: { nodeId: 'a', port: 'scene' }, target: { nodeId: 'merge', port: 'item_0' } },
        { type: 'connect', edgeId: 'e2', source: { nodeId: 'b', port: 'scene' }, target: { nodeId: 'merge', port: 'item_1' } },
        { type: 'connect', edgeId: 'e3', source: { nodeId: 'root', port: 'scene' }, target: { nodeId: 'add', port: 'scene' } },
        { type: 'connect', edgeId: 'e4', source: { nodeId: 'merge', port: 'tree' }, target: { nodeId: 'add', port: 'nodes' } },
      ])

      // Full run: with the legacy partial-exec model a target run is the target's
      // DOWNSTREAM closure (add is a sink → just itself, upstream from cache), so
      // to assert the merge + add outputs together we execute the whole pipeline.
      const result = await (await executeNode(runtime, {})).done

      expect(result.status).toBe('completed')
      const mergeEntries = entries(result.outputs.merge!.tree)
      expect(mergeEntries.map((e) => ({ path: e.path, count: e.items.length }))).toEqual([{ path: [0], count: 2 }])
      expect(entries(result.outputs.add!.childPaths)).toEqual([
        { path: [0, 0], items: ['/Root/A'] },
        { path: [0, 1], items: ['/Root/B'] },
      ])
      const sceneEntries = entries(result.outputs.add!.scene)
      expect(sceneEntries).toHaveLength(1)
      const sceneOut = sceneEntries[0]!.items[0] as ScenePortValue
      expect(getNode(sceneOut.graph, idAt(sceneOut, '/Root/A'))).not.toBeNull()
      expect(getNode(sceneOut.graph, idAt(sceneOut, '/Root/B'))).not.toBeNull()
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })
})
