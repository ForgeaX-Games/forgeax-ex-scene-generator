import * as THREE from 'three'
import { BASE_CELL_SIZE } from './geometry/constants'
import { createViewGuides3d, disposeViewGuides3d } from './guides3d'

/** A plan-site or world-site point drawn as a camera-facing X. */
export type WorldSpace = 'plan' | 'world3d'

export interface WorldPointFrame {
  id: string
  name: string
  nodeId?: string
  x: number
  y: number
  z?: number
  space?: WorldSpace
}

export type WorldCurveKind = 'polyline' | 'spline' | 'polygon' | 'network'

/** Authoring XY, plus optional authored or draped Z. */
export type WorldStrokePoint = readonly [number, number] | readonly [number, number, number]

export interface WorldCurveStroke {
  points: WorldStrokePoint[]
  closed?: boolean
}

/** Operating curve / region Geometry drawn in authoring metres (Y flipped once). */
export interface WorldCurveFrame {
  id: string
  name: string
  nodeId?: string
  kind: WorldCurveKind
  strokes: WorldCurveStroke[]
  vertices?: WorldStrokePoint[]
  space?: WorldSpace
}

/** Sit a draped authoring Z just above the Heightfield lattice. */
const SURFACE_LIFT = BASE_CELL_SIZE * 1.6

function authoredSurfaceZ(z: number | undefined, planLift: number): number {
  return typeof z === 'number' && Number.isFinite(z) ? z * BASE_CELL_SIZE + SURFACE_LIFT : planLift
}

/** Screen-space size of the point2d X mark, in CSS pixels. */
export const POINT2D_MARK_PX = 22

const _pointMarkPos = new THREE.Vector3()

