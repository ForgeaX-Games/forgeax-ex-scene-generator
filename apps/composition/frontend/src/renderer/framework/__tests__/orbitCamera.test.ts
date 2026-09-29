import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  MIN_ORBIT_DISTANCE,
  applyCursorZoom,
  autoFitToContent,
  collectCursorZoomPickables,
  collectWorldPlaneZoomPickables,
  collectZoomPickables,
  expandContentBounds,
  fitCameraToWorldPlanes,
  shouldFitCameraToWorldPlanes,
  pickZoomAim,
  wheelZoomTicks,
} from '../orbitCamera'
import { createWorldFrameOverlay, disposeWorldFrameOverlay } from '../worldFrame'

function valleyAndContinent(): THREE.Group {
  const group = new THREE.Group()
  const valley = new THREE.Mesh(new THREE.BoxGeometry(128, 128, 8))
  valley.name = 'valley'
  valley.position.set(64, -64, 4)
  group.add(valley)

  const continent = new THREE.Group()
  continent.name = 'guide:continent'
  continent.userData.skipFit = true
  const frame = new THREE.Mesh(new THREE.BoxGeometry(2048, 2048, 1))
  frame.position.set(1024, -1024, 0)
  continent.add(frame)
  const pin = new THREE.Mesh(new THREE.SphereGeometry(1))
  pin.name = 'guide-pin:continent:0'
  pin.position.set(2048, -2048, 2)
  continent.add(pin)
  group.add(continent)
  return group
}

