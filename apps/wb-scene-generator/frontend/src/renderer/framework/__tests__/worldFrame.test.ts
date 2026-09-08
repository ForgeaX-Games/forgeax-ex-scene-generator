import { describe, expect, it } from 'vitest'
import {
  LAYERED_TERRITORY_COMPOSED_PLANES,
  LIVE_LAYERED_TERRITORY_PLANES,
  buildWorldPlaneOverlay,
  createWorldFrameOverlay,
  disposeWorldFrameOverlay,
  worldFrameGridSpec,
} from '../worldFrame'

describe('worldFrame', () => {
  it('uses 1 m cells on a small alpine-sized frame', () => {
    expect(worldFrameGridSpec([])).toEqual({ size: 256, divisions: 256 })
    expect(worldFrameGridSpec([{ id: 'v', name: 'V', origin: [0, 0], extent: [128, 128] }]))
      .toEqual({ size: 256, divisions: 256 })
  })

  it('switches to 8 m cells when the continent plane is present', () => {
    expect(worldFrameGridSpec(LAYERED_TERRITORY_COMPOSED_PLANES)).toEqual({
      size: 2048,
      divisions: 256,
    })
    expect(worldFrameGridSpec(LIVE_LAYERED_TERRITORY_PLANES)).toEqual({
      size: 2048,
      divisions: 256,
    })
    expect(LIVE_LAYERED_TERRITORY_PLANES[1]?.origin).toEqual([0, 0])
  })

  it('builds a named overlay for the layered-territory template', () => {
    const overlay = createWorldFrameOverlay(LAYERED_TERRITORY_COMPOSED_PLANES)
    expect(overlay.name).toBe('world-frame')
    expect(overlay.userData.skipFit).toBe(true)
    expect(overlay.getObjectByName('xy-grid')).toBeTruthy()
    expect(overlay.getObjectByName('xyz-axes')).toBeTruthy()
    expect(overlay.getObjectByName('plane-frame:continent')).toBeTruthy()
    expect(overlay.getObjectByName('plane-frame:valley')).toBeTruthy()
    expect(overlay.getObjectByName('plane-frame:plaza')).toBeTruthy()
    expect(buildWorldPlaneOverlay(LAYERED_TERRITORY_COMPOSED_PLANES).children).toHaveLength(3)
    disposeWorldFrameOverlay(overlay)
  })
})
