import type { BakedCellDTO } from '../../bridge/bakedApi'

export type CollisionMask =
  | { kind: 'rectangle'; x: number; y: number; width: number; height: number }
  | { kind: 'polygon'; points: Array<{ x: number; y: number }> }

export interface GridFootprint {
  width: number
  height: number
  /** Cell offset from the target anchor/pivot to the footprint's minimum x. */
  offsetX?: number
  /** Cell offset from the target anchor/pivot to the footprint's minimum bottom-origin y. */
  offsetY?: number
}

export interface FootprintAnchorGeometry {
  widthPx?: number
  heightPx?: number
  /** Anchor X: 0=left, 1=right, 0.5=center. */
  anchorX?: number
  /** Anchor Y is bottom-origin: 0=bottom, 1=top. */
  anchorY?: number
}

export interface VoxelPoint {
  x: number
  y: number
  z: number
}

export const OBJECT_FOOTPRINT_CELL_COVERAGE_THRESHOLD = 0.22

export function computeCollisionFootprint(
  mask: CollisionMask | undefined,
  ppu = 16,
  anchorGeometry?: FootprintAnchorGeometry,
): GridFootprint {
  if (!mask || ppu <= 0) return { width: 1, height: 1 }
  const anchorPx = anchorPixel(anchorGeometry)
  if (mask.kind === 'rectangle') return rectangleFootprint(mask, ppu, anchorPx)
  const rectangle = axisAlignedPolygonRectangle(mask.points)
  if (rectangle) return rectangleFootprint(rectangle, ppu, anchorPx)
  return polygonFootprint(mask.points, ppu, anchorPx)
}

function rectangleFootprint(
  mask: Extract<CollisionMask, { kind: 'rectangle' }>,
  ppu: number,
  anchorPx: { x: number; y: number; explicit: boolean },
): GridFootprint {
  const width = Math.max(1, Math.round(mask.width / ppu))
  const height = Math.max(1, Math.round(mask.height / ppu))
  const footprint: GridFootprint = { width, height }
  if (anchorPx.explicit) {
    const centerX = (mask.x + mask.width / 2 - anchorPx.x) / ppu
    const centerY = (mask.y + mask.height / 2 - anchorPx.y) / ppu
    footprint.offsetX = roundCellCenterOffset(centerX - (width - 1) / 2)
    footprint.offsetY = roundCellCenterOffset(centerY - (height - 1) / 2)
  }
  return footprint
}

function polygonFootprint(
  points: Array<{ x: number; y: number }>,
  ppu: number,
  anchorPx: { x: number; y: number; explicit: boolean },
): GridFootprint {
  const localPoints = points
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((point) => ({ x: point.x - anchorPx.x, y: point.y - anchorPx.y }))
  const bounds = polygonBounds(localPoints)
  if (!bounds) return { width: 1, height: 1 }
  const minCandidateX = firstOverlappingCell(bounds.minX / ppu)
  const maxCandidateX = lastOverlappingCell(bounds.maxX / ppu)
  const minCandidateY = firstOverlappingCell(bounds.minY / ppu)
  const maxCandidateY = lastOverlappingCell(bounds.maxY / ppu)
  let minCellX = Infinity
  let minCellY = Infinity
  let maxCellX = -Infinity
  let maxCellY = -Infinity
  let bestCell: { x: number; y: number; coverage: number } | null = null
  for (let cellY = minCandidateY; cellY <= maxCandidateY; cellY++) {
    for (let cellX = minCandidateX; cellX <= maxCandidateX; cellX++) {
      const coverage = polygonCellCoverage(localPoints, cellX, cellY, ppu)
      const centerInside = pointInPolygon({ x: cellX * ppu, y: cellY * ppu }, localPoints)
      if (!bestCell || coverage > bestCell.coverage) bestCell = { x: cellX, y: cellY, coverage }
      if (centerInside || coverage >= OBJECT_FOOTPRINT_CELL_COVERAGE_THRESHOLD) {
        minCellX = Math.min(minCellX, cellX)
        minCellY = Math.min(minCellY, cellY)
        maxCellX = Math.max(maxCellX, cellX)
        maxCellY = Math.max(maxCellY, cellY)
      }
    }
  }
  if (!Number.isFinite(minCellX)) {
    const fallbackX = bestCell?.x ?? roundCellCenterOffset(((bounds.minX + bounds.maxX) / 2) / ppu)
    const fallbackY = bestCell?.y ?? roundCellCenterOffset(((bounds.minY + bounds.maxY) / 2) / ppu)
    minCellX = maxCellX = fallbackX
    minCellY = maxCellY = fallbackY
  }
  const footprint: GridFootprint = {
    width: Math.max(1, maxCellX - minCellX + 1),
    height: Math.max(1, maxCellY - minCellY + 1),
  }
  if (anchorPx.explicit) {
    footprint.offsetX = minCellX
    footprint.offsetY = minCellY
  }
  return footprint
}

export function computeColumnHeight(objectHeightPx: number | undefined, ppu = 16): number {
  if (!objectHeightPx || objectHeightPx <= 0 || ppu <= 0) return 1
  return Math.max(1, Math.ceil(objectHeightPx / ppu))
}

export function snapFootprintToBottomCenter(target: VoxelPoint, footprint: GridFootprint): VoxelPoint {
  return {
    x: target.x + (footprint.offsetX ?? -Math.floor(footprint.width / 2)),
    y: target.y + (footprint.offsetY ?? -(footprint.height - 1)),
    z: target.z,
  }
}

