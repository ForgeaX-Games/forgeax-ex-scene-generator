import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  applyGizmoDrag,
  beginGizmoDrag,
  buildMoveGizmo,
  collectGizmoHits,
  gizmoHandleLiftsPin,
  parseGizmoHandle,
  pickGizmoHandle,
  rayAxisParameter,
  setGizmoHover,
} from '../guideGizmo'
import { worldXYToCell } from '../guideDrag'

describe('guideGizmo', () => {
  it('only Z / XZ / YZ lift the pin off the terrain', () => {
    expect(gizmoHandleLiftsPin('x')).toBe(false)
    expect(gizmoHandleLiftsPin('y')).toBe(false)
    expect(gizmoHandleLiftsPin('xy')).toBe(false)
    expect(gizmoHandleLiftsPin('z')).toBe(true)
    expect(gizmoHandleLiftsPin('xz')).toBe(true)
    expect(gizmoHandleLiftsPin('yz')).toBe(true)
  })

  it('parses axis and plane handles', () => {
    expect(parseGizmoHandle('xy')).toBe('xy')
    expect(parseGizmoHandle('gizmo')).toBeUndefined()
  })

  it('projects a ray onto an axis without sliding sideways', () => {
    const origin = new THREE.Vector3(10, 20, 4)
    const ray = new THREE.Ray(new THREE.Vector3(10, 0, 20), new THREE.Vector3(0, 0, -1))
    const t = rayAxisParameter(ray, origin, new THREE.Vector3(1, 0, 0))
    expect(t).toBeCloseTo(0)
  })

  it('X-axis drag keeps Y and Z still', () => {
    const start = new THREE.Vector3(96, -58, 4)
    const downRay = new THREE.Ray(new THREE.Vector3(96, -80, 40), new THREE.Vector3(0, 0.4, -1).normalize())
    const state = beginGizmoDrag('x', downRay, start)
    expect(state).not.toBeNull()
    const move = new THREE.Ray(new THREE.Vector3(110, -80, 40), new THREE.Vector3(0, 0.4, -1).normalize())
    const out = new THREE.Vector3()
    expect(applyGizmoDrag(state!, move, out)).toBe(true)
    expect(out.y).toBeCloseTo(start.y, 5)
    expect(out.z).toBeCloseTo(start.z, 5)
    expect(out.x).not.toBeCloseTo(start.x, 1)
    expect(worldXYToCell(out.x, out.y, 1).y).toBe(58)
  })

  it('Z-axis drag keeps X and Y still', () => {
    const start = new THREE.Vector3(96, -58, 4)
    const downRay = new THREE.Ray(new THREE.Vector3(80, -58, 4), new THREE.Vector3(1, 0, 0))
    const state = beginGizmoDrag('z', downRay, start)
    expect(state).not.toBeNull()
    const move = new THREE.Ray(new THREE.Vector3(80, -58, 20), new THREE.Vector3(1, 0, 0))
    const out = new THREE.Vector3()
    expect(applyGizmoDrag(state!, move, out)).toBe(true)
    expect(out.x).toBeCloseTo(start.x, 5)
    expect(out.y).toBeCloseTo(start.y, 5)
    expect(out.z).toBeCloseTo(20, 1)
  })

  it('X-axis drag ignores mouse motion perpendicular to the axis', () => {
    const start = new THREE.Vector3(96, -58, 4)
    const downRay = new THREE.Ray(new THREE.Vector3(96, 40, 50), new THREE.Vector3(0, -0.6, -1).normalize())
    const state = beginGizmoDrag('x', downRay, start)
    expect(state).not.toBeNull()
    const first = new THREE.Vector3()
    expect(applyGizmoDrag(state!, downRay, first)).toBe(true)
    const move = new THREE.Ray(new THREE.Vector3(96, -160, 50), new THREE.Vector3(0, 0.6, -1).normalize())
    const out = new THREE.Vector3()
    expect(applyGizmoDrag(state!, move, out)).toBe(true)
    expect(out.x).toBeCloseTo(first.x, 1)
    expect(out.y).toBeCloseTo(start.y, 5)
    expect(out.z).toBeCloseTo(start.z, 5)
  })

  it('XY-plane drag keeps Z and does not jump when the grab misses the origin', () => {
    const start = new THREE.Vector3(96, -58, 4)
    const downRay = new THREE.Ray(new THREE.Vector3(80, -40, 40), new THREE.Vector3(0, 0, -1))
    const state = beginGizmoDrag('xy', downRay, start)
    expect(state).not.toBeNull()
    const out = new THREE.Vector3()
    expect(applyGizmoDrag(state!, downRay, out)).toBe(true)
    expect(out.x).toBeCloseTo(96)
    expect(out.y).toBeCloseTo(-58)
    expect(out.z).toBeCloseTo(4)
  })

  it('XZ-plane drag keeps Y and can change Z', () => {
    const start = new THREE.Vector3(96, -58, 4)
    const downRay = new THREE.Ray(new THREE.Vector3(96, 40, 4), new THREE.Vector3(0, -1, 0))
    const state = beginGizmoDrag('xz', downRay, start)
    expect(state).not.toBeNull()
    const move = new THREE.Ray(new THREE.Vector3(110, 40, 18), new THREE.Vector3(0, -1, 0))
    const out = new THREE.Vector3()
    expect(applyGizmoDrag(state!, move, out)).toBe(true)
    expect(out.y).toBeCloseTo(start.y, 5)
    expect(out.x).toBeCloseTo(110, 1)
    expect(out.z).toBeCloseTo(18, 1)
  })

  it('YZ-plane drag keeps X and can change Z', () => {
    const start = new THREE.Vector3(96, -58, 4)
    const downRay = new THREE.Ray(new THREE.Vector3(40, -58, 4), new THREE.Vector3(1, 0, 0))
    const state = beginGizmoDrag('yz', downRay, start)
    expect(state).not.toBeNull()
    const move = new THREE.Ray(new THREE.Vector3(40, -40, 16), new THREE.Vector3(1, 0, 0))
    const out = new THREE.Vector3()
    expect(applyGizmoDrag(state!, move, out)).toBe(true)
    expect(out.x).toBeCloseTo(start.x, 5)
    expect(out.y).toBeCloseTo(-40, 1)
    expect(out.z).toBeCloseTo(16, 1)
  })

  it('refuses an edge-on plane instead of flying off the map', () => {
    const start = new THREE.Vector3(96, -58, 4)
    const side = new THREE.Ray(new THREE.Vector3(96, -200, 4), new THREE.Vector3(0, 1, 0.01).normalize())
    expect(beginGizmoDrag('xy', side, start)).toBeNull()
  })

  it('builds six pickable handles (3 axes + 3 planes)', () => {
    const gizmo = buildMoveGizmo()
    const hits = collectGizmoHits(gizmo)
    const names = hits.map((h) => h.name).sort()
    expect(names).toEqual([
      'gizmo-hit:x',
      'gizmo-hit:xy',
      'gizmo-hit:xz',
      'gizmo-hit:y',
      'gizmo-hit:yz',
      'gizmo-hit:z',
    ].sort())
  })

  it('highlights only the hovered handle', () => {
    const gizmo = buildMoveGizmo()
    expect(setGizmoHover(gizmo, 'x')).toBe(true)
    expect(setGizmoHover(gizmo, 'x')).toBe(false)
    const shaft = gizmo.children.find((c) => c.userData.gizmoHandle === 'x' && c instanceof THREE.Mesh) as THREE.Mesh
    expect((shaft.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0xffee55)
    setGizmoHover(gizmo, null)
    expect((shaft.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0xe74c3c)
  })

  it('picks the closest handle under the ray', () => {
    const gizmo = buildMoveGizmo()
    gizmo.position.set(0, 0, 0)
    gizmo.updateMatrixWorld(true)
    const raycaster = new THREE.Raycaster(new THREE.Vector3(0.86, 0, 4), new THREE.Vector3(0, 0, -1))
    expect(pickGizmoHandle(raycaster, gizmo)).toBe('x')
  })

  it('prefers an axis when the ray skims the shaft even if the XY plane is closer', () => {
    const root = new THREE.Group()
    const gizmo = buildMoveGizmo()
    gizmo.scale.setScalar(8)
    root.add(gizmo)
    gizmo.updateMatrixWorld(true)
    const raycaster = new THREE.Raycaster(new THREE.Vector3(3.44, 0.15, 20), new THREE.Vector3(0, 0, -1))
    expect(pickGizmoHandle(raycaster, root)).toBe('x')
  })
})
