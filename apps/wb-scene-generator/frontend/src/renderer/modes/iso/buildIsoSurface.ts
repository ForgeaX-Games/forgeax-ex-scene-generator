// 💡 mode-iso 的 voxel 主缓冲区构造
//
// 把所有 voxel layers 的 cells 烤成一张 2D OffscreenCanvas,流水线沿用
// topBillboard 的 collect → sort → paint 模式,但简化:
//   * 无 asset binding / rule / variants(本期只 wire / color)
//   * painter sort 用 (x + y + z) ASC,iso 视角的"远近"合并到对角线
//   * 视口 / pan / zoom 在 compose 阶段应用,build 阶段一律 1:1 像素

import type { CellSource } from '../../framework/cellSource'
import { createSurface, type Surface2D } from '../../framework/canvas2d'
import type { DrawMode } from '../../types'
import {
  computeIsoBbox, isoVoxelAnchorPx,
  type IsoBbox, type IsoVoxelCellLite,
} from '../../framework/geometry/iso'
import { paintIsoCell } from './paintCell'

// ── 输入 ────────────────────────────────────────────────────────────────

export interface IsoLayerInput {
  source: CellSource
  /** 该层在所有 voxel layers 的 z-order 中的序号(painter 兜底键 / 取色 hue) */
  layerIdx: number
  isSelected: boolean
  isEditorSelected: boolean
}

export interface BuildIsoOpts {
  drawMode: DrawMode  // 本期只支持 'wire' / 'color';其它会落到 color
}

export interface IsoMaster {
  canvas: Surface2D
  bbox: IsoBbox
}

// ── 内部 ────────────────────────────────────────────────────────────────

interface CollectedIsoCell {
  x: number
  y: number
  z: number
  value: number
  layerIdx: number
  isSelected: boolean
  isEditorSelected: boolean
  isMultiValue: boolean
}

// ── pipeline ────────────────────────────────────────────────────────────

export function buildIsoSurface(
  inputs: ReadonlyArray<IsoLayerInput>,
  opts: BuildIsoOpts,
): IsoMaster | null {
  // ① collect:扁平化 + 邻域占位(为 cull 留口子,本期不用)
  const allCells: CollectedIsoCell[] = []
  for (const input of inputs) {
    input.source.iterCells(({ col, row, value, z }) => {
      const wx = col + (input.source.worldOffsetX ?? 0)
      const wy = row + (input.source.worldOffsetY ?? 0)
      const wz = z ?? 0
      allCells.push({
        x: wx, y: wy, z: wz, value,
        layerIdx: input.layerIdx,
        isSelected: input.isSelected,
        isEditorSelected: input.isEditorSelected,
        isMultiValue: input.source.isMultiValue,
      })
    })
  }
  if (allCells.length === 0) return null

  // ② painter sort:(x+y+z) ASC,平局按 layerIdx
  // iso 投影下"远近"是对角线 (x+y) + 垂直 (z) 的合成。值越大越靠近 camera,后画。
  allCells.sort((a, b) => {
    const da = a.x + a.y + a.z
    const db = b.x + b.y + b.z
    if (da !== db) return da - db
    return a.layerIdx - b.layerIdx
  })

  // ③ canvas 尺寸
  const lite: IsoVoxelCellLite[] = allCells.map(c => ({ x: c.x, y: c.y, z: c.z }))
  const bbox = computeIsoBbox(lite)
  const canvas = createSurface(bbox.pxW, bbox.pxH)
  // jsdom (no `canvas` pkg) throws on getContext rather than returning null;
  // treat any failure as "no 2D context" so the build is a clean no-op.
  let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null
  try {
    ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  } catch {
    ctx = null
  }
  if (!ctx) return null

  // ④ bake
  ctx.imageSmoothingEnabled = false
  for (const c of allCells) {
    const anchor = isoVoxelAnchorPx(c, bbox)
    paintIsoCell(ctx, c, anchor, opts.drawMode)
  }
  return { canvas, bbox }
}

// ── cacheKey ───────────────────────────────────────────────────────────

export function makeIsoSurfaceCacheKey(
  inputs: ReadonlyArray<IsoLayerInput>,
  drawMode: DrawMode,
): string {
  if (inputs.length === 0) return `empty:${drawMode}`
  const parts = inputs
    .slice()
    .sort((a, b) => a.layerIdx - b.layerIdx)
    .map(i => {
      const sel = `${i.isSelected ? 'L' : ''}${i.isEditorSelected ? 'E' : ''}`
      return `${i.source.layerKey}@${i.source.version}/${sel}`
    })
  return `${drawMode}:${parts.join('|')}`
}