function createPointMarkTexture(): THREE.DataTexture {
  const size = 64
  const data = new Uint8Array(size * size * 4)
  const thickness = 3
  const stamp = (x: number, y: number): void => {
    for (let dy = -thickness; dy <= thickness; dy++) {
      for (let dx = -thickness; dx <= thickness; dx++) {
        if (dx * dx + dy * dy > thickness * thickness) continue
        const px = x + dx
        const py = y + dy
        if (px < 0 || py < 0 || px >= size || py >= size) continue
        const i = (py * size + px) * 4
        data[i] = 255
        data[i + 1] = 255
        data[i + 2] = 255
        data[i + 3] = 255
      }
    }
  }
  for (let t = 0; t < size; t++) {
    stamp(t, t)
    stamp(size - 1 - t, t)
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.needsUpdate = true
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  return texture
}

function worldSizeForPixels(camera: THREE.Camera, dist: number, pixels: number, viewHeightPx: number): number {
  if (!(camera instanceof THREE.PerspectiveCamera)) return POINT2D_MARK_PX * 0.04 * BASE_CELL_SIZE
  const worldHeight = 2 * Math.tan((camera.fov * Math.PI) / 360) * Math.max(dist, 0.01)
  return (pixels / Math.max(1, viewHeightPx)) * worldHeight
}

/** Keep point2d X marks camera-facing and a constant screen size. */
export function orientWorldPointMarks(
  root: THREE.Object3D | null,
  camera: THREE.Camera,
  viewHeightPx = 720,
): void {
  if (!root) return
  const marks = root.getObjectByName('world-point-marks') ?? root
  marks.traverse((obj) => {
    if (!(obj instanceof THREE.Sprite) || !obj.name.startsWith('point-mark:')) return
    obj.getWorldPosition(_pointMarkPos)
    const size = worldSizeForPixels(camera, camera.position.distanceTo(_pointMarkPos), POINT2D_MARK_PX, viewHeightPx)
    obj.scale.set(size, size, 1)
  })
}

/** A work plane drawn in composed world metres (viewport overlay, not a work grid). */
export interface WorldPlaneFrame {
  id: string
  name: string
  nodeId?: string
  portName?: string
  origin: readonly [number, number]
  extent: readonly [number, number]
  center?: readonly [number, number]
  yaw?: number
  elevation?: number
  cellSize?: number
  cols?: number
  rows?: number
  role?: string
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

export const WORLD_FRAME_ALPINE_SPEC = { size: 256, divisions: 256 } as const
export const WORLD_FRAME_CONTINENT_SPEC = { size: 2048, divisions: 256 } as const

/** Fixed metre grid. Live BasePlane extents do not resize this reference frame. */
export function worldFrameGridSpec(planes: readonly WorldPlaneFrame[] = []): { size: number; divisions: number } {
  if (planes.some((plane) => plane.id === 'continent')) return WORLD_FRAME_CONTINENT_SPEC
  return WORLD_FRAME_ALPINE_SPEC
}

export function planeCorners(plane: WorldPlaneFrame): Array<[number, number]> {
  const [x0, y0] = plane.origin
  const [w, h] = plane.extent
  const yaw = plane.yaw ?? 0
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  const local: Array<[number, number]> = [[0, 0], [w, 0], [w, h], [0, h]]
  return local.map(([x, y]) => [x0 + x * c - y * s, y0 + x * s + y * c])
}

const PLANE_PALETTE = [
  0x38bdf8, // Sky blue
  0xfbbf24, // Amber/Gold
  0x34d399, // Emerald green
  0xf472b6, // Coral pink
  0xa78bfa, // Violet
  0x22d3ee, // Cyan
]

export function getPlaneColor(plane: WorldPlaneFrame, index: number, isSelected: boolean): number {
  if (isSelected) return 0xffe066
  if (plane.id === 'continent' || plane.role === 'geometry' || plane.role === 'base') return 0x94a3b8
  if (plane.id === 'valley') return 0x38bdf8
  if (plane.id === 'plaza') return 0xfbbf24
  return PLANE_PALETTE[index % PLANE_PALETTE.length] ?? 0x38bdf8
}

function buildPlaneGridLines(
  plane: WorldPlaneFrame,
  lift: number,
  color: number,
  isSelected: boolean,
): THREE.LineSegments | null {
  const cellSize = plane.cellSize
  if (!cellSize || cellSize <= 0) return null
  const [w, h] = plane.extent
  if (w <= 0 || h <= 0) return null

  const numCols = Math.round(w / cellSize)
  const numRows = Math.round(h / cellSize)
  if (numCols <= 1 && numRows <= 1) return null

  const maxLines = 120
  const stepCols = Math.max(1, Math.ceil(numCols / maxLines))
  const stepRows = Math.max(1, Math.ceil(numRows / maxLines))

  const [x0, y0] = plane.origin
  const yaw = plane.yaw ?? 0
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  const transform = (lx: number, ly: number): [number, number] => [
    x0 + lx * c - ly * s,
    y0 + lx * s + ly * c,
  ]

  const pts: THREE.Vector3[] = []

  for (let col = stepCols; col < numCols; col += stepCols) {
    const lx = col * cellSize
    const [wx0, wy0] = transform(lx, 0)
    const [wx1, wy1] = transform(lx, h)
    pts.push(
      new THREE.Vector3(wx0 * BASE_CELL_SIZE, -wy0 * BASE_CELL_SIZE, lift),
      new THREE.Vector3(wx1 * BASE_CELL_SIZE, -wy1 * BASE_CELL_SIZE, lift),
    )
  }

  for (let row = stepRows; row < numRows; row += stepRows) {
    const ly = row * cellSize
    const [wx0, wy0] = transform(0, ly)
    const [wx1, wy1] = transform(w, ly)
    pts.push(
      new THREE.Vector3(wx0 * BASE_CELL_SIZE, -wy0 * BASE_CELL_SIZE, lift),
      new THREE.Vector3(wx1 * BASE_CELL_SIZE, -wy1 * BASE_CELL_SIZE, lift),
    )
  }

  if (pts.length === 0) return null
  const geom = new THREE.BufferGeometry().setFromPoints(pts)
  const mat = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: isSelected ? 0.45 : 0.2,
    depthWrite: false,
    fog: false,
  })
  const segments = new THREE.LineSegments(geom, mat)
  segments.name = `plane-grid:${plane.id}`
  segments.renderOrder = 901
  return segments
}

