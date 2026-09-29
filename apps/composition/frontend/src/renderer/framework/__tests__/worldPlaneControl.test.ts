import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  createWorldFrameOverlay,
  disposeWorldFrameOverlay,
  getPlaneColor,
  type WorldPlaneFrame,
} from '../worldFrame.js'
import { convertToWorldPlaneFrames, parsePlanePayload } from '../../bridge/useNodePreviews.js'
import type { Plane } from '../../../../../vendor/shared/types/scene/spatial.js'

describe('Geometry world-frame overlay', () => {
  it('converts Geometry planes into WorldPlaneFrame objects', () => {
    const basePlane: Plane = {
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      width: 1400,
      height: 1000,
      rotationDeg: 0,
    }

    const frames = convertToWorldPlaneFrames([
      {
        nodeId: 'node_base',
        name: 'basePlane',
        opId: 'base_plane',
        plane: basePlane,
      },
    ])

    expect(frames).toHaveLength(1)
    const base = frames[0]!
    expect(base.id).toBe('node_base')
    expect(base.name).toBe('basePlane')
    expect(base.origin).toEqual([0, 0])
    expect(base.extent).toEqual([1400, 1000])
    expect(base.center).toEqual([700, 500])
    expect(base.role).toBe('geometry')
  })

  it('builds pickable plane surfaces and boundary frames in Three.js overlay', () => {
    const frames: WorldPlaneFrame[] = [
      {
        id: 'node_base',
        name: 'basePlane',
        nodeId: 'node_base',
        origin: [0, 0],
        extent: [1400, 1000],
        center: [700, 500],
        role: 'geometry',
      },
      {
        id: 'node_strip',
        name: 'strip',
        nodeId: 'node_strip',
        origin: [340, 640],
        extent: [720, 240],
        center: [700, 760],
        role: 'geometry',
      },
    ]

    const overlay = createWorldFrameOverlay(frames, 'node_strip', ['node_strip'])
    expect(overlay).toBeInstanceOf(THREE.Group)

    let surfaceCount = 0
    let lineCount = 0
    let selectedSurfaceFound = false

    overlay.traverse((child) => {
      if (child.name.startsWith('plane-surface:')) {
        surfaceCount++
        expect(child.userData.isPlane).toBe(true)
        expect(child.userData.planeId).toBeDefined()
        if (child.userData.planeId === 'node_strip') {
          selectedSurfaceFound = true
          const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial
          expect(mat.opacity).toBeGreaterThan(0.2)
        }
      }
      if (child.name.startsWith('plane-frame:')) {
        lineCount++
        expect(child.userData.isPlane).toBe(true)
      }
      expect(child.name.startsWith('plane-grid:')).toBe(false)
    })

    expect(surfaceCount).toBe(2)
    expect(lineCount).toBe(2)
    expect(selectedSurfaceFound).toBe(true)
    expect(() => disposeWorldFrameOverlay(overlay)).not.toThrow()
  })

  it('highlights selected plane with distinct selection color', () => {
    const frame: WorldPlaneFrame = {
      id: 'node_test',
      name: 'testPlane',
      origin: [0, 0],
      extent: [100, 100],
    }

    const normalColor = getPlaneColor(frame, 0, false)
    const selectedColor = getPlaneColor(frame, 0, true)

    expect(selectedColor).toBe(0xffe066)
    expect(normalColor).not.toBe(selectedColor)
  })

  it('parses a Geometry plane from DataTree wire and kind envelope', () => {
    const geometry = {
      kind: 'plane',
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      width: 10,
      height: 6,
    }
    expect(parsePlanePayload([{ path: [0], items: [geometry] }])?.plane.width).toBe(10)
    expect(parsePlanePayload({ geometry })?.plane.height).toBe(6)
    expect(parsePlanePayload(geometry)?.plane.origin).toEqual([0, 0, 0])
  })
})