export function buildObjectInstanceCells({
  origin,
  footprint,
  columnHeight,
  token,
  instanceId,
}: {
  origin: VoxelPoint
  footprint: GridFootprint
  columnHeight: number
  token?: string
  instanceId: string
}): BakedCellDTO[] {
  const cells: BakedCellDTO[] = []
  const safeWidth = Math.max(1, Math.floor(footprint.width))
  const safeHeight = Math.max(1, Math.floor(footprint.height))
  const safeColumnHeight = Math.max(1, Math.floor(columnHeight))
  const anchorDx = clampCellIndex(footprint.offsetX === undefined ? Math.floor(safeWidth / 2) : -footprint.offsetX, safeWidth)
  const anchorDy = clampCellIndex(footprint.offsetY === undefined ? safeHeight - 1 : -footprint.offsetY, safeHeight)
  for (let dz = 0; dz < safeColumnHeight; dz++) {
    for (let dy = 0; dy < safeHeight; dy++) {
      for (let dx = 0; dx < safeWidth; dx++) {
        cells.push({
          x: origin.x + dx,
          y: origin.y + dy,
          z: origin.z + dz,
          ...(token ? { token } : {}),
          state: {
            instanceId,
            role: dz === 0 && dx === anchorDx && dy === anchorDy ? 'anchor' : 'column',
            footprintDx: dx,
            footprintDy: dy,
            columnDz: dz,
            columnHeight: safeColumnHeight,
            footprintOrigin: origin,
          },
        })
      }
    }
  }
  return cells
}

export interface ObjectPlacementMeta extends FootprintAnchorGeometry {
  ppu?: number
  geometry?: { collisionMask?: CollisionMask }
  objectHeightPx?: number
}

/**
 * Resolve a single object placement at `target`: its footprint, column height,
 * bottom-center-snapped origin, and the cells it occupies. Shared by free-brush
 * single placement and box-select batch fill so both stay byte-identical.
 */
export function resolveObjectPlacement(
  target: VoxelPoint,
  meta: ObjectPlacementMeta,
  token: string,
  makeInstanceId: (origin: VoxelPoint) => string,
): { origin: VoxelPoint; footprint: GridFootprint; columnHeight: number; cells: BakedCellDTO[] } {
  const ppu = meta.ppu ?? 16
  const footprint = computeCollisionFootprint(meta.geometry?.collisionMask, ppu, meta)
  const columnHeight = computeColumnHeight(meta.objectHeightPx ?? meta.heightPx, ppu)
  const origin = snapFootprintToBottomCenter(target, footprint)
  const cells = buildObjectInstanceCells({ origin, footprint, columnHeight, token, instanceId: makeInstanceId(origin) })
  return { origin, footprint, columnHeight, cells }
}

function polygonBounds(points: Array<{ x: number; y: number }>): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (points.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null
}

function axisAlignedPolygonRectangle(points: Array<{ x: number; y: number }>): Extract<CollisionMask, { kind: 'rectangle' }> | null {
  const bounds = polygonBounds(points)
  if (!bounds || points.length !== 4 || bounds.maxX <= bounds.minX || bounds.maxY <= bounds.minY) return null
  const corners = new Set([
    `${bounds.minX},${bounds.minY}`,
    `${bounds.maxX},${bounds.minY}`,
    `${bounds.maxX},${bounds.maxY}`,
    `${bounds.minX},${bounds.maxY}`,
  ])
  for (const point of points) {
    if (!corners.has(`${point.x},${point.y}`)) return null
  }
  return {
    kind: 'rectangle',
    x: bounds.minX,
    y: bounds.minY,
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
  }
}

function polygonCellCoverage(points: Array<{ x: number; y: number }>, cellX: number, cellY: number, ppu: number): number {
  const samplesPerAxis = 6
  let covered = 0
  for (let sampleY = 0; sampleY < samplesPerAxis; sampleY++) {
    for (let sampleX = 0; sampleX < samplesPerAxis; sampleX++) {
      const point = {
        x: (cellX - 0.5 + (sampleX + 0.5) / samplesPerAxis) * ppu,
        y: (cellY - 0.5 + (sampleY + 0.5) / samplesPerAxis) * ppu,
      }
      if (pointInPolygon(point, points)) covered++
    }
  }
  return covered / (samplesPerAxis * samplesPerAxis)
}

function firstOverlappingCell(min: number): number {
  return Math.floor(min - 0.5) + 1
}

function lastOverlappingCell(max: number): number {
  return Math.ceil(max + 0.5) - 1
}

function roundCellCenterOffset(value: number): number {
  return Math.ceil(value - 0.5)
}

function pointInPolygon(point: { x: number; y: number }, points: Array<{ x: number; y: number }>): boolean {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]
    const b = points[j]
    const intersects = ((a.y > point.y) !== (b.y > point.y))
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    if (intersects) inside = !inside
  }
  return inside
}

function anchorPixel(anchorGeometry: FootprintAnchorGeometry | undefined): { x: number; y: number; explicit: boolean } {
  const widthPx = anchorGeometry?.widthPx
  const heightPx = anchorGeometry?.heightPx
  if (!Number.isFinite(widthPx) || !Number.isFinite(heightPx) || widthPx === undefined || heightPx === undefined || widthPx <= 0 || heightPx <= 0) {
    return { x: 0, y: 0, explicit: false }
  }
  return {
    x: widthPx * (anchorGeometry?.anchorX ?? 0.5),
    y: heightPx * (anchorGeometry?.anchorY ?? 0.5),
    explicit: true,
  }
}

function clampCellIndex(value: number, size: number): number {
  return Math.max(0, Math.min(size - 1, Math.floor(value)))
}