function buildPlaneSurface(
  plane: WorldPlaneFrame,
  corners: Array<[number, number]>,
  lift: number,
  color: number,
  isSelected: boolean,
): THREE.Mesh {
  const [c0, c1, c2, c3] = corners as [[number, number], [number, number], [number, number], [number, number]]
  const positions = new Float32Array([
    c0[0] * BASE_CELL_SIZE, -c0[1] * BASE_CELL_SIZE, lift,
    c1[0] * BASE_CELL_SIZE, -c1[1] * BASE_CELL_SIZE, lift,
    c2[0] * BASE_CELL_SIZE, -c2[1] * BASE_CELL_SIZE, lift,

    c0[0] * BASE_CELL_SIZE, -c0[1] * BASE_CELL_SIZE, lift,
    c2[0] * BASE_CELL_SIZE, -c2[1] * BASE_CELL_SIZE, lift,
    c3[0] * BASE_CELL_SIZE, -c3[1] * BASE_CELL_SIZE, lift,
  ])

  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geom.computeVertexNormals()

  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: isSelected ? 0.28 : 0.08,
    side: THREE.DoubleSide,
    depthWrite: false,
  })

  const mesh = new THREE.Mesh(geom, mat)
  mesh.name = `plane-surface:${plane.id}`
  mesh.userData = {
    planeId: plane.id,
    nodeId: plane.nodeId,
    layerKey: `plane:${plane.id}`,
    isPlane: true,
    plane,
  }
  mesh.renderOrder = 900
  return mesh
}

export function buildWorldPlaneOverlay(
  planes: readonly WorldPlaneFrame[],
  selectedPlaneId?: string | null,
  selectedNodeIds: readonly string[] = [],
): THREE.Group {
  const group = new THREE.Group()
  group.name = 'world-plane-frames'
  const lift = BASE_CELL_SIZE * 0.04

  planes.forEach((plane, index) => {
    const isSelected = selectedPlaneId === plane.id ||
      (!!plane.nodeId && selectedNodeIds.includes(plane.nodeId)) ||
      (selectedPlaneId === `plane:${plane.id}`)

    const color = getPlaneColor(plane, index, isSelected)
    const corners = planeCorners(plane)

    // 1. Boundary line
    const pts = corners.map(([x, y]) => new THREE.Vector3(x * BASE_CELL_SIZE, -y * BASE_CELL_SIZE, lift + 0.01))
    pts.push(pts[0]!.clone())
    const geom = new THREE.BufferGeometry().setFromPoints(pts)
    const mat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: isSelected ? 1.0 : 0.85,
      linewidth: isSelected ? 2 : 1,
      depthWrite: false,
      fog: false,
    })
    const line = new THREE.Line(geom, mat)
    line.name = `plane-frame:${plane.id}`
    line.userData = {
      planeId: plane.id,
      nodeId: plane.nodeId,
      layerKey: `plane:${plane.id}`,
      isPlane: true,
      plane,
    }
    line.renderOrder = 902
    group.add(line)

    // 2. Pickable semi-transparent surface
    const surface = buildPlaneSurface(plane, corners, lift, color, isSelected)
    group.add(surface)

    // 3. Grid subdivision lines (visual resolution representation)
    const gridLines = buildPlaneGridLines(plane, lift + 0.005, color, isSelected)
    if (gridLines) group.add(gridLines)
  })

  return group
}

