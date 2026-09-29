import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  formatScaleMetres,
  niceScaleMetres,
  previewCompassDeg,
  previewFrameReading,
  previewMetresPerPixel,
} from '../previewFrameHud'

function lookDown(x: number, y: number, z = 40): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 4000)
  camera.up.set(0, 0, 1)
  camera.position.set(x, y, z)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  camera.updateProjectionMatrix()
  return camera
}

describe('previewFrameHud', () => {
  it('picks a nice metre length near the desired pixel width', () => {
    expect(niceScaleMetres(1, 96)).toEqual({ metres: 100, pixels: 100 })
    expect(niceScaleMetres(0.2, 96).metres).toBe(20)
    expect(formatScaleMetres(1000)).toEqual({ n: 1, unit: 'km' })
    expect(formatScaleMetres(200)).toEqual({ n: 200, unit: 'm' })
  })

  it('points the rose north toward the top of the BasePlane from a south look', () => {
    const camera = lookDown(0, -12)
    const deg = ((previewCompassDeg(camera) + 540) % 360) - 180
    expect(Math.abs(deg)).toBeLessThan(12)
  })

  it('rotates the rose when the camera orbits around Z', () => {
    const south = previewCompassDeg(lookDown(0, -12))
    const west = previewCompassDeg(lookDown(-12, 0))
    const turn = Math.abs(((west - south + 540) % 360) - 180)
    expect(turn).toBeGreaterThan(60)
    expect(turn).toBeLessThan(120)
  })

  it('measures ground metres from the look-at target', () => {
    const camera = lookDown(0, -8, 80)
    const mpp = previewMetresPerPixel(camera, new THREE.Vector3(0, 0, 0), { width: 800, height: 800 })
    expect(mpp).toBeGreaterThan(0.05)
    expect(mpp).toBeLessThan(2)
    const reading = previewFrameReading(camera, new THREE.Vector3(0, 0, 0), { width: 800, height: 800 })
    expect(reading.pixels).toBeGreaterThan(40)
    expect(reading.pixels).toBeLessThan(160)
    expect([1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]).toContain(reading.metres)
  })
})
