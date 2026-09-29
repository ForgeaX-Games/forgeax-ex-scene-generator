// Discrete GridLayer heightfield for 3DMesh.
//
// Every finite grid value is an absolute Z sample, including zero and negative
// values. The mesh is a stepped surface rather than a set of boxes:
//   * equal-height top cells are greedily merged;
//   * shared walls are emitted only for the height difference;
//   * collinear wall segments with the same interval/color are merged.

import * as THREE from 'three'
import { BASE_CELL_SIZE } from '../../framework/geometry/constants'
import { gridCornerToWorld } from '../../framework/geometry/worldCoordinates'
import { colorForValue, type RGBA } from '../../framework/palette'
import type { GridLayer } from '../../types'

export interface BuildGridHeightMeshOpts {
  layer: GridLayer
  wireframe: boolean
  selectedEditorNodeIds?: ReadonlySet<string> | ReadonlyArray<string>
  cellSize?: number
  /** World-space Z units per grid value. Defaults to one cell per value. */
  heightScale?: number
  /** Height used outside the rectangular grid and around holes. */
  boundaryZ?: number
}

export interface GridHeightMeshStats {
  cellCount: number
  topQuadCount: number
  sideQuadCount: number
  vertexCount: number
  triangleCount: number
}

interface WallSpan {
  z0: number
  z1: number
  value: number
  normalSign: -1 | 1
}

function selectedSet(ids: BuildGridHeightMeshOpts['selectedEditorNodeIds']): Set<string> {
  if (!ids) return new Set()
  return ids instanceof Set ? ids : new Set(ids)
}

function sameNumber(a: number, b: number): boolean {
  return Object.is(a, b) || a === b
}