export function buildWorldPointOverlay(
  points: readonly WorldPointFrame[],
  selectedNodeIds: readonly string[] = [],
): THREE.Group {
  const group = new THREE.Group()
  group.name = 'world-point-marks'
  const lift = BASE_CELL_SIZE * 0.08
  const map = createPointMarkTexture()
  group.userData.pointMarkMap = map
  for (const point of points) {
    const selected = !!point.nodeId && selectedNodeIds.includes(point.nodeId)
    const world3d = point.space === 'world3d'
    const mat = new THREE.SpriteMaterial({
      map,
      color: selected ? 0xffe066 : (world3d ? 0xe879f9 : 0xd4ff48),
      transparent: true,
      opacity: selected ? 1 : 0.96,
      depthTest: false,
      depthWrite: false,
      fog: false,
      sizeAttenuation: true,
    })
    const mark = new THREE.Sprite(mat)
    mark.name = `point-mark:${point.id}`
    mark.position.set(point.x * BASE_CELL_SIZE, -point.y * BASE_CELL_SIZE, authoredSurfaceZ(point.z, lift))
    mark.scale.set(POINT2D_MARK_PX * 0.04 * BASE_CELL_SIZE, POINT2D_MARK_PX * 0.04 * BASE_CELL_SIZE, 1)
    mark.frustumCulled = false
    mark.renderOrder = 903
    mark.userData = {
      nodeId: point.nodeId,
      layerKey: `point:${point.id}`,
      isPoint: true,
      point,
    }
    group.add(mark)
    if (world3d && typeof point.z === 'number' && Number.isFinite(point.z)) {
      const stemGeo = new THREE.BufferGeometry()
      stemGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
        point.x * BASE_CELL_SIZE, -point.y * BASE_CELL_SIZE, lift,
        point.x * BASE_CELL_SIZE, -point.y * BASE_CELL_SIZE, authoredSurfaceZ(point.z, lift),
      ]), 3))
      const stem = new THREE.Line(stemGeo, new THREE.LineBasicMaterial({
        color: selected ? 0xffe066 : 0xa78bfa,
        transparent: true,
        opacity: 0.7,
        depthTest: false,
        depthWrite: false,
        fog: false,
      }))
      stem.name = `point-stem:${point.id}`
      stem.frustumCulled = false
      stem.renderOrder = 902
      stem.userData = mark.userData
      group.add(stem)
    }
  }
  return group
}

const CURVE_COLOR: Record<WorldCurveKind, number> = {
  polyline: 0x7dd3fc,
  spline: 0x5eead4,
  polygon: 0xa3e635,
  network: 0x93c5fd,
}

const CURVE_COLOR_3D: Record<WorldCurveKind, number> = {
  polyline: 0xf0abfc,
  spline: 0xfbbf24,
  polygon: 0xf472b6,
  network: 0xc084fc,
}

function curveStrokeRibbon(positions: Float32Array, halfWidth: number): THREE.BufferGeometry | null {
  const n = positions.length / 3
  if (n < 2 || !(halfWidth > 0)) return null
  const verts = new Float32Array(n * 6)
  const indices: number[] = []
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3]!
    const y = positions[i * 3 + 1]!
    const z = positions[i * 3 + 2]!
    const px = i === 0 ? x : positions[(i - 1) * 3]!
    const py = i === 0 ? y : positions[(i - 1) * 3 + 1]!
    const nx = i === n - 1 ? x : positions[(i + 1) * 3]!
    const ny = i === n - 1 ? y : positions[(i + 1) * 3 + 1]!
    const tx = nx - px
    const ty = ny - py
    const len = Math.hypot(tx, ty) || 1
    const ox = (-ty / len) * halfWidth
    const oy = (tx / len) * halfWidth
    verts[i * 6] = x + ox
    verts[i * 6 + 1] = y + oy
    verts[i * 6 + 2] = z
    verts[i * 6 + 3] = x - ox
    verts[i * 6 + 4] = y - oy
    verts[i * 6 + 5] = z
    if (i > 0) {
      const a = (i - 1) * 2
      indices.push(a, a + 1, i * 2, a + 1, i * 2 + 1, i * 2)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3))
  geo.setIndex(indices)
  return geo
}

