/**
 * Hangable mesh helpers: box construction (Modeling/geometry3d) and world pose (Modeling/pose).
 * Vertices are authoring metres. Local +X east, +Y south, +Z up.
 * box origin is the floor-centre contact point.
 */

export interface HangableMesh {
  kind: 'mesh'
  positions: number[]
  indices: number[]
  normals?: number[]
  colors?: number[]
  color?: [number, number, number]
  role?: string
  [key: string]: unknown
}

export interface MeshAabb {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
}

function finiteNumber(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function cloneMesh(mesh: HangableMesh, positions: number[]): HangableMesh {
  return {
    ...mesh,
    kind: 'mesh',
    positions,
    indices: mesh.indices.slice(),
  }
}

export function meshAabb(positions: readonly number[]): MeshAabb | null {
  if (positions.length < 3) return null
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i]!
    const y = positions[i + 1]!
    const z = positions[i + 2]!
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }
  if (!Number.isFinite(minX)) return null
  return { minX, maxX, minY, maxY, minZ, maxZ }
}

function asMeshRecord(value: unknown): HangableMesh | null {
  if (!value || typeof value !== 'object') return null
  const rec = value as Record<string, unknown>
  const positions = rec.positions
  const indices = rec.indices
  if (!Array.isArray(positions) || positions.length < 3 || !Array.isArray(indices)) return null
  return {
    ...(rec as HangableMesh),
    kind: 'mesh',
    positions: positions.map((n) => Number(n) || 0),
    indices: indices.map((n) => Number(n) || 0),
  }
}

export function peelHangableMesh(value: unknown, depth = 0): HangableMesh | null {
  if (value == null || depth > 8) return null
  const direct = asMeshRecord(value)
  if (direct && (direct.kind === 'mesh' || !('kind' in (value as object)))) return direct
  if (direct) return direct
  if (Array.isArray(value)) {
    if (value.length === 1) return peelHangableMesh(value[0], depth + 1)
    if (value.length > 0 && typeof value[0] === 'object' && value[0] && 'items' in value[0]) {
      const items = (value as Array<{ items?: unknown[] }>).flatMap((entry) => (
        Array.isArray(entry.items) ? entry.items : []
      ))
      if (items.length === 1) return peelHangableMesh(items[0], depth + 1)
    }
    return null
  }
  if (typeof value !== 'object') return null
  const rec = value as Record<string, unknown>
  if (Array.isArray(rec.items)) {
    if (rec.items.length === 1) return peelHangableMesh(rec.items[0], depth + 1)
  }
  if (rec.geometry) return peelHangableMesh(rec.geometry, depth + 1)
  if (rec.mesh) return peelHangableMesh(rec.mesh, depth + 1)
  return null
}

/** Local box. Origin is the floor-centre contact; +Z is height. */
export function buildBoxMesh(width: number, depth: number, height: number): HangableMesh {
  const hx = width / 2
  const hy = depth / 2
  return {
    kind: 'mesh',
    role: 'solid',
    positions: [
      -hx, -hy, 0,
      hx, -hy, 0,
      hx, hy, 0,
      -hx, hy, 0,
      -hx, -hy, height,
      hx, -hy, height,
      hx, hy, height,
      -hx, hy, height,
    ],
    indices: [
      0, 3, 2, 0, 2, 1,
      4, 5, 6, 4, 6, 7,
      0, 1, 5, 0, 5, 4,
      3, 7, 6, 3, 6, 2,
      0, 4, 7, 0, 7, 3,
      1, 2, 6, 1, 6, 5,
    ],
  }
}

export function poseMesh(
  mesh: HangableMesh,
  pose: { x?: unknown; y?: unknown; z?: unknown; yaw?: unknown; scale?: unknown },
): HangableMesh {
  const x = finiteNumber(pose.x, 0)
  const y = finiteNumber(pose.y, 0)
  const z = finiteNumber(pose.z, 0)
  const yaw = finiteNumber(pose.yaw, 0)
  const scale = finiteNumber(pose.scale, 1)
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  const src = mesh.positions
  const positions = new Array(src.length)
  for (let i = 0; i + 2 < src.length; i += 3) {
    let px = src[i]! * scale
    let py = src[i + 1]! * scale
    const pz = src[i + 2]! * scale
    const rx = px * cos - py * sin
    const ry = px * sin + py * cos
    positions[i] = rx + x
    positions[i + 1] = ry + y
    positions[i + 2] = pz + z
  }
  return cloneMesh(mesh, positions)
}

/**
 * Sit the AABB floor-centre on (x, y, z + offset) after yaw.
 * Origin convention does not matter — contact is the bottom of the mesh.
 */
export function sitMeshOnGround(
  mesh: HangableMesh,
  pose: { x: number; y: number; z: number; yaw?: number; offset?: number },
): HangableMesh {
  const yaw = finiteNumber(pose.yaw, 0)
  const offset = finiteNumber(pose.offset, 0)
  const rotated = poseMesh(mesh, { yaw })
  const box = meshAabb(rotated.positions)
  if (!box) return rotated
  const cx = (box.minX + box.maxX) / 2
  const cy = (box.minY + box.maxY) / 2
  return poseMesh(rotated, {
    x: pose.x - cx,
    y: pose.y - cy,
    z: pose.z + offset - box.minZ,
  })
}
