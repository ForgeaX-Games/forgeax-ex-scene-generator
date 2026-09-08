import { describe, expect, it } from 'vitest'

import {
  compileSceneModule,
  compiledOpsToKernelGraph,
  parseSceneModule,
  printSceneModule,
} from '@forgeax/scene-authoring'

import { getSceneContractRegistry } from './contracts.js'

const goldenSource = `
const root = emptyScene({})
const baseName = stringValue({ value: "Ground" })
const width = numberValue({ value: 24 })
const height = numberValue({ value: 18 })
const baseAsset = stringValue({ value: "Grass" })
const base = addBaseGrid({
  rootScene: root,
  baseName,
  width,
  height,
  baseAsset,
})
sceneOutput({ scene: base.rootScene })
`

const atomicPilotSource = `
const root = emptyScene({})
const width = numberValue({ value: 12 })
const height = numberValue({ value: 8 })
const fill = numberValue({ value: 1 })
const name = stringValue({ value: "Pilot ground" })
const asset = stringValue({ value: "Grass" })
const enabled = booleanValue({ value: true })
const sceneSeed = seed({ seed: 42 })
const grid = rectangularGrid({ width, height, fillValue: fill })
const voxel = gridSceneNode({ name, grid: grid.grid, token: asset })
const composed = addSceneChildren({ scene: root, nodes: [voxel.scene] })
const pointA = manualPoint({ x: 2, y: 3 })
const pointB = manualPoint({ x: 8, y: 5 })
const points = mergePoints({ items: [pointA.point, pointB.point] })
sceneOutput({ scene: composed.scene })
`

describe('scene function catalog golden compile', () => {
  it('compiles a sealed AddBaseGrid call into the existing runtime graph contract', async () => {
    const registry = await getSceneContractRegistry()
    const templates = registry.list().filter((contract) => contract.kind === 'template')
    // JSON is oracle-only; all production composites come from native TS.
    expect(templates.filter((contract) => !contract.definitionId?.includes('.nested.'))).toHaveLength(36)
    expect(registry.list().filter((contract) =>
      contract.kind === 'group' && !contract.definitionId?.includes('.nested.'))).toHaveLength(16)
    expect(new Set(registry.list().filter((contract) =>
      contract.kind === 'atomic' && contract.sceneScriptStatus === 'equivalence-verified')
      .map((contract) => contract.opId))).toHaveLength(362)
    expect(registry.list().filter((contract) =>
      contract.kind !== 'atomic' &&
      !contract.definitionId?.includes('.nested.') &&
      contract.sceneScriptStatus === 'equivalence-verified')).toHaveLength(52)
    expect(registry.get('addBaseGrid')?.definitionId).toBe('scene.template.add-base-grid')
    expect(registry.get('addBaseGrid')?.outputs.find((port) => port.name === 'baseNode')?.description)
      .toContain('parent region')
    expect(registry.get('areaPartition')?.inputs.find((port) => port.name === 'scene')?.description)
      .toContain('base.baseNode')
    expect(registry.get('retiredNameListPass')).toBeUndefined()
    expect(templates.every((contract) => !contract.capabilities?.agent?.includes('editDefinition'))).toBe(true)
    const parsed = parseSceneModule(goldenSource, { file: 'main.scene.ts', registry })
    const compiled = compileSceneModule(parsed.module, registry)
    expect([...parsed.diagnostics, ...compiled.diagnostics]).toEqual([])

    const graph = compiledOpsToKernelGraph(compiled.ops)
    expect(Object.values(graph.nodes)).toHaveLength(7)
    expect(Object.values(graph.groups ?? {})).toHaveLength(1)
    expect((Object.values(graph.groups ?? {})[0] as { _nestedGroups?: unknown[] })._nestedGroups).toHaveLength(1)
    expect(Object.values(graph.edges)).toHaveLength(6)
    expect(Object.values(graph.nodes).find((node) => node.opId === '__group__')?.params).toMatchObject({
      __sceneScriptFunctionName: 'addBaseGrid',
      __sceneScriptStatus: 'equivalence-verified',
    })

    const canonical = printSceneModule(parsed.module)
    const reparsed = parseSceneModule(canonical, { file: 'main.scene.ts', registry })
    expect(reparsed.module.statements.map((statement) => statement.statementId)).toEqual(
      parsed.module.statements.map((statement) => statement.statementId),
    )
  })

  it('binds inline literals through native template parameters without helper nodes', async () => {
    const registry = await getSceneContractRegistry()
    const source = `
const root = emptyScene({})
const base = addBaseGrid({
  rootScene: root.scene,
  baseName: "town_base",
  width: 48,
  height: 36,
  baseAsset: "ground",
})
sceneOutput({ scene: base.rootScene })
`
    const parsed = parseSceneModule(source, { file: 'literal-template.scene.ts', registry })
    const compiled = compileSceneModule(parsed.module, registry)
    expect([...parsed.diagnostics, ...compiled.diagnostics]).toEqual([])
    const nodes = compiled.ops.filter(
      (op): op is Extract<(typeof compiled.ops)[number], { type: 'createNode' }> => op.type === 'createNode',
    )
    expect(nodes.find((node) => node.opId === 'rect_grid')?.params).toMatchObject({ width: 48, height: 36 })
    expect(nodes.find((node) => node.opId === 'grid2node')?.params).toMatchObject({ name: 'town_base' })
    expect(nodes.find((node) => node.opId === 'type_string')?.params).toMatchObject({ value: 'ground' })
  })

  it('compiles the atomic pilot with typed references and dynamic DataTree ports', async () => {
    const registry = await getSceneContractRegistry()
    const parsed = parseSceneModule(atomicPilotSource, { file: 'atomic-pilot.scene.ts', registry })
    const compiled = compileSceneModule(parsed.module, registry)
    expect([...parsed.diagnostics, ...compiled.diagnostics]).toEqual([])

    const byOpId = new Map(
      compiled.ops
        .filter((op): op is Extract<(typeof compiled.ops)[number], { type: 'createNode' }> => op.type === 'createNode')
        .map((op) => [op.opId, op]),
    )
    expect(byOpId.has('empty_scene')).toBe(true)
    expect(byOpId.has('rect_grid')).toBe(true)
    expect(byOpId.has('grid2node')).toBe(true)
    expect(byOpId.has('add_child')).toBe(true)
    expect(byOpId.has('tree_merge')).toBe(true)
    expect(byOpId.has('scene_output')).toBe(true)
    const gridNode = [...byOpId.values()].find((op) => op.opId === 'grid2node')
    expect(gridNode).toBeDefined()
    expect(compiled.ops.some((op) =>
      op.type === 'connect' && op.target.nodeId === gridNode!.nodeId && op.target.port === 'name',
    )).toBe(true)
    expect(compiled.sourceMap).toHaveLength(parsed.module.statements.length)
  })
})