function curveStrokePositions(stroke: WorldCurveStroke, lift: number): Float32Array | null {
  const pts = stroke.points.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
  if (pts.length < 2) return null
  const closed = stroke.closed === true
  const n = pts.length + (closed ? 1 : 0)
  const positions = new Float32Array(n * 3)
  for (let i = 0; i < pts.length; i++) {
    const [x, y, z] = pts[i]!
    positions[i * 3] = x * BASE_CELL_SIZE
    positions[i * 3 + 1] = -y * BASE_CELL_SIZE
    positions[i * 3 + 2] = authoredSurfaceZ(z, lift)
  }
  if (closed) {
    const [x, y, z] = pts[0]!
    positions[(n - 1) * 3] = x * BASE_CELL_SIZE
    positions[(n - 1) * 3 + 1] = -y * BASE_CELL_SIZE
    positions[(n - 1) * 3 + 2] = authoredSurfaceZ(z, lift)
  }
  return positions
}

export function buildWorldCurveOverlay(
  curves: readonly WorldCurveFrame[],
  selectedNodeIds: readonly string[] = [],
): THREE.Group {
  const group = new THREE.Group()
  group.name = 'world-curve-strokes'
  const lift = BASE_CELL_SIZE * 0.06
  for (const curve of curves) {
    const selected = !!curve.nodeId && selectedNodeIds.includes(curve.nodeId)
    const color = selected ? 0xffe066 : (curve.space === 'world3d' ? CURVE_COLOR_3D[curve.kind] : CURVE_COLOR[curve.kind])
    const item = new THREE.Group()
    item.name = `curve-frame:${curve.id}`
    item.userData = {
      nodeId: curve.nodeId,
      layerKey: `curve:${curve.id}`,
      isCurve: true,
      curve,
    }
    for (let i = 0; i < curve.strokes.length; i++) {
      const positions = curveStrokePositions(curve.strokes[i]!, lift)
      if (!positions) continue
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: selected ? 1 : 0.92,
        depthTest: false,
        depthWrite: false,
        fog: false,
      }))
      line.name = `curve-stroke:${curve.id}:${i}`
      line.frustumCulled = false
      line.renderOrder = 901
      line.userData = item.userData
      item.add(line)
      if (curve.kind === 'spline') {
        const ribbon = curveStrokeRibbon(positions, BASE_CELL_SIZE * 0.28)
        if (ribbon) {
          const mesh = new THREE.Mesh(ribbon, new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: selected ? 0.95 : 0.78,
            depthTest: false,
            depthWrite: false,
            fog: false,
            side: THREE.DoubleSide,
          }))
          mesh.name = `curve-ribbon:${curve.id}:${i}`
          mesh.frustumCulled = false
          mesh.renderOrder = 900
          mesh.userData = item.userData
          item.add(mesh)
        }
      }
    }
    const verts = curve.vertices ?? []
    if (verts.length > 0) {
      const positions = new Float32Array(verts.length * 3)
      for (let i = 0; i < verts.length; i++) {
        const [x, y, z] = verts[i]!
        positions[i * 3] = x * BASE_CELL_SIZE
        positions[i * 3 + 1] = -y * BASE_CELL_SIZE
        positions[i * 3 + 2] = authoredSurfaceZ(z, lift)
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      const dots = new THREE.Points(geo, new THREE.PointsMaterial({
        color,
        size: 6,
        sizeAttenuation: false,
        transparent: true,
        opacity: selected ? 1 : 0.95,
        depthTest: false,
        depthWrite: false,
        fog: false,
      }))
      dots.name = `curve-verts:${curve.id}`
      dots.frustumCulled = false
      dots.renderOrder = 902
      dots.userData = item.userData
      item.add(dots)
    }
    group.add(item)
  }
  return group
}

function worldFrameSpecKey(spec: { size: number; divisions: number }): string {
  return `${spec.size}:${spec.divisions}`
}

