import { describe, expect, it } from 'vitest'

import { getSceneContractRegistry } from './contracts.js'
import { resolveFirstBatchLibraryEntries } from '../firstBatchBatteries.js'

describe('scene function catalog', () => {
  it('loads first-batch atomic contracts without defineGroup compile', async () => {
    expect(resolveFirstBatchLibraryEntries().map((item) => item.exportName)).toEqual([
      'allocateSpans',
      'segmentRun',
      'deriveSeed',
      'localFrame',
      'fitAnchor',
      'boundsRelation',
      'point2d',
      'basePlane',
      'polyline2d',
      'spline2d',
      'network2d',
      'polygon2d',
      'geometryMask',
      'point3d',
      'polyline3d',
      'spline3d',
      'polygon3d',
      'network3d',
      'liftToSurface',
      'surfaceBand',
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
      'emptyScene',
      'sceneNode',
      'addChild',
      'sceneOutput',
    ])
    const registry = await getSceneContractRegistry()
    const names = new Set(registry.list().map((item) => item.functionName))
    expect(names.has('point2d')).toBe(true)
    expect(names.has('basePlane')).toBe(true)
    expect(names.has('createGrid')).toBe(true)
    expect(names.has('geometryMask')).toBe(true)
    expect(names.has('heightfield')).toBe(true)
    expect(names.has('heightfieldExplode')).toBe(true)
    expect(names.has('heightfieldSetMask')).toBe(true)
    expect(names.has('composeHeightfield')).toBe(false)
    expect(names.has('heightfieldMesh')).toBe(true)
    expect(names.has('box')).toBe(true)
    expect(names.has('transform')).toBe(true)
    expect(names.has('placeOnGround')).toBe(true)
    expect(names.has('point3d')).toBe(true)
    expect(names.has('liftToSurface')).toBe(true)
    expect(names.has('surfaceBand')).toBe(true)
    expect(names.has('emptyScene')).toBe(true)
    expect(names.has('sceneNode')).toBe(true)
    expect(names.has('addChild')).toBe(true)
    expect(names.has('sceneOutput')).toBe(true)
    expect(registry.list().every((item) => item.kind === 'atomic')).toBe(true)
    expect(names.has('choose')).toBe(false)
    expect(names.has('cityLayoutFromJson')).toBe(false)
    expect(registry.get('point2d')?.opId).toBe('point2d')
    expect(registry.get('basePlane')?.opId).toBe('base_plane')
    expect(registry.get('heightfield')?.inputs.find((port) => port.name === 'attributes')).toEqual(
      expect.objectContaining({ type: 'dict', access: 'item' }),
    )
    expect(registry.get('heightfieldExplode')?.outputs.find((port) => port.name === 'attributes')).toEqual(
      expect.objectContaining({ type: 'dict', access: 'item' }),
    )
    expect(registry.get('polygon2d')?.inputs.find((port) => port.name === 'holes')).toEqual(
      expect.objectContaining({ type: 'point2d', access: 'tree' }),
    )
    expect(registry.get('network2d')?.inputs.find((port) => port.name === 'edges')).toEqual(
      expect.objectContaining({ type: 'dict', access: 'item' }),
    )
    expect(
      ['polygon2d', 'network2d'].flatMap((name) => registry.get(name)?.inputs ?? []).filter((port) => port.type === 'any'),
    ).toEqual([])
    const mathNames = new Set([
      'gridAdd', 'gridSub', 'gridMul', 'gridMin', 'gridMax', 'gridLerp', 'gridChoose',
      'gridMaskDiff', 'gridMaskUnion', 'gridAbs', 'gridNeg', 'gridClamp', 'gridRemap',
      'gridSmoothstep', 'gridQuantize', 'gridBlur', 'gridSharpen', 'gridMedian',
      'gridNeighborhoodMin', 'gridNeighborhoodMax', 'gridDilate', 'gridErodeMorph',
      'gridOpen', 'gridClose', 'gridMajority', 'gridOutline', 'gridSlope', 'gridAspect',
      'gridCurvature', 'gridThreshold', 'gridRangeSelect', 'gridEdge', 'gridBBox',
      'gridComponents', 'gridZonalMean', 'gridStats', 'gridDistance', 'gridResize',
    ])
    expect(
      registry.list()
        .filter((item) => mathNames.has(item.functionName))
        .flatMap((item) => [...item.inputs, ...item.outputs])
        .filter((port) => port.type === 'any'),
    ).toEqual([])
    expect(registry.get('gridAdd')?.inputs.map((port) => [port.name, port.type])).toEqual([
      ['a', 'grid'],
      ['b', 'grid'],
      ['value', 'number'],
      ['mask', 'grid'],
    ])
    expect(registry.get('gridLerp')?.inputs.map((port) => [port.name, port.type])).toEqual([
      ['a', 'grid'],
      ['b', 'grid'],
      ['t', 'number'],
      ['weight', 'grid'],
      ['mask', 'grid'],
    ])
  })
})
