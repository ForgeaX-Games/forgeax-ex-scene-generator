import { describe, expect, it } from 'vitest'
import { getPortTypeColor, isTypeCompatible } from '../../../../../../packages/node-runtime-react/src/editor/utils/portTypes.js'
import { scenePortTypes } from '../scenePortTypes'

describe('scenePortTypes', () => {
  it('marks point2d as a Geometry subtype, not a second payload', () => {
    expect(getPortTypeColor('point2d', scenePortTypes)).toBe('#c4b5fd')
    expect(getPortTypeColor('geometry', scenePortTypes)).toBe('#22d3ee')
    expect(isTypeCompatible('point2d', 'geometry', scenePortTypes)).toBe(true)
    expect(isTypeCompatible('geometry', 'point2d', scenePortTypes)).toBe(false)
    expect(isTypeCompatible('point2d', 'point2d', scenePortTypes)).toBe(true)
  })

  it('marks polyline2d / spline2d / polygon2d / network2d as Geometry subtypes', () => {
    for (const type of ['polyline2d', 'spline2d', 'polygon2d', 'network2d'] as const) {
      expect(isTypeCompatible(type, 'geometry', scenePortTypes)).toBe(true)
      expect(isTypeCompatible('geometry', type, scenePortTypes)).toBe(false)
      expect(isTypeCompatible(type, type, scenePortTypes)).toBe(true)
    }
    expect(isTypeCompatible('polyline2d', 'point2d', scenePortTypes)).toBe(false)
  })

  it('marks point3d / polyline3d / spline3d / polygon3d / network3d as Geometry subtypes', () => {
    expect(getPortTypeColor('point3d', scenePortTypes)).toBe('#e879f9')
    for (const type of ['point3d', 'polyline3d', 'spline3d', 'polygon3d', 'network3d'] as const) {
      expect(isTypeCompatible(type, 'geometry', scenePortTypes)).toBe(true)
      expect(isTypeCompatible('geometry', type, scenePortTypes)).toBe(false)
    }
  })
})
