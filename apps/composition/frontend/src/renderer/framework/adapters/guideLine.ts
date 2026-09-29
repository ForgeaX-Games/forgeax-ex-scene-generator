import * as THREE from 'three'
import { BASE_CELL_SIZE } from '../geometry/constants'
import type { GuideLayer, MeshLayer } from '../../types'

const GUIDE_POLYLINE = 0x00e5ff
const GUIDE_POINTS = 0xffcc00
const GUIDE_SELECTED = 0xfff3a0
const GUIDE_OUTLINE = 0x111111
const GUIDE_LIFT = 2.4
const PIN_HEIGHT = 2.4
const DOT_RADIUS = 0.85
const POLE_RADIUS = 0.12
const RING_INNER = 0.7
const RING_OUTER = 1.15
const TUBE_RADIUS = 0.22
const BILLBOARD_REF_DIST = 180
const BILLBOARD_SCALE_MIN = 1
const BILLBOARD_SCALE_MAX = 2.1

const _billboardPos = new THREE.Vector3()

export function sampleTerrainZ(meshLayers: ReadonlyArray<MeshLayer>, x: number, y: number): number {
  let best = GUIDE_LIFT
  let bestDist = Number.POSITIVE_INFINITY
  for (const layer of meshLayers) {
    if ((layer.mesh.role ?? 'terrain') !== 'terrain') continue
    const pos = layer.mesh.positions
    for (let i = 0; i < pos.length; i += 3) {
      const dx = pos[i]! - x * BASE_CELL_SIZE
      const dy = pos[i + 1]! + y * BASE_CELL_SIZE
      const dist = dx * dx + dy * dy
      if (dist < bestDist) {
        bestDist = dist
        best = pos[i + 2]! + GUIDE_LIFT
      }
    }
  }
  return best
}

export function terrainGuideStamp(meshLayers: ReadonlyArray<MeshLayer>): number {
  let stamp = 0
  for (const layer of meshLayers) {
    if ((layer.mesh.role ?? 'terrain') !== 'terrain') continue
    if (layer.updatedAt > stamp) stamp = layer.updatedAt
  }
  return stamp
}

function pinMaterial(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    depthTest: false,
    depthWrite: false,
    fog: false,
  })
}

export function isOverviewGuide(nodeName: string): boolean {
  return nodeName === 'ContinentFrame' || nodeName === 'ContinentRiver'
}

function uniquePolyline(points: THREE.Vector3[]): THREE.Vector3[] {
  const out: THREE.Vector3[] = []
  for (const p of points) {
    if (out.length === 0 || out[out.length - 1]!.distanceToSquared(p) > 0.04) out.push(p)
  }
  return out
}

/** Slight distance scale so a far camera can still hit the handle, without eating the valley. */
export function scaleGuideBillboards(root: THREE.Object3D, camera: THREE.Camera): void {
  root.traverse((obj) => {
    if (!obj.name.startsWith('guide-pin:')) return
    obj.getWorldPosition(_billboardPos)
    const dist = camera.position.distanceTo(_billboardPos)
    obj.scale.setScalar(THREE.MathUtils.clamp(dist / BILLBOARD_REF_DIST, BILLBOARD_SCALE_MIN, BILLBOARD_SCALE_MAX))
  })
}

