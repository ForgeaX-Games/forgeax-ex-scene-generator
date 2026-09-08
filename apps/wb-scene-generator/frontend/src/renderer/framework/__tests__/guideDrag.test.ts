import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  cellToWorldXY,
  guideDragGrabOffset,
  resolveGuideDragWorld,
  screenDeltaToWorldXY,
  snapWorldXYToCellWorld,
  worldXYToCell,
} from '../guideDrag'

function lookAt(camera: THREE.PerspectiveCamera, from: THREE.Vector3, target: THREE.Vector3): void {
  camera.up.set(0, 0, 1)
  camera.position.copy(from)
  camera.lookAt(target)
  camera.updateMatrixWorld(true)
}

describe('guideDrag', () => {
  it('round-trips cell coordinates through world XY', () => {
    const world = cellToWorldXY(96, 58, 1)
    expect(world).toEqual({ x: 96, y: -58 })
    expect(worldXYToCell(world.x, world.y, 1)).toEqual({ x: 96, y: 58 })
  })

  it('snaps a world hit to the same cell the commit will write', () => {
    const snapped = snapWorldXYToCellWorld(96.4, -57.6, 1)
    expect(snapped.cell).toEqual({ x: 96, y: 58 })
    expect(snapped.world).toEqual({ x: 96, y: -58 })
    expect(worldXYToCell(snapped.world.x, snapped.world.y, 1)).toEqual(snapped.cell)
  })

  it('keeps the point still when the grab ray hits away from the pin base', () => {
    const origin = cellToWorldXY(96, 58, 1)
    const offset = guideDragGrabOffset({ x: 25, y: 28 }, 96, 58, 1)
    expect(worldXYToCell(25 - offset.x, 28 - offset.y, 1)).toEqual({ x: 96, y: 58 })
    expect(offset).toEqual({ x: 25 - origin.x, y: 28 - origin.y })
  })

  it('mouse-right follows camera-right flattened onto the ground', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000)
    lookAt(camera, new THREE.Vector3(96 + 40, -58 - 40, 80), new THREE.Vector3(96, -58, 0))
    const next = screenDeltaToWorldXY({ x: 96, y: -58, z: 4 }, camera, 80, 0, 400)
    const right = new THREE.Vector3()
    camera.matrixWorld.extractBasis(right, new THREE.Vector3(), new THREE.Vector3())
    right.z = 0
    right.normalize()
    const dx = next.x - 96
    const dy = next.y + 58
    const mag = Math.hypot(dx, dy)
    expect(mag).toBeGreaterThan(5)
    expect((dx * right.x + dy * right.y) / mag).toBeGreaterThan(0.95)
  })

  it('uses screen-space when the camera ray is edge-on to the ground', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000)
    lookAt(camera, new THREE.Vector3(96, -200, 4), new THREE.Vector3(96, -58, 4))
    const ray = new THREE.Ray(camera.position.clone(), new THREE.Vector3(0, 1, 0.01).normalize())
    expect(Math.abs(ray.direction.z)).toBeLessThan(0.18)
    const out = new THREE.Vector3()
    const next = resolveGuideDragWorld(
      ray,
      { x: 96, y: -58, z: 4 },
      { x: 0, y: 0 },
      camera,
      0,
      0,
      400,
      out,
    )
    expect(worldXYToCell(next.x, next.y, 1)).toEqual({ x: 96, y: 58 })
  })

  it('subtracts grab offset on a well-conditioned ground hit', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000)
    lookAt(camera, new THREE.Vector3(96, -58, 80), new THREE.Vector3(96, -58, 0))
    const origin = { x: 96, y: -58, z: 4 }
    const hit = new THREE.Vector3(70, -30, 4)
    const offset = guideDragGrabOffset(hit, 96, 58, 1)
    const ray = new THREE.Ray(new THREE.Vector3(70, -30, 80), new THREE.Vector3(0, 0, -1))
    const out = new THREE.Vector3()
    const next = resolveGuideDragWorld(ray, origin, offset, camera, 0, 0, 400, out)
    expect(worldXYToCell(next.x, next.y, 1)).toEqual({ x: 96, y: 58 })
  })
})
