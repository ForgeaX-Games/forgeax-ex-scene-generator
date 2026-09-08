import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { addChild } from '../../batteries/scene/manage/add_child/index.js'
import { refSceneNode } from '../../batteries/scene/bridge/ref_scene_node/index.js'
import { scopeSceneNode } from '../../batteries/scene/bridge/scope_scene_node/index.js'
import { compileStoredSceneProject } from '../src/scene-script/compile/projectCompiler.js'
import { getSceneContractRegistry } from '../src/scene-script/contracts/contracts.js'
import { childrenOf, contentSchema, getNode, parseScenePort } from '../../vendor/shared/types/index.js'

const HOUSE_BOX_SOURCE = `// @scene-module-id module.houseBox
export const HouseBox = defineGroup(
  {
    id: "house-box",
    version: "1.0.0",
    inputs: {
      points: { type: Point2d, access: "list", required: true, label: "宅基点" },
      heightGrid: { type: Grid, label: "高度场" },
      z: { type: NumberList, label: "底面高度" },
      yaw: { type: NumberList, label: "朝向" },
    },
    outputs: { scene: { type: Scene, label: "房子" } },
  },
  ({ points, heightGrid, z, yaw }) => {
    const houses = gabledHouses({
      points,
      heightGrid,
      z,
      yaw,
      buildingHeight: 2.1,
      roofHeight: 2.3,
      footprint: 1.8,
      depth: 1.7,
    })
    const houseBox = refSceneNode({
      name: "HouseBox",
      module: "modules/house-box.scene.ts",
      exportName: "HouseBox",
      mesh: houses.mesh,
    })
    const housesRoot = scopeSceneNode({
      name: "Houses",
      schema: "houses",
    })
    const nested = addSceneChildren({
      scene: housesRoot.scene,
      nodes: houseBox.scene,
    })
    return { scene: nested.scene }
  },
)
`

const VALLEY_SOURCE = `// @scene-module-id module.valley
import { HouseBox } from "./modules/house-box.scene.ts"

const vField = valleyHeightfield({ width: 48, height: 48, valleyDepth: 8.5, valleyWidth: 12, seed: 23 })
const terrain = heightfieldMesh({ grid: vField.heightGrid })
const meshNode = meshSceneNode({ name: "Terrain", mesh: terrain.mesh })
const mainRoad = controlPoints({ points: [[4, 23], [16, 21], [32, 26], [44, 24]] })
const center = splineSample({ points: mainRoad.points, roadWidth: 3, samplesPerSegment: 8 })
const road = strokeSweepMesh({ points: center.points, widths: center.widths, heightGrid: vField.heightGrid })
const roadNode = meshSceneNode({ name: "Road", mesh: road.mesh })
const plots = pointsAlongPolyline({ points: center.points, widths: center.widths, count: 4, margin: 2.2, seed: 3 })
const sampled = sampleHeight({ grid: vField.heightGrid, points: plots.points })
const houses = HouseBox({ points: plots.points, heightGrid: vField.heightGrid, z: sampled.heights, yaw: plots.yaw })
const guide = pointsToNode({ name: "Guide", points: mainRoad.points })
const withRoad = addSceneChildren({ scene: meshNode.scene, nodes: roadNode.scene })
const withHouses = addSceneChildren({ scene: withRoad.scene, nodes: houses.scene })
export const valley = addSceneChildren({ scene: withHouses.scene, nodes: guide.scene })
`

const MAIN_SOURCE = `// @scene-module-id module.main
import { valley } from "./valley.scene.ts"
sceneOutput({ scene: valley.scene })
`

describe('S11 house module Ref', () => {
  it('registers refSceneNode and scopeSceneNode', async () => {
    const registry = await getSceneContractRegistry()
    expect(registry.get('refSceneNode')?.opId).toBe('ref_scene_node')
    expect(registry.get('scopeSceneNode')?.opId).toBe('scope_scene_node')
  })

  it('grafts a mesh-less Ref under Houses without throwing', () => {
    const houseBox = refSceneNode({
      name: 'HouseBox',
      module: 'modules/house-box.scene.ts',
      exportName: 'HouseBox',
    })
    const housesRoot = scopeSceneNode({ name: 'Houses', schema: 'houses' })
    const nested = addChild({ scene: housesRoot.scene, nodes: [houseBox.scene] })
    expect(nested.error).toBeUndefined()
    const port = parseScenePort(nested.scene)
    expect(port).toBeTruthy()
    const parent = getNode(port!.graph, port!.focus)
    expect(parent?.name).toBe('Houses')
    expect(parent?.schema).toBe('houses')
    const children = childrenOf(port!.graph, port!.focus)
    expect(children).toHaveLength(1)
    expect(children[0]?.name).toBe('HouseBox')
    expect(children[0]?.schema).toBe('ref')
    expect(contentSchema(children[0]?.content)).toBe('ref')
  })

  it('compiles valley importing HouseBox as a project Definition, not flattened house mesh nodes', async () => {
    const registry = await getSceneContractRegistry()
    const projectDir = mkdtempSync(join(tmpdir(), 's11-house-ref-'))
    try {
      const result = await compileStoredSceneProject(projectDir, {
        entryFile: 'scene/main.scene.ts',
        entrySource: MAIN_SOURCE,
        sourceOverrides: {
          'scene/main.scene.ts': MAIN_SOURCE,
          'scene/valley.scene.ts': VALLEY_SOURCE,
          'scene/modules/house-box.scene.ts': HOUSE_BOX_SOURCE,
        },
        projectId: 's11-house-ref',
        registry,
      })
      const diagnostics = [...result.diagnostics, ...result.compiled.diagnostics]
      expect(diagnostics).toEqual([])
      expect(result.compiled.ops.some((op) => op.type === 'createGroup')).toBe(true)
      expect(result.compiled.ops.some((op) => 'opId' in op && op.opId === 'ref_scene_node')).toBe(true)
      expect(result.compiled.ops.some((op) => 'opId' in op && op.opId === 'scope_scene_node')).toBe(true)
      expect(result.compiled.ops.some((op) => 'opId' in op && op.opId === 'gabled_houses')).toBe(true)
      const valleyCreate = result.compiled.ops.filter((op) => op.type === 'createNode')
      expect(valleyCreate.some((op) => op.opId === 'mesh_to_node' && op.params?.name === 'Houses')).toBe(false)
    } finally {
      rmSync(projectDir, { recursive: true, force: true })
    }
  })
})