export function buildGuideObject(
  layer: GuideLayer,
  meshLayers: ReadonlyArray<MeshLayer>,
  selected = false,
): THREE.Group {
  const group = new THREE.Group()
  group.name = `guide:${layer.key}`
  group.userData = {
    layerKey: layer.key,
    nodeId: layer.nodeId,
    schema: 'guide',
    skipFit: isOverviewGuide(layer.nodeName),
  }
  group.renderOrder = 20
  const color = selected ? GUIDE_SELECTED : (layer.style === 'polyline' ? GUIDE_POLYLINE : GUIDE_POINTS)
  const zs = layer.points.map((pt) => (
    Number.isFinite(pt.z) ? pt.z! : sampleTerrainZ(meshLayers, pt.x, pt.y)
  ))
  const mat = pinMaterial(color)
  const outline = pinMaterial(GUIDE_OUTLINE)

  if (layer.style !== 'points' && layer.points.length >= 2) {
    const verts = uniquePolyline(layer.points.map((pt, i) => new THREE.Vector3(
      pt.x * BASE_CELL_SIZE,
      -pt.y * BASE_CELL_SIZE,
      zs[i]!,
    )))
    if (verts.length >= 2) {
      const curve = verts.length === 2
        ? new THREE.LineCurve3(verts[0]!, verts[1]!)
        : new THREE.CatmullRomCurve3(verts, false, 'catmullrom', 0.05)
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, Math.max(12, (verts.length - 1) * 8), TUBE_RADIUS * BASE_CELL_SIZE, 8, false),
        mat,
      )
      tube.name = `guide-line:${layer.key}`
      tube.renderOrder = 20
      tube.userData = group.userData
      group.add(tube)
    }
  }

  const sphere = new THREE.SphereGeometry((selected ? DOT_RADIUS * 1.15 : DOT_RADIUS) * BASE_CELL_SIZE, 16, 12)
  const pole = new THREE.CylinderGeometry(
    POLE_RADIUS * BASE_CELL_SIZE,
    POLE_RADIUS * BASE_CELL_SIZE,
    PIN_HEIGHT * BASE_CELL_SIZE,
    8,
  )
  pole.rotateX(Math.PI / 2)
  const ring = new THREE.RingGeometry(RING_INNER * BASE_CELL_SIZE, RING_OUTER * BASE_CELL_SIZE, 28)
  const ringFill = new THREE.CircleGeometry(RING_INNER * BASE_CELL_SIZE, 28)

  layer.points.forEach((pt, i) => {
    const wx = pt.x * BASE_CELL_SIZE
    const wy = -pt.y * BASE_CELL_SIZE
    const z0 = zs[i]!
    const hitData = {
      guideKey: layer.key,
      guideIndex: i,
      sourceNodeId: pt.sourceNodeId,
      layerKey: layer.key,
      nodeId: layer.nodeId,
      schema: 'guide',
      guideBillboard: true,
    }
    const pin = new THREE.Group()
    pin.name = `guide-pin:${layer.key}:${i}`
    pin.position.set(wx, wy, z0)
    pin.userData = hitData
    pin.renderOrder = 21

    const halo = new THREE.Mesh(ring, outline)
    halo.name = `guide-dot:${layer.key}:${i}:ring`
    halo.position.set(0, 0, 0.35)
    halo.renderOrder = 21
    halo.userData = hitData
    pin.add(halo)

    const pad = new THREE.Mesh(ringFill, mat)
    pad.name = `guide-dot:${layer.key}:${i}:pad`
    pad.position.set(0, 0, 0.4)
    pad.renderOrder = 22
    pad.userData = hitData
    pin.add(pad)

    const stem = new THREE.Mesh(pole, mat)
    stem.position.set(0, 0, (PIN_HEIGHT * BASE_CELL_SIZE) / 2)
    stem.name = `guide-dot:${layer.key}:${i}:pole`
    stem.renderOrder = 22
    stem.userData = hitData
    pin.add(stem)

    const head = new THREE.Mesh(sphere, mat)
    head.position.set(0, 0, PIN_HEIGHT * BASE_CELL_SIZE)
    head.name = `guide-dot:${layer.key}:${i}`
    head.renderOrder = 23
    head.userData = hitData
    pin.add(head)

    group.add(pin)
  })
  return group
}

/** Move the selected pin and gizmo to the same world position without rebuilding the layer. */
export function setGuidePreviewWorld(
  root: THREE.Object3D,
  key: string,
  index: number,
  worldX: number,
  worldY: number,
  worldZ: number,
): void {
  const pin = root.getObjectByName(`guide-pin:${key}:${index}`)
  if (pin) pin.position.set(worldX, worldY, worldZ)
  const gizmo = root.getObjectByName('guide-gizmo')
  if (gizmo) gizmo.position.set(worldX, worldY, worldZ)
}

export function disposeGuideObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.Sprite) {
      child.geometry.dispose()
      const mat = child.material
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
      else mat.dispose()
    }
  })
}
