import { describe, expect, it } from 'vitest'

import {
  isSinoApprovedContract,
  projectSinoContractCatalog,
  SINO_AUTHORING_ROUTES,
  SINO_CATALOG_VERSION,
  SINO_COMPOSITION_FUNCTIONS,
  SINO_GEOMETRY_FUNCTIONS,
  SINO_REPRESENTATION,
  SINO_SPATIAL_FUNCTIONS,
  SINO_UTILITY_FUNCTIONS,
  sinoApprovedFunctionNames,
} from './agentContractCatalog.js'
import { getSceneContractRegistry } from './contracts.js'

describe('Sino code-first Scene Contract disclosure', () => {
  it('returns only the Modeling BasePlane allowlist plus project Generators', async () => {
    const contracts = (await getSceneContractRegistry()).list()
    const result = projectSinoContractCatalog(contracts, { mode: 'summary' })
    const expected = new Set(sinoApprovedFunctionNames())

    expect(result.version).toBe(SINO_CATALOG_VERSION)
    expect(result.scope).toBe('scene-project-code-first')
    expect(result.mode).toBe('summary')
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(12 * 1024)
    expect(result.functions).toHaveLength(expected.size)
    expect(result.functions.every((summary) => {
      const source = contracts.find((contract) => contract.functionName === summary.functionName)
      return source ? isSinoApprovedContract(source) : false
    })).toBe(true)
    expect(new Set(result.functions.map((item) => item.functionName))).toEqual(expected)
    expect(result.routing).toEqual(SINO_AUTHORING_ROUTES)
    expect(result.routing[0]).toEqual(expect.objectContaining({ kind: 'operating-geometry' }))
    expect(result.representation).toEqual(SINO_REPRESENTATION)
    expect(result.functions.find((item) => item.functionName === 'basePlane')).toEqual(
      expect.objectContaining({ category: 'spatial' }),
    )
    expect(result.functions.every((item) => !('inputUsage' in item) && !('inputs' in item))).toBe(true)
    expect(result).not.toHaveProperty('generatorAbi')
    expect(result).not.toHaveProperty('builtins')
    expect(result.next).toEqual(expect.objectContaining({
      mode: 'detail',
      instruction: expect.any(String),
      maxFunctionNames: 6,
    }))
    expect(result.functions.some((item) => item.functionName === 'cityLayoutFromJson')).toBe(false)
    expect(result.functions.some((item) => item.functionName === 'emptyScene')).toBe(true)
    expect(result.functions.some((item) => item.functionName === 'wall')).toBe(false)
    expect(JSON.stringify(result)).not.toContain('"definition"')
  })

  it('returns full public signatures only for bounded exact allowlisted names', async () => {
    const contracts = (await getSceneContractRegistry()).list()
    const result = projectSinoContractCatalog(contracts, {
      mode: 'detail',
      functionNames: ['basePlane', 'createGrid', 'workGrid', 'wall', 'addBaseGrid'],
    })

    expect(result.mode).toBe('detail')
    expect(result.functions.map((item) => item.functionName)).toEqual(['basePlane', 'createGrid'])
    expect(result.notFound).toEqual(['workGrid', 'wall', 'addBaseGrid'])
    expect(result.functions.find((item) => item.functionName === 'basePlane')?.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'origin', acceptsLiteral: true }),
        expect.objectContaining({ name: 'width', acceptsLiteral: true }),
        expect.objectContaining({ name: 'height', acceptsLiteral: true }),
      ]),
    )
    expect(result.functions.find((item) => item.functionName === 'basePlane')?.outputs).toEqual([
      expect.objectContaining({ name: 'geometry', type: 'geometry' }),
    ])
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
        portTypes: expect.objectContaining({
          shapes: ['Item<T>', 'List<T>', 'ShapeTree<T>', 'SceneTree'],
          spatial: expect.arrayContaining(['Geometry', 'Grid', 'Heightfield', 'Scene']),
        }),
      }),
    ])
  })

  it('keeps the code-first allowlists explicit and auditable', () => {
    expect([...SINO_UTILITY_FUNCTIONS]).toEqual(['deriveSeed'])
    expect([...SINO_COMPOSITION_FUNCTIONS]).toEqual(['emptyScene', 'sceneNode', 'addChild', 'sceneOutput'])
    expect([...SINO_SPATIAL_FUNCTIONS]).toEqual([
      'allocateSpans',
      'segmentRun',
      'localFrame',
      'fitAnchor',
      'boundsRelation',
      'point2d',
      'basePlane',
      'polyline2d',
      'spline2d',
      'polygon2d',
      'network2d',
      'point3d',
      'polyline3d',
      'spline3d',
      'polygon3d',
      'network3d',
      'geometryMask',
      'createGrid',
      'gridFill',
      'gridGradient',
      'gridDiamondSquare',
      'gridMidpoint',
      'hashNoise',
      'valueNoise',
      'valueCubicNoise',
      'perlinNoise',
      'openSimplex2Noise',
      'openSimplex2sNoise',
      'cellularNoise',
      'gridAdd',
      'gridSub',
      'gridMul',
      'gridMin',
      'gridMax',
      'gridLerp',
      'gridChoose',
      'gridMaskDiff',
      'gridMaskUnion',
      'gridAbs',
      'gridNeg',
      'gridClamp',
      'gridRemap',
      'gridSmoothstep',
      'gridQuantize',
      'gridBlur',
      'gridSharpen',
      'gridMedian',
      'gridNeighborhoodMin',
      'gridNeighborhoodMax',
      'gridDilate',
      'gridErodeMorph',
      'gridOpen',
      'gridClose',
      'gridMajority',
      'gridOutline',
      'gridSlope',
      'gridAspect',
      'gridCurvature',
      'gridThreshold',
      'gridRangeSelect',
      'gridEdge',
      'gridBBox',
      'gridComponents',
      'gridZonalMean',
      'gridStats',
      'gridDistance',
      'gridResize',
      'heightfield',
      'heightfieldExplode',
      'heightfieldSetMask',
      'heightfieldMesh',
      'box',
      'transform',
      'placeOnGround',
      'liftToSurface',
      'surfaceBand',
    ])
    expect([...SINO_GEOMETRY_FUNCTIONS]).toEqual([])
    expect(sinoApprovedFunctionNames()).toEqual([
      'deriveSeed',
      'emptyScene',
      'sceneNode',
      'addChild',
      'sceneOutput',
      'allocateSpans',
      'segmentRun',
      'localFrame',
      'fitAnchor',
      'boundsRelation',
      'point2d',
      'basePlane',
      'polyline2d',
      'spline2d',
      'polygon2d',
      'network2d',
      'point3d',
      'polyline3d',
      'spline3d',
      'polygon3d',
      'network3d',
      'geometryMask',
      'createGrid',
      'gridFill',
      'gridGradient',
      'gridDiamondSquare',
      'gridMidpoint',
      'hashNoise',
      'valueNoise',
      'valueCubicNoise',
      'perlinNoise',
      'openSimplex2Noise',
      'openSimplex2sNoise',
      'cellularNoise',
      'gridAdd',
      'gridSub',
      'gridMul',
      'gridMin',
      'gridMax',
      'gridLerp',
      'gridChoose',
      'gridMaskDiff',
      'gridMaskUnion',
      'gridAbs',
      'gridNeg',
      'gridClamp',
      'gridRemap',
      'gridSmoothstep',
      'gridQuantize',
      'gridBlur',
      'gridSharpen',
      'gridMedian',
      'gridNeighborhoodMin',
      'gridNeighborhoodMax',
      'gridDilate',
      'gridErodeMorph',
      'gridOpen',
      'gridClose',
      'gridMajority',
      'gridOutline',
      'gridSlope',
      'gridAspect',
      'gridCurvature',
      'gridThreshold',
      'gridRangeSelect',
      'gridEdge',
      'gridBBox',
      'gridComponents',
      'gridZonalMean',
      'gridStats',
      'gridDistance',
      'gridResize',
      'heightfield',
      'heightfieldExplode',
      'heightfieldSetMask',
      'heightfieldMesh',
      'box',
      'transform',
      'placeOnGround',
      'liftToSurface',
      'surfaceBand',
    ])
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
      functionName: 'fieldNoise',
      opId: 'field_noise',
      sourceKind: 'battery' as const,
    }
    const summary = projectSinoContractCatalog([localGenerator, unrelatedBattery], { mode: 'summary' })
    expect(summary.functions).toEqual([
      expect.objectContaining({
        functionName: 'solveCourtyard',
        category: 'project-generator',
      }),
    ])
    expect(summary.functions[0]).not.toHaveProperty('inputs')
    const detail = projectSinoContractCatalog([localGenerator, unrelatedBattery], {
      mode: 'detail',
      functionNames: ['solveCourtyard', 'fieldNoise'],
    })
    expect(detail.functions[0]).toEqual(expect.objectContaining({
      sourceKind: 'generator',
      sourceFile: 'generators/solve-courtyard.generator.ts',
      opId: 'local/solve-courtyard',
    }))
    expect(detail.notFound).toEqual(['fieldNoise'])
  })

  it('does not load or disclose CAD g_* geometry ops', async () => {
    const contracts = (await getSceneContractRegistry()).list()
    expect(contracts.some((item) => item.opId?.startsWith('g_'))).toBe(false)
    expect(contracts.some((item) => item.functionName === 'wall')).toBe(false)
    const summary = projectSinoContractCatalog(contracts, { mode: 'summary' })
    expect(summary.functions.some((item) => item.functionName === 'union')).toBe(false)
    expect(summary.functions.some((item) => item.functionName === 'wall')).toBe(false)

    const detail = projectSinoContractCatalog(contracts, {
      mode: 'detail',
      functionNames: ['union', 'wall', 'geometryToMesh'],
    })
    expect(detail.notFound).toEqual(['union', 'wall', 'geometryToMesh'])
    expect(detail.functions).toEqual([])
  })

  it('does not disclose choose / repeat as platform builtins', async () => {
    const contracts = (await getSceneContractRegistry()).list()
    const detail = projectSinoContractCatalog(contracts, {
      mode: 'detail',
      functionNames: ['choose', 'repeat'],
    })
    expect(detail.notFound).toEqual(['choose', 'repeat'])
    expect(detail.functions).toEqual([])
  })
})
