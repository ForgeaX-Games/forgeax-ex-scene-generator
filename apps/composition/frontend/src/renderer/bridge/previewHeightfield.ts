import { buildHeightfieldMesh, heightfieldStretchMetrics } from '../../../../vendor/shared/types/scene/heightfield.js'
import { unwrapHeightfield } from '../../../../vendor/shared/types/scene/heightfieldField.js'
import { asPlane, planePointToWorld, type Plane } from '../../../../vendor/shared/types/scene/spatial.js'
import { authoringMeshToRenderer } from '../framework/sceneWorldXform'
import type { MeshPayload } from '../types'

const IDENTITY_XFORM = { tx: 0, ty: 0, tz: 0, yaw: 0 }
const GRASS: [number, number, number] = [0.34, 0.52, 0.28]
const HALO: [number, number, number] = [0.82, 0.18, 0.16]

function isDefaultOnesMask(mask: number[][] | undefined): boolean {
  if (!mask || mask.length === 0) return true
  for (const row of mask) {
    for (const value of row) {
      if (Number(value) !== 1) return false
    }
  }
  return true
}

function sampleMaskAtWorld(mask: number[][], plane: Plane, x: number, y: number): number {
  const rows = mask.length
  const columns = mask[0]?.length ?? 0
  if (rows < 1 || columns < 1 || plane.width <= 0 || plane.height <= 0) return 0
  const originX = Number(plane.origin[0]) || 0
  const originY = Number(plane.origin[1]) || 0
  const col = Math.max(0, Math.min(columns - 1, Math.floor(((x - originX) / plane.width) * columns)))
  const row = Math.max(0, Math.min(rows - 1, Math.floor(((y - originY) / plane.height) * rows)))
  const value = Number(mask[row]?.[col])
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}

function paintMaskHalo(positions: readonly number[], plane: Plane, mask: number[][]): number[] {
  const colors: number[] = []
  for (let i = 0; i < positions.length; i += 3) {
    const t = sampleMaskAtWorld(mask, plane, positions[i]!, positions[i + 1]!)
    colors.push(
      GRASS[0] + (HALO[0] - GRASS[0]) * t,
      GRASS[1] + (HALO[1] - GRASS[1]) * t,
      GRASS[2] + (HALO[2] - GRASS[2]) * t,
    )
  }
  return colors
}

/**
 * Lift a Heightfield packet into a Default terrain overlay.
 * Pose comes only from the packet's own geometry — last TypeScript run,
 * not a live BasePlane guess. Then flip Y once for the viewport.
 */
export function meshFromHeightfieldPacket(raw: unknown): MeshPayload | null {
  const field = unwrapHeightfield(raw)
  if (!field) return null
  const plane = asPlane(field.geometry)
  if (!plane) return null
  const metrics = heightfieldStretchMetrics(plane.width, plane.height, field.columns, field.rows)
  const built = buildHeightfieldMesh(field.height, {
    cellSizeX: metrics.cellSizeX,
    cellSizeY: metrics.cellSizeY,
    origin: [0, 0],
    heightScale: 1,
  })
  if (!built) return null
  const authored = Array.from(built.positions)
  for (let i = 0; i < authored.length; i += 3) {
    const [wx, wy, wz] = planePointToWorld(plane, authored[i]!, authored[i + 1]!)
    authored[i] = wx
    authored[i + 1] = wy
    authored[i + 2] = wz + (authored[i + 2] ?? 0)
  }
  const rendered = authoringMeshToRenderer(
    { positions: authored, indices: Array.from(built.indices) },
    IDENTITY_XFORM,
  )
  // Packet weave is plane + height. A non-default mask paints a red halo;
  // default all-1s stays the uniform grass tint. Attributes stay unpainted.
  const colors = isDefaultOnesMask(field.mask) ? undefined : paintMaskHalo(authored, plane, field.mask)
  return {
    positions: rendered.positions,
    indices: rendered.indices,
    color: GRASS,
    ...(colors ? { colors } : {}),
    role: 'terrain',
  }
}
