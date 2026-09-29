import { describe, expect, it } from 'vitest'

import {
  authoringParamsFromUpdate,
  classifyUpdateLane,
  classifyWriteLane,
  isLiteralOnlyAuthoring,
  uniqueSceneBinding,
} from './writeLanes.js'

describe('writeLanes', () => {
  it('does not mint a binding that shadows a host import', () => {
    expect(uniqueSceneBinding('point2d')).toBe('site')
    expect(uniqueSceneBinding('point3d')).toBe('site3')
    expect(uniqueSceneBinding('polyline2d')).toBe('line')
    expect(uniqueSceneBinding('polyline3d')).toBe('line3')
    expect(uniqueSceneBinding('spline2d')).toBe('curve')
    expect(uniqueSceneBinding('spline3d')).toBe('curve3')
    expect(uniqueSceneBinding('polygon2d')).toBe('region')
    expect(uniqueSceneBinding('polygon3d')).toBe('region3')
    expect(uniqueSceneBinding('network2d')).toBe('net')
    expect(uniqueSceneBinding('network3d')).toBe('net3')
    expect(uniqueSceneBinding('liftToSurface')).toBe('lifted')
    expect(uniqueSceneBinding('surfaceBand')).toBe('ribbon')
    expect(uniqueSceneBinding('geometryMask')).toBe('mask')
    expect(uniqueSceneBinding('jsonPanel')).toBe('rec')
    expect(uniqueSceneBinding('basePlane')).toBe('world')
    expect(uniqueSceneBinding('heightfield')).toBe('field')
    expect(uniqueSceneBinding('heightfieldExplode')).toBe('parts')
    expect(uniqueSceneBinding('heightfieldSetMask')).toBe('marked')
    expect(uniqueSceneBinding('heightfieldMesh')).toBe('woven')
    expect(uniqueSceneBinding('box')).toBe('solid')
    expect(uniqueSceneBinding('transform')).toBe('posed')
    expect(uniqueSceneBinding('placeOnGround')).toBe('grounded')
    expect(uniqueSceneBinding('createGrid')).toBe('grid')
    expect(uniqueSceneBinding('gridFill')).toBe('filled')
    expect(uniqueSceneBinding('gridGradient')).toBe('ramp')
    expect(uniqueSceneBinding('gridDiamondSquare')).toBe('diamond')
    expect(uniqueSceneBinding('gridMidpoint')).toBe('midpoint')
    expect(uniqueSceneBinding('hashNoise')).toBe('hash')
    expect(uniqueSceneBinding('perlinNoise')).toBe('perlin')
    expect(uniqueSceneBinding('openSimplex2Noise')).toBe('simplex')
    expect(uniqueSceneBinding('cellularNoise')).toBe('cellular')
    expect(uniqueSceneBinding('gridAdd')).toBe('sum')
    expect(uniqueSceneBinding('gridErodeMorph')).toBe('thin')
    expect(uniqueSceneBinding('gridCurvature')).toBe('bend')
    expect(uniqueSceneBinding('gridBBox')).toBe('bounds')
    expect(uniqueSceneBinding('gridComponents')).toBe('patches')
    expect(uniqueSceneBinding('gridZonalMean')).toBe('zonal')
    expect(uniqueSceneBinding('gridStats')).toBe('stats')
    expect(uniqueSceneBinding('gridDistance')).toBe('dist')
    expect(uniqueSceneBinding('gridResize')).toBe('resized')
    expect(uniqueSceneBinding('heightfield', ['field'])).toBe('field2')
    expect(uniqueSceneBinding('heightfield', ['field', 'heightfield'])).toBe('field2')
  })

  it('keeps only the primitive value for AuthoringWrite', () => {
    expect(authoringParamsFromUpdate({
      value: 48,
      min: 0,
      max: 96,
      precision: 0,
      __sceneScriptFunctionName: 'numberValue',
    })).toEqual({ value: 48 })
  })

  it('classifies ephemeral and presentation updates as RuntimeWrite', () => {
    const op = { type: 'updateNode' as const, nodeId: 'n1', params: { value: 8, min: 0, max: 16 } }
    expect(classifyUpdateLane(op, 'number_const', true)).toBe('runtime')
    expect(classifyWriteLane(
      { type: 'updateNode', nodeId: 'n1', params: { max: 99 } },
      { n1: { id: 'n1', opId: 'number_const', params: { value: 8, min: 0, max: 16, precision: 0 } } },
      false,
    )).toBe('runtime')
  })

  it('classifies a settled primitive value as AuthoringWrite', () => {
    expect(classifyUpdateLane(
      { type: 'updateNode', nodeId: 'n1', params: { value: 8, min: 0, max: 16 } },
      'number_const',
      false,
    )).toBe('authoring')
    expect(classifyWriteLane(
      { type: 'createNode', nodeId: 'n2', opId: 'base_plane', params: {} },
      {},
      false,
    )).toBe('authoring')
    expect(classifyUpdateLane(
      { type: 'updateNode', nodeId: 'strip', params: { height: 400 } },
      'base_plane',
      false,
    )).toBe('authoring')
    expect(classifyUpdateLane(
      { type: 'updateNode', nodeId: 'strip', params: { min: 0, max: 16, __sceneScriptFunctionName: 'numberValue' } },
      'base_plane',
      false,
    )).toBe('runtime')
  })

  it('treats literal and single-argument updates as incremental imports', () => {
    expect(isLiteralOnlyAuthoring([
      { type: 'updateLiteral', statementId: 'w', value: 48 },
    ])).toBe(true)
    expect(isLiteralOnlyAuthoring([
      { type: 'updateArguments', statementId: 'strip', set: { height: { kind: 'literal', value: 3 } }, unset: ['min'] },
    ])).toBe(true)
    expect(isLiteralOnlyAuthoring([
      { type: 'addCall', functionName: 'basePlane', args: {} },
    ])).toBe(false)
  })
})