function disposePointMarkMap(root: THREE.Object3D): void {
  const map = root.userData.pointMarkMap
  if (map instanceof THREE.Texture) {
    map.dispose()
    root.userData.pointMarkMap = undefined
  }
}

function disposeRenderable(obj: THREE.Object3D): void {
  if (obj instanceof THREE.Sprite) {
    // Sprite geometry is a Three.js singleton — never dispose it.
    if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose())
    else obj.material?.dispose()
    return
  }
  if (!(obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.LineSegments || obj instanceof THREE.Points)) return
  obj.geometry?.dispose()
  if (Array.isArray(obj.material)) {
    obj.material.forEach((m) => {
      m.map?.dispose()
      m.dispose()
    })
  } else if (obj.material) {
    obj.material.map?.dispose()
    obj.material.dispose()
  }
}

function disposeObjectTree(root: THREE.Object3D): void {
  disposePointMarkMap(root)
  root.traverse((obj) => disposeRenderable(obj))
}

export function createWorldFrameOverlay(
  planes: readonly WorldPlaneFrame[] = [],
  selectedPlaneId?: string | null,
  selectedNodeIds: readonly string[] = [],
  points: readonly WorldPointFrame[] = [],
  curves: readonly WorldCurveFrame[] = [],
): THREE.Group {
  const spec = worldFrameGridSpec(planes)
  const group = createViewGuides3d({
    size: spec.size * BASE_CELL_SIZE,
    divisions: spec.divisions,
    axisLength: Math.min(24, spec.size * 0.08) * BASE_CELL_SIZE,
  })
  group.name = 'world-frame'
  group.userData.skipFit = true
  group.userData.worldFrameSpec = worldFrameSpecKey(spec)
  if (planes.length) {
    group.add(buildWorldPlaneOverlay(planes, selectedPlaneId, selectedNodeIds))
  }
  if (points.length) {
    group.add(buildWorldPointOverlay(points, selectedNodeIds))
  }
  if (curves.length) {
    group.add(buildWorldCurveOverlay(curves, selectedNodeIds))
  }
  return group
}

/** Keep the metre grid/axes still; only rebuild authored plane rectangles and point marks. */
export function syncWorldFrameOverlay(
  group: THREE.Group | null,
  planes: readonly WorldPlaneFrame[] = [],
  selectedPlaneId?: string | null,
  selectedNodeIds: readonly string[] = [],
  points: readonly WorldPointFrame[] = [],
  curves: readonly WorldCurveFrame[] = [],
): THREE.Group {
  const specKey = worldFrameSpecKey(worldFrameGridSpec(planes))
  if (!group || group.userData.worldFrameSpec !== specKey) {
    if (group) disposeWorldFrameOverlay(group)
    return createWorldFrameOverlay(planes, selectedPlaneId, selectedNodeIds, points, curves)
  }
  const frames = group.getObjectByName('world-plane-frames')
  if (frames) {
    group.remove(frames)
    disposeObjectTree(frames)
  }
  const marks = group.getObjectByName('world-point-marks')
  if (marks) {
    group.remove(marks)
    disposeObjectTree(marks)
  }
  const strokes = group.getObjectByName('world-curve-strokes')
  if (strokes) {
    group.remove(strokes)
    disposeObjectTree(strokes)
  }
  if (planes.length) {
    group.add(buildWorldPlaneOverlay(planes, selectedPlaneId, selectedNodeIds))
  }
  if (points.length) {
    group.add(buildWorldPointOverlay(points, selectedNodeIds))
  }
  if (curves.length) {
    group.add(buildWorldCurveOverlay(curves, selectedNodeIds))
  }
  return group
}

export function disposeWorldFrameOverlay(group: THREE.Group): void {
  const marks = group.getObjectByName('world-point-marks')
  if (marks) disposePointMarkMap(marks)
  group.traverse((obj) => disposeRenderable(obj))
  disposeViewGuides3d(group)
}