function valueAt(layer: GridLayer, row: number, col: number): number | null {
  const value = layer.data[row]?.[col]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function sameWall(a: WallSpan | null, b: WallSpan | null): boolean {
  return !!a && !!b
    && sameNumber(a.z0, b.z0)
    && sameNumber(a.z1, b.z1)
    && sameNumber(a.value, b.value)
    && a.normalSign === b.normalSign
}

function wallBetween(
  negativeSideValue: number | null,
  positiveSideValue: number | null,
  heightScale: number,
  boundaryZ: number,
): WallSpan | null {
  if (negativeSideValue === null && positiveSideValue === null) return null
  const negativeZ = negativeSideValue === null ? boundaryZ : negativeSideValue * heightScale
  const positiveZ = positiveSideValue === null ? boundaryZ : positiveSideValue * heightScale
  if (sameNumber(negativeZ, positiveZ)) return null

  const negativeIsHigher = negativeZ > positiveZ
  const ownerValue = negativeIsHigher
    ? (negativeSideValue ?? positiveSideValue!)
    : (positiveSideValue ?? negativeSideValue!)
  return {
    z0: Math.min(negativeZ, positiveZ),
    z1: Math.max(negativeZ, positiveZ),
    value: ownerValue,
    normalSign: negativeIsHigher ? 1 : -1,
  }
}

function worldXY(cellX: number, cellY: number, cellSize: number): { x: number; y: number } {
  const world = gridCornerToWorld(cellX, cellY)
  return { x: world.x * cellSize, y: world.y * cellSize }
}

/**
 * Builds one indexed BufferGeometry for a dense, non-interpolated heightfield.
 * Missing/non-finite entries are holes; finite zero and negative values remain.
 */
export function buildGridHeightMesh(opts: BuildGridHeightMeshOpts): THREE.Mesh | null {
  const { layer } = opts
  if (!layer.visible) return null

  const rows = Math.max(layer.rows, layer.data.length, 0)
  let dataCols = 0
  for (const row of layer.data) dataCols = Math.max(dataCols, row?.length ?? 0)
  const cols = Math.max(layer.cols, dataCols, 0)
  if (rows === 0 || cols === 0) return null

  const cellSize = opts.cellSize ?? BASE_CELL_SIZE
  const heightScale = opts.heightScale ?? BASE_CELL_SIZE
  const boundaryZ = opts.boundaryZ ?? 0
  const selected = selectedSet(opts.selectedEditorNodeIds)
  const isSelected = selected.has(layer.nodeId)

  const positions: number[] = []
  const normals: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  let cellCount = 0
  let topQuadCount = 0
  let sideQuadCount = 0

  const rgba = (value: number): RGBA => colorForValue(value, { selected: isSelected })
  const pushQuad = (
    corners: ReadonlyArray<readonly [number, number, number]>,
    normal: readonly [number, number, number],
    value: number,
  ): void => {
    const base = positions.length / 3
    const color = rgba(value)
    for (const [x, y, z] of corners) {
      positions.push(x, y, z)
      normals.push(normal[0], normal[1], normal[2])
      colors.push(color.r / 255, color.g / 255, color.b / 255)
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  // Greedy top rectangles. Exact equal values imply equal height and color.
  const visited = new Uint8Array(rows * cols)
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const linear = row * cols + col
      if (visited[linear]) continue
      const value = valueAt(layer, row, col)
      if (value === null) continue

      let width = 1
      while (col + width < cols) {
        const idx = row * cols + col + width
        if (visited[idx] || !sameNumber(valueAt(layer, row, col + width) ?? NaN, value)) break
        width++
      }

      let height = 1
      heightLoop: while (row + height < rows) {
        for (let dx = 0; dx < width; dx++) {
          const idx = (row + height) * cols + col + dx
          if (visited[idx] || !sameNumber(valueAt(layer, row + height, col + dx) ?? NaN, value)) {
            break heightLoop
          }
        }
        height++
      }

      for (let dy = 0; dy < height; dy++) {
        for (let dx = 0; dx < width; dx++) {
          visited[(row + dy) * cols + col + dx] = 1
          cellCount++
        }
      }

      const { x: x0, y: y1 } = worldXY(col, row, cellSize)
      const { x: x1, y: y0 } = worldXY(col + width, row + height, cellSize)
      const z = value * heightScale
      pushQuad(
        [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]],
        [0, 0, 1],
        value,
      )
      topQuadCount++
    }
  }

  // X boundaries. Scan rows so adjacent equal wall spans become one quad.
  for (let boundary = 0; boundary <= cols; boundary++) {
    let row = 0
    while (row < rows) {
      const wall = wallBetween(
        boundary > 0 ? valueAt(layer, row, boundary - 1) : null,
        boundary < cols ? valueAt(layer, row, boundary) : null,
        heightScale,
        boundaryZ,
      )
      if (!wall) {
        row++
        continue
      }
      let endRow = row + 1
      while (endRow < rows) {
        const next = wallBetween(
          boundary > 0 ? valueAt(layer, endRow, boundary - 1) : null,
          boundary < cols ? valueAt(layer, endRow, boundary) : null,
          heightScale,
          boundaryZ,
        )
        if (!sameWall(wall, next)) break
        endRow++
      }

      const { x, y: y1 } = worldXY(boundary, row, cellSize)
      const { y: y0 } = worldXY(boundary, endRow, cellSize)
      pushQuad(
        [[x, y0, wall.z0], [x, y1, wall.z0], [x, y1, wall.z1], [x, y0, wall.z1]],
        [wall.normalSign, 0, 0],
        wall.value,
      )
      sideQuadCount++
      row = endRow
    }
  }

  // Y boundaries. Array rows run toward -Y, so the normal sign is inverted.
  for (let boundary = 0; boundary <= rows; boundary++) {
    let col = 0
    while (col < cols) {
      const wall = wallBetween(
        boundary > 0 ? valueAt(layer, boundary - 1, col) : null,
        boundary < rows ? valueAt(layer, boundary, col) : null,
        heightScale,
        boundaryZ,
      )
      if (!wall) {
        col++
        continue
      }
      let endCol = col + 1
      while (endCol < cols) {
        const next = wallBetween(
          boundary > 0 ? valueAt(layer, boundary - 1, endCol) : null,
          boundary < rows ? valueAt(layer, boundary, endCol) : null,
          heightScale,
          boundaryZ,
        )
        if (!sameWall(wall, next)) break
        endCol++
      }

      const { x: x0, y } = worldXY(col, boundary, cellSize)
      const { x: x1 } = worldXY(endCol, boundary, cellSize)
      pushQuad(
        [[x0, y, wall.z0], [x1, y, wall.z0], [x1, y, wall.z1], [x0, y, wall.z1]],
        [0, -wall.normalSign, 0],
        wall.value,
      )
      sideQuadCount++
      col = endCol
    }
  }

  if (topQuadCount === 0) return null

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()

  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    wireframe: opts.wireframe,
    transparent: opts.wireframe,
    opacity: opts.wireframe ? 0.6 : 1,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = `grid-heightfield:${layer.key}`
  mesh.userData.gridHeightStats = {
    cellCount,
    topQuadCount,
    sideQuadCount,
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
  } satisfies GridHeightMeshStats
  return mesh
}

export function disposeGridHeightMesh(mesh: THREE.Mesh): void {
  mesh.geometry.dispose()
  const material = mesh.material
  if (Array.isArray(material)) material.forEach((entry) => entry.dispose())
  else material.dispose()
}

export function getGridHeightMeshStats(mesh: THREE.Mesh): GridHeightMeshStats {
  return mesh.userData.gridHeightStats as GridHeightMeshStats
}
