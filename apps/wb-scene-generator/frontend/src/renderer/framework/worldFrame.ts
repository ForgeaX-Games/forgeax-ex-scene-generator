import * as THREE from 'three'
import { BASE_CELL_SIZE } from './geometry/constants'
import { createViewGuides3d, disposeViewGuides3d } from './guides3d'

/** A work plane drawn in composed world metres (viewport overlay, not a work grid). */
export interface WorldPlaneFrame {
  id: string
  name: string
  origin: readonly [number, number]
  extent: readonly [number, number]
  yaw?: number
}

/** Composed world rectangles after place(valley, { at: [960, 960] }) — AF contract. */
export const LAYERED_TERRITORY_COMPOSED_PLANES: readonly WorldPlaneFrame[] = [
  { id: 'continent', name: 'Continent', origin: [0, 0], extent: [2048, 2048] },
  { id: 'valley', name: 'Valley', origin: [960, 960], extent: [128, 128] },
  { id: 'plaza', name: 'Plaza', origin: [1020, 1014], extent: [24, 24] },
]

/** Live project: valley still sits at the identity corner until place() lands. */
export const LIVE_LAYERED_TERRITORY_PLANES: readonly WorldPlaneFrame[] = [
  { id: 'continent', name: 'Continent', origin: [0, 0], extent: [2048, 2048] },
  { id: 'valley', name: 'Valley', origin: [0, 0], extent: [128, 128] },
  { id: 'plaza', name: 'Plaza', origin: [60, 54], extent: [24, 24] },
]

export function worldFrameGridSpec(planes: readonly WorldPlaneFrame[] = []): { size: number; divisions: number } {
  let max = 256
  for (const plane of planes) {
    max = Math.max(max, plane.origin[0] + plane.extent[0], plane.origin[1] + plane.extent[1])
  }
  const size = Math.max(256, Math.ceil(max / 8) * 8)
  const step = size > 512 ? 8 : 1
  return { size, divisions: Math.max(8, Math.round(size / step)) }
}

function planeCorners(plane: WorldPlaneFrame): Array<[number, number]> {
  const [x0, y0] = plane.origin
  const [w, h] = plane.extent
  const yaw = plane.yaw ?? 0
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  const local: Array<[number, number]> = [[0, 0], [w, 0], [w, h], [0, h]]
  return local.map(([x, y]) => [x0 + x * c - y * s, y0 + x * s + y * c])
}

export function buildWorldPlaneOverlay(planes: readonly WorldPlaneFrame[]): THREE.Group {
  const group = new THREE.Group()
  group.name = 'world-plane-frames'
  const lift = BASE_CELL_SIZE * 0.02
  for (const plane of planes) {
    const corners = planeCorners(plane)
    const pts = corners.map(([x, y]) => new THREE.Vector3(x * BASE_CELL_SIZE, -y * BASE_CELL_SIZE, lift))
    pts.push(pts[0]!.clone())
    const geom = new THREE.BufferGeometry().setFromPoints(pts)
    const mat = new THREE.LineBasicMaterial({
      color: plane.id === 'continent' ? 0x8aa0b8 : plane.id === 'valley' ? 0x6a9ad4 : 0xd4c46a,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      fog: false,
    })
    const line = new THREE.Line(geom, mat)
    line.name = `plane-frame:${plane.id}`
    line.renderOrder = 902
    group.add(line)
  }
  return group
}

export function createWorldFrameOverlay(
  planes: readonly WorldPlaneFrame[] = [],
): THREE.Group {
  const spec = worldFrameGridSpec(planes)
  const group = createViewGuides3d({
    size: spec.size * BASE_CELL_SIZE,
    divisions: spec.divisions,
    axisLength: Math.min(24, spec.size * 0.08) * BASE_CELL_SIZE,
  })
  group.name = 'world-frame'
  group.userData.skipFit = true
  if (planes.length) group.add(buildWorldPlaneOverlay(planes))
  return group
}

export function disposeWorldFrameOverlay(group: THREE.Group): void {
  disposeViewGuides3d(group)
}
