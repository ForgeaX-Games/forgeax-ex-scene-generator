import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  LAYERED_TERRITORY_COMPOSED_PLANES,
  LIVE_LAYERED_TERRITORY_PLANES,
  buildWorldPlaneOverlay,
  createWorldFrameOverlay,
  disposeWorldFrameOverlay,
  orientWorldPointMarks,
  syncWorldFrameOverlay,
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
    expect(worldFrameGridSpec([{ id: 'world', name: 'World', origin: [0, 0], extent: [1400, 1000] }]))
      .toEqual({ size: 256, divisions: 256 })
    expect(worldFrameGridSpec([{ id: 'world', name: 'World', origin: [0, 0], extent: [200, 80] }]))
      .toEqual({ size: 256, divisions: 256 })
  })

  it('keeps the metre grid still when a BasePlane slider changes extent', () => {
    const first = createWorldFrameOverlay([{ id: 'strip', name: 'Strip', origin: [0, 1200], extent: [1200, 400] }])
    const grid = first.getObjectByName('xy-grid')
    const axes = first.getObjectByName('xyz-axes')
    const next = syncWorldFrameOverlay(first, [{ id: 'strip', name: 'Strip', origin: [0, 1200], extent: [1200, 208] }])
    expect(next).toBe(first)
    expect(next.getObjectByName('xy-grid')).toBe(grid)
    expect(next.getObjectByName('xyz-axes')).toBe(axes)
    expect(next.getObjectByName('plane-frame:strip')).toBeTruthy()
    disposeWorldFrameOverlay(next)
  })

  it('builds named overlay frames for composed world rectangles', () => {
    const overlay = createWorldFrameOverlay(LAYERED_TERRITORY_COMPOSED_PLANES)
    expect(overlay.name).toBe('world-frame')
    expect(overlay.userData.skipFit).toBe(true)
    expect(overlay.getObjectByName('xy-grid')).toBeTruthy()
    expect(overlay.getObjectByName('xyz-axes')).toBeTruthy()
    expect(overlay.getObjectByName('plane-frame:continent')).toBeTruthy()
    expect(overlay.getObjectByName('plane-frame:valley')).toBeTruthy()
    expect(overlay.getObjectByName('plane-frame:plaza')).toBeTruthy()
    const frames = buildWorldPlaneOverlay(LAYERED_TERRITORY_COMPOSED_PLANES)
    expect(frames.getObjectByName('plane-frame:continent')).toBeTruthy()
    expect(frames.getObjectByName('plane-frame:valley')).toBeTruthy()
    expect(frames.getObjectByName('plane-frame:plaza')).toBeTruthy()
    disposeWorldFrameOverlay(overlay)
  })

  it('draws a screen-facing X sprite for a point2d site', () => {
    const overlay = createWorldFrameOverlay([], null, [], [{ id: 'site', name: 'Site', nodeId: 'site', x: 4, y: 6 }])
    const mark = overlay.getObjectByName('point-mark:site')
    expect(mark).toBeInstanceOf(THREE.Sprite)
    expect(overlay.getObjectByName('world-point-marks')).toBeTruthy()
    const next = syncWorldFrameOverlay(overlay, [], null, [], [{ id: 'site', name: 'Site', nodeId: 'site', x: 8, y: 2 }])
    expect(next.getObjectByName('point-mark:site')).toBeInstanceOf(THREE.Sprite)
    disposeWorldFrameOverlay(next)
  })

  it('lifts a draped polyline onto Heightfield Z instead of the plan', () => {
    const overlay = createWorldFrameOverlay([], null, [], [], [{
      id: 'line',
      name: 'Line',
      nodeId: 'line',
      kind: 'polyline',
      strokes: [{ points: [[0, 0, 24], [10, 0, 24]] }],
    }])
    const stroke = overlay.getObjectByName('curve-stroke:line:0') as THREE.Line
    const z = stroke.geometry.getAttribute('position').array[2]
    expect(z).toBeGreaterThan(20)
    disposeWorldFrameOverlay(overlay)
  })

  it('draws a plan-space polyline stroke for operating curve Geometry', () => {
    const overlay = createWorldFrameOverlay([], null, [], [], [{
      id: 'line',
      name: 'Line',
      nodeId: 'line',
      kind: 'polyline',
      strokes: [{ points: [[0, 0], [10, 0]] }],
    }])
    expect(overlay.getObjectByName('world-curve-strokes')).toBeTruthy()
    expect(overlay.getObjectByName('curve-frame:line')).toBeTruthy()
    expect(overlay.getObjectByName('curve-stroke:line:0')).toBeInstanceOf(THREE.Line)
    const next = syncWorldFrameOverlay(overlay, [], null, [], [], [{
      id: 'line',
      name: 'Line',
      nodeId: 'line',
      kind: 'polyline',
      strokes: [{ points: [[0, 0], [8, 4]] }],
    }])
    expect(next.getObjectByName('curve-stroke:line:0')).toBeInstanceOf(THREE.Line)
    disposeWorldFrameOverlay(next)
  })

  it('draws a sampled spline as a plan stroke plus a visible ribbon', () => {
    const overlay = createWorldFrameOverlay([], null, [], [], [{
      id: 'ridge',
      name: 'Ridge',
      nodeId: 'ridge',
      kind: 'spline',
      strokes: [{ points: [[40, 0], [30, 20], [18, 48], [28, 38], [40, 30]] }],
      vertices: [[40, 0], [18, 48], [40, 30]],
    }])
    expect(overlay.getObjectByName('curve-stroke:ridge:0')).toBeInstanceOf(THREE.Line)
    expect(overlay.getObjectByName('curve-ribbon:ridge:0')).toBeInstanceOf(THREE.Mesh)
    expect(overlay.getObjectByName('curve-verts:ridge')).toBeInstanceOf(THREE.Points)
    disposeWorldFrameOverlay(overlay)
  })

  it('draws Geometry3d at authored Z with a point stem and no plan-only stroke', () => {
    const overlay = createWorldFrameOverlay(
      [],
      null,
      [],
      [{ id: 'site3', name: 'P', nodeId: 'p3', x: 4, y: 2, z: 9, space: 'world3d' }],
      [{
        id: 'line3',
        name: 'Line3',
        nodeId: 'l3',
        kind: 'polyline',
        space: 'world3d',
        strokes: [{ points: [[0, 0, 6], [10, 0, 8]] }],
      }],
    )
    expect(overlay.getObjectByName('point-stem:site3')).toBeInstanceOf(THREE.Line)
    const mark = overlay.getObjectByName('point-mark:site3') as THREE.Sprite
    expect(mark.position.z).toBeGreaterThan(8)
    const stroke = overlay.getObjectByName('curve-stroke:line3:0') as THREE.Line
    const z = stroke.geometry.getAttribute('position').array[2]
    expect(z).toBeGreaterThan(5)
    const color = (stroke.material as THREE.LineBasicMaterial).color.getHex()
    expect(color).toBe(0xf0abfc)
    disposeWorldFrameOverlay(overlay)
  })

  it('scales the point2d X so farther cameras keep the same screen size', () => {
    const overlay = createWorldFrameOverlay([], null, [], [{ id: 'site', name: 'Site', nodeId: 'site', x: 0, y: 0 }])
    const mark = overlay.getObjectByName('point-mark:site') as THREE.Sprite
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 20000)
    camera.position.set(0, -20, 20)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()
    overlay.updateMatrixWorld(true)
    orientWorldPointMarks(overlay, camera, 720)
    const near = mark.scale.x
    camera.position.set(0, -200, 200)
    camera.updateMatrixWorld()
    orientWorldPointMarks(overlay, camera, 720)
    expect(mark.scale.x).toBeGreaterThan(near)
    disposeWorldFrameOverlay(overlay)
  })
})