describe('orbitCamera', () => {
  it('content bounds skip a ContinentFrame subtree, including pins that do not copy skipFit', () => {
    const group = valleyAndContinent()
    group.updateMatrixWorld(true)
    const box = new THREE.Box3()
    expandContentBounds(group, box)
    expect(box.max.x - box.min.x).toBeCloseTo(128, 0)
    expect(box.max.y - box.min.y).toBeCloseTo(128, 0)
    expect(box.max.x).toBeLessThan(200)
  })

  it('setFromObject still unions hidden skipFit meshes — that is why fit must walk by hand', () => {
    const group = valleyAndContinent()
    group.traverse((obj) => {
      if (obj.userData?.skipFit) obj.visible = false
    })
    const naive = new THREE.Box3().setFromObject(group)
    expect(naive.max.x).toBeGreaterThan(1000)
  })

  it('auto-fit frames the valley, not the 2 km continent', () => {
    const group = valleyAndContinent()
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000)
    const orbit = {
      target: new THREE.Vector3(),
      minDistance: MIN_ORBIT_DISTANCE,
      maxDistance: 16000,
    }
    autoFitToContent(group, camera, orbit)
    expect(orbit.target.x).toBeCloseTo(64, 0)
    expect(orbit.target.y).toBeCloseTo(-64, 0)
    const dist = camera.position.distanceTo(orbit.target)
    expect(dist).toBeGreaterThan(80)
    expect(dist).toBeLessThan(400)
  })

  it('zoom pickables are authored meshes, not overview frames or pins', () => {
    const group = valleyAndContinent()
    const names = collectZoomPickables(group).map((o) => o.name)
    expect(names).toContain('valley')
    expect(names.some((n) => n.startsWith('guide-pin:'))).toBe(false)
    expect(names).not.toContain('guide:continent')
  })

  it('dolly-in keeps the aim on the same pixel and does not lookAt-recenter', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 10000)
    camera.position.set(200, -200, 160)
    camera.lookAt(64, -64, 4)
    camera.updateMatrixWorld()
    camera.updateProjectionMatrix()
    const orbit = {
      target: new THREE.Vector3(64, -64, 4),
      minDistance: MIN_ORBIT_DISTANCE,
      maxDistance: 16000,
    }
    const house = new THREE.Vector3(20, -22, 3)
    const ndcBefore = house.clone().project(camera)
    const lookBefore = new THREE.Vector3()
    camera.getWorldDirection(lookBefore)
    expect(Math.abs(ndcBefore.x) + Math.abs(ndcBefore.y)).toBeGreaterThan(0.05)
    const before = camera.position.distanceTo(house)
    applyCursorZoom(camera, orbit, house, { deltaY: -100, deltaMode: 0 })
    const ndcAfter = house.clone().project(camera)
    const lookAfter = new THREE.Vector3()
    camera.getWorldDirection(lookAfter)
    expect(camera.position.distanceTo(house)).toBeLessThan(before * 0.85)
    expect(ndcAfter.x).toBeCloseTo(ndcBefore.x, 3)
    expect(ndcAfter.y).toBeCloseTo(ndcBefore.y, 3)
    expect(lookAfter.dot(lookBefore)).toBeGreaterThan(0.999)
    expect(orbit.target.distanceTo(house)).toBeGreaterThan(1)
    for (let i = 0; i < 40; i++) {
      applyCursorZoom(camera, orbit, house, { deltaY: -100, deltaMode: 0 })
    }
    expect(camera.position.distanceTo(house)).toBeCloseTo(MIN_ORBIT_DISTANCE, 3)
  })

  it('picks the mesh under the cursor instead of a far ground miss', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 10000)
    camera.position.set(20, -22, 40)
    camera.lookAt(20, -22, 2)
    const house = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4))
    house.position.set(20, -22, 2)
    house.updateMatrixWorld(true)
    const raycaster = new THREE.Raycaster()
    raycaster.set(new THREE.Vector3(20, -22, 40), new THREE.Vector3(0, 0, -1))
    const aim = pickZoomAim(raycaster, [house], camera, new THREE.Vector3(1024, -1024, 0))
    expect(aim.z).toBeGreaterThan(3)
    expect(aim.x).toBeCloseTo(20, 0)
  })

  it('empty-space zoom aims at the view plane through the target, not Z=0', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 10000)
    camera.position.set(80, -80, 60)
    camera.lookAt(64, -64, 8)
    camera.updateMatrixWorld()
    camera.updateProjectionMatrix()
    const target = new THREE.Vector3(64, -64, 8)
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(new THREE.Vector2(0.35, 0.2), camera)
    const aim = pickZoomAim(raycaster, [], camera, target)
    expect(Math.abs(aim.z - 8)).toBeLessThan(20)
    expect(aim.distanceTo(target)).toBeLessThan(80)
  })

  it('treats a 100 px wheel notch as one tick', () => {
    expect(wheelZoomTicks({ deltaY: -100, deltaMode: 0 })).toBeCloseTo(1)
    expect(wheelZoomTicks({ deltaY: 3, deltaMode: 1 })).toBe(3)
  })

  it('frames a Geometry BasePlane overlay when there is no mesh content', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 10000)
    camera.position.set(12, -12, 12)
    const orbit = {
      target: new THREE.Vector3(0, 0, 0),
      minDistance: MIN_ORBIT_DISTANCE,
      maxDistance: 16000,
    }
    fitCameraToWorldPlanes(
      [{ origin: [0, 0], extent: [10, 10] }],
      camera,
      orbit,
    )
    expect(orbit.target.x).toBeCloseTo(5, 0)
    expect(orbit.target.y).toBeCloseTo(-5, 0)
    expect(camera.position.distanceTo(orbit.target)).toBeGreaterThan(8)
    expect(camera.position.distanceTo(orbit.target)).toBeLessThan(40)
  })

  it('does not refit the camera when the same planes only change size', () => {
    expect(shouldFitCameraToWorldPlanes([], ['world'])).toBe(true)
    expect(shouldFitCameraToWorldPlanes(['world'], ['world'])).toBe(false)
    expect(shouldFitCameraToWorldPlanes(['world'], ['world', 'strip'])).toBe(true)
    expect(shouldFitCameraToWorldPlanes(['world', 'strip'], [])).toBe(false)
  })

  it('wheel zoom can hit a BasePlane surface without using the metre grid', () => {
    const overlay = createWorldFrameOverlay([
      { id: 'world', name: 'World', origin: [0, 0], extent: [1200, 1200] },
      { id: 'strip', name: 'Strip', origin: [0, 1200], extent: [1200, 400] },
    ])
    overlay.updateMatrixWorld(true)
    const planeNames = collectWorldPlaneZoomPickables(overlay).map((obj) => obj.name)
    expect(planeNames).toContain('plane-surface:strip')
    expect(planeNames).not.toContain('xy-grid')
    expect(planeNames).not.toContain('xyz-axes')
    expect(collectZoomPickables(overlay)).toEqual([])

    const content = new THREE.Group()
    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 20000)
    camera.position.set(600, -1400, 80)
    camera.lookAt(600, -1400, 0)
    camera.updateMatrixWorld()
    const raycaster = new THREE.Raycaster()
    raycaster.set(new THREE.Vector3(600, -1400, 80), new THREE.Vector3(0, 0, -1))
    const staleTarget = new THREE.Vector3(600, -600, 0)
    const aim = pickZoomAim(
      raycaster,
      collectCursorZoomPickables(content, overlay),
      camera,
      staleTarget,
    )
    expect(aim.x).toBeCloseTo(600, 0)
    expect(aim.y).toBeCloseTo(-1400, 0)
    expect(aim.distanceTo(staleTarget)).toBeGreaterThan(400)
    disposeWorldFrameOverlay(overlay)
  })
})
