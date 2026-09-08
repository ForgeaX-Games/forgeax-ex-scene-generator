import { describe, expect, it } from 'vitest'

import {
  isSinoApprovedContract,
  projectSinoContractCatalog,
  SINO_AUTHORING_ROUTES,
  SINO_CATALOG_VERSION,
  SINO_COMPOSITION_FUNCTIONS,
  SINO_REPRESENTATION,
  PROJECT_GENERATOR_ABI,
  SCENE_SCRIPT_BUILTINS,
  SINO_SPATIAL_FUNCTIONS,
  SINO_UTILITY_FUNCTIONS,
} from './agentContractCatalog.js'
import { getSceneContractRegistry } from './contracts.js'

describe('Sino code-first Scene Contract disclosure', () => {
  it('returns composition, metre-space, and project Generator surfaces without legacy Templates', async () => {
    const contracts = (await getSceneContractRegistry()).list()
    const result = projectSinoContractCatalog(contracts, { mode: 'summary' })
    const expected = new Set([
      ...SINO_UTILITY_FUNCTIONS,
      ...SINO_COMPOSITION_FUNCTIONS,
      ...SINO_SPATIAL_FUNCTIONS,
    ])

    expect(result.version).toBe(SINO_CATALOG_VERSION)
    expect(result.scope).toBe('scene-project-code-first')
    expect(result.mode).toBe('summary')
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(20 * 1024)
    expect(result.functions).toHaveLength(expected.size)
    expect(result.functions.every((summary) => {
      const source = contracts.find((contract) => contract.functionName === summary.functionName)
      return source ? isSinoApprovedContract(source) : false
    })).toBe(true)
    expect(new Set(result.functions.map((item) => item.functionName))).toEqual(expected)
    expect(result.routing).toEqual(SINO_AUTHORING_ROUTES)
    expect(result.routing[0]).toEqual(expect.objectContaining({ kind: 'terrain-mesh' }))
    expect(result.representation).toEqual(SINO_REPRESENTATION)
    expect(result.functions.find((item) => item.functionName === 'scopeSceneNode')).toEqual(
      expect.objectContaining({ category: 'composition' }),
    )
    expect(result.functions.find((item) => item.functionName === 'basePlane')).toEqual(
      expect.objectContaining({ category: 'spatial' }),
    )
    for (const summary of result.functions.filter((item) =>
      item.category === 'composition' || item.category === 'spatial')) {
      const source = contracts.find((contract) => contract.functionName === summary.functionName)!
      expect(summary.inputUsage).toEqual(source.inputs.map((port) => ({
        name: port.name,
        required: port.required === true,
        ...(port.defaultValue !== undefined ? { defaultValue: port.defaultValue } : {}),
        ...(port.mode ? { mode: port.mode } : {}),
      })))
    }
    expect(result.functions.find((item) => item.functionName === 'basePlane')?.inputUsage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'width', required: false }),
        expect.objectContaining({ name: 'height', required: false }),
      ]),
    )
    expect(result.functions.find((item) => item.functionName === 'scopeSceneNode')?.inputUsage)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ name: expect.any(String), required: expect.any(Boolean) }),
      ]))
    expect(result.functions.some((item) => item.functionName === 'addBaseGrid')).toBe(false)
    expect(result.functions.some((item) => item.functionName === 'areaPartition')).toBe(false)
    expect(result.functions.some((item) => item.functionName === 'pathConnectionLink')).toBe(false)
    expect(result.functions.some((item) => item.functionName === 'emptyScene')).toBe(true)
    expect(result.functions.some((item) => item.functionName === 'numberValue')).toBe(true)
    expect(result.generatorAbi).toEqual(PROJECT_GENERATOR_ABI)
    expect(result.generatorAbi.portTypes.spatial).toEqual(expect.arrayContaining([
      'Plane',
      'WorkGrid',
      'RegionSet',
      'RoadNetwork',
      'ParcelSet',
      'PlacementSet',
    ]))
    expect(result.builtins).toEqual(SCENE_SCRIPT_BUILTINS)
    expect(result.builtins.map((item) => item.functionName)).toEqual(['choose', 'repeat'])
    expect(JSON.stringify(result)).not.toContain('"definition"')
    expect(result.functions.filter((item) => item.category === 'utility')
      .every((item) => !('inputUsage' in item))).toBe(true)
  })

  it('returns full public signatures only for bounded exact composition names', async () => {
    const contracts = (await getSceneContractRegistry()).list()
    const result = projectSinoContractCatalog(contracts, {
      mode: 'detail',
      functionNames: ['basePlane', 'workGrid', 'scopeSceneNode', 'addBaseGrid'],
    })

    expect(result.mode).toBe('detail')
    expect(result.functions.map((item) => item.functionName)).toEqual([
      'basePlane',
      'workGrid',
      'scopeSceneNode',
    ])
    expect(result.notFound).toEqual(['addBaseGrid'])
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(32 * 1024)
    expect(result.functions.every((item) => item.maturity === 'platform-primitive')).toBe(true)
    expect(result.functions.find((item) => item.functionName === 'basePlane')?.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'width', acceptsLiteral: true }),
        expect.objectContaining({ name: 'height', acceptsLiteral: true }),
      ]),
    )
  })

  it('returns defineGenerator as a first-class authoring contract', async () => {
    const contracts = (await getSceneContractRegistry()).list()
    const result = projectSinoContractCatalog(contracts, {
      mode: 'detail',
      functionNames: ['defineGenerator'],
    })

    expect(result.notFound).toEqual([])
    expect(result.functions).toEqual([
      expect.objectContaining({
        functionName: 'defineGenerator',
        kind: 'project-generator-authoring-abi',
        opId: 'local/<id>',
        contractSource: expect.stringContaining('Static defineGenerator AST'),
      }),
    ])
  })

  it('fully discloses the editable scaffold contract without box-city detours', async () => {
    const contracts = (await getSceneContractRegistry()).list()
    const summary = projectSinoContractCatalog(contracts, { mode: 'summary' })
    const names = summary.functions.map((item) => item.functionName)
    expect(names).toEqual(expect.arrayContaining([
      'basePlane',
      'workGrid',
      'rectangularGrid',
      'valleyHeightfield',
      'heightfieldMesh',
      'meshSceneNode',
      'gridSceneNode',
      'pointsToNode',
      'addSceneChildren',
      'sceneOutput',
    ]))
    expect(names).not.toEqual(expect.arrayContaining(['gridToBoxes', 'gabledHouses']))

    const detail = projectSinoContractCatalog(contracts, {
      mode: 'detail',
      functionNames: ['heightfieldMesh', 'valleyHeightfield', 'rectangularGrid', 'gridSceneNode'],
    })
    expect(detail.notFound).toEqual([])
    expect(detail.functions.map((item) => item.functionName)).toEqual([
      'heightfieldMesh',
      'valleyHeightfield',
      'rectangularGrid',
      'gridSceneNode',
    ])
    expect(detail.functions.find((item) => item.functionName === 'gridSceneNode')?.description)
      .toMatch(/Occupancy overlay[\s\S]*Not terrain/i)
    expect(detail.functions.find((item) => item.functionName === 'heightfieldMesh')?.description)
      .toMatch(/Terrain surface[\s\S]*meshSceneNode/i)
  })

  it('keeps the code-first allowlists explicit and auditable', () => {
    expect(SINO_UTILITY_FUNCTIONS).toEqual(['booleanValue', 'numberValue', 'emptyScene', 'sceneOutput'])
    expect(SINO_COMPOSITION_FUNCTIONS).toEqual([
      'scopeSceneNode',
      'addSceneChildren',
      'meshSceneNode',
      'gridSceneNode',
      'pointsToNode',
      'controlPoints',
      'bindMaterial',
      'previewSurface',
      'materialLook',
    ])
    expect(SINO_SPATIAL_FUNCTIONS).toEqual([
      'basePlane',
      'workGrid',
      'rectangularGrid',
      'valleyHeightfield',
      'heightfieldMesh',
      'extractPlane',
      'place',
      'prototypeCatalog',
      'instantiatePlacements',
    ])
    const all = [...SINO_UTILITY_FUNCTIONS, ...SINO_COMPOSITION_FUNCTIONS, ...SINO_SPATIAL_FUNCTIONS]
    expect(all).not.toEqual(expect.arrayContaining([
      'addBaseGrid',
      'areaPartition',
      'pathConnectionLink',
      'naturalDecorationDistribution',
      'seed',
      'stringConcat',
      'gridToBoxes',
      'gabledHouses',
    ]))
  })

  it('discloses only project-local Generator contracts dynamically', () => {
    const localGenerator = {
      functionName: 'solveCourtyard',
      kind: 'atomic' as const,
      contractVersion: '1',
      opId: 'local/solve-courtyard',
      definitionId: 'solve-courtyard',
      definitionVersion: '1',
      description: 'Solve one project courtyard.',
      sourceKind: 'generator' as const,
      sourceFile: 'generators/solve-courtyard.generator.ts',
      inputs: [{ name: 'site', type: 'any', runtimeType: 'region-set' }],
      outputs: [{ name: 'placements', type: 'any', runtimeType: 'placement-set' }],
    }
    const unrelatedBattery = {
      ...localGenerator,
      functionName: 'cellularNoise',
      opId: 'cellular_noise',
      sourceKind: 'battery' as const,
    }
    const summary = projectSinoContractCatalog([localGenerator, unrelatedBattery], { mode: 'summary' })
    expect(summary.functions).toEqual([
      expect.objectContaining({
        functionName: 'solveCourtyard',
        category: 'project-generator',
        inputs: ['site:any<region-set>'],
      }),
    ])
    const detail = projectSinoContractCatalog([localGenerator, unrelatedBattery], {
      mode: 'detail',
      functionNames: ['solveCourtyard', 'cellularNoise'],
    })
    expect(detail.functions[0]).toEqual(expect.objectContaining({
      sourceKind: 'generator',
      sourceFile: 'generators/solve-courtyard.generator.ts',
      opId: 'local/solve-courtyard',
    }))
    expect(detail.notFound).toEqual(['cellularNoise'])
  })
})
