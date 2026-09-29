// 💡 voxel master pipeline ⑤ bake (per-cell paint)
//
// 路由 drawMode → wire / color / asset 三条分支:
//   * 'wire'  —— 双面 strokeRect(顶面 + 立面)
//   * 'color' —— 顶面基色 + 立面基色 ×0.55
//   * 'asset' —— 命中 binding 且图加载完 → 贴图;否则 skip 该 cell(不退色块)
//
// asset 分支:rule 加载完 → 顶面 / 立面分别 pickFaceSprite + drawSprite。
// rule 缺哪面就 skip 那面绘制 —— 地面型 rule(只 faces.top)立面位置自然空,透出
// 底层 / canvas bg;墙体型 rule 中段 voxel 的 top sprite 跟 z+1 voxel 的 front
// sprite 同 canvas 位置,painter z ASC 让后者画在上面,top 自然被覆盖。
//
// rule 还没加载完时,fallback 到「顶面 + 立面 都画整图」,readiness pulse 重 build。
//
// degrade-on-missing:asset 模式下任何缺数据(无 binding / 图未加载 / 无 rule 且
// 整图 fallback 失败)都 SKIP,绝不抛错 —— jsdom 下 Image 永不 onload,getOrLoadImage
// 恒返回 null,asset cell 全部 skip,master 仍是干净的空 canvas。

import {
  billboardTopFaceCanvasXY, billboardFrontFaceCanvasXY,
  type VoxelBbox,
} from '../../../framework/geometry/topBillboard'
import { getOrLoadImage } from '../../../framework/asset/imageCache'
import type { RuleSprite } from '../../../framework/asset/ruleCache'
import { colorForValue, rgbaToCss } from '../../../framework/palette'
import type { DrawMode } from '../../../types'
import { TEXTURE_PPU } from '../../../framework/geometry/constants'
import type { CollectedCell, LayerAssetBinding, ResolvedDrawSink, ResolvedFace } from './types'
import { pickFaceSprite, pickFaceSpriteIndexIfMapped } from './pickFaceSprite'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
interface PaintedRect { x: number; y: number; w: number; h: number }
export interface ObjectSpriteGridRect { x: number; y: number; w: number; h: number }

/**
 * ADDITIVE resolve-capture (Path A). When `paintCell` is given a sink it reports
 * each sprite it resolves-and-draws, in draw order, so the export can CONSUME the
 * renderer's actual draw result instead of re-deriving occlusion/order/face. The
 * caller owns the monotonic `seq` counter so draw order is global across cells.
 * Entirely optional — omitting `capture` leaves the draw path unchanged.
 */
export interface ResolveCapture {
  sink: ResolvedDrawSink
  nextSeq: () => number
}

function emitResolved(
  capture: ResolveCapture | undefined,
  cell: CollectedCell,
  face: ResolvedFace,
  spriteIndex: number,
  srcRect: { x: number; y: number; w: number; h: number } | null,
): void {
  if (!capture) return
  // Screen cell = billboard projection: top cap at y-z-1, front wall at y-z,
  // object anchored on the front/footprint row (objectSpriteAnchorScreenY).
  const screenY = face === 'top' ? cell.y - cell.z - 1 : cell.y - cell.z
  capture.sink({
    drawSeq: capture.nextSeq(),
    screenX: cell.x,
    screenY,
    srcY: cell.y,
    z: cell.z,
    face,
    layerIdx: cell.layerIdx,
    spriteIndex,
    srcRect,
  })
}

export function paintCell(
  ctx: Ctx,
  cell: CollectedCell,
  bbox: VoxelBbox,
  cellSize: number,
  drawMode: DrawMode,
  assetByLayer?: Map<number, LayerAssetBinding | null> | null,
  coordsByLayerIdx?: Map<number, Set<string>>,
  capture?: ResolveCapture,
  objectAnchorPoint?: { x: number; y: number },
): void {
  const top = billboardTopFaceCanvasXY(cell, bbox, cellSize)
  const front = billboardFrontFaceCanvasXY(cell, bbox, cellSize)

  // asset drawMode:命中 alias 且图加载完才画;name 不命中 / 图加载中都直接不画
  // ——而不是退回 color 色块。理由:asset 视图下色块兜底跟贴图视觉对比强烈,
  // 用户看到一片色块会以为是错乱。图加载中只是瞬态,readiness pulse 触发重 build
  // 时该 cell 自然出现;name 不命中说明用户没配资产,留空更符合"没配就不显示"。
  if (drawMode === 'asset') {
    if (!assetByLayer || !coordsByLayerIdx) return
    const binding = assetByLayer.get(cell.layerIdx)
    if (!binding) return
    const img = getOrLoadImage(binding.imgUrl)
    if (!img) return
    const paintedRects = paintAssetCell(
      ctx, cell, bbox, top, front, cellSize, binding, coordsByLayerIdx, img, capture, objectAnchorPoint,
    )
    if (cell.isSelected) paintSelectedAssetHighlight(ctx, paintedRects)
    return
  }

  // Selection/editor-selection color boosts are encoded on each collected cell by
  // the mode before the master canvas is built.
  // Single-value Output voxels carry layer.value on every cell — same key as the
  // Output list swatch / Free3D / Top / Iso Color paths.
  const baseColor = colorForValue(cell.value, {
    selected: cell.isSelected,
    editorSelected: cell.isEditorSelected,
  })

  if (drawMode === 'wire') {
    paintWireCell(ctx, top, front, cellSize, baseColor)
  } else {
    paintColorCell(ctx, top, front, cellSize, baseColor)
  }
}

// ── color / wire ───────────────────────────────────────────────────────

function paintColorCell(
  ctx: Ctx,
  top: { x: number; y: number },
  front: { x: number; y: number },
  cellSize: number,
  base: { r: number; g: number; b: number; a: number },
): void {
  const shaded = scaleRgb(base, 0.55)
  ctx.fillStyle = rgbaToCss(shaded)
  ctx.fillRect(front.x, front.y, cellSize, cellSize)
  ctx.fillStyle = rgbaToCss(base)
  ctx.fillRect(top.x, top.y, cellSize, cellSize)
}

function paintWireCell(
  ctx: Ctx,
  top: { x: number; y: number },
  front: { x: number; y: number },
  cellSize: number,
  base: { r: number; g: number; b: number; a: number },
): void {
  ctx.lineWidth = 1
  ctx.lineCap = 'butt'
  ctx.strokeStyle = rgbaToCss(base)
  ctx.strokeRect(top.x + 0.5, top.y + 0.5, cellSize - 1, cellSize - 1)
  ctx.strokeRect(front.x + 0.5, front.y + 0.5, cellSize - 1, cellSize - 1)
}

// ── asset cell 绘制 ────────────────────────────────────────────────────

function paintAssetCell(
  ctx: Ctx,
  cell: CollectedCell,
  bbox: VoxelBbox,
  top: { x: number; y: number },
  front: { x: number; y: number },
  cellSize: number,
  binding: LayerAssetBinding,
  coordsByLayerIdx: Map<number, Set<string>>,
  img: HTMLImageElement,
  capture?: ResolveCapture,
  objectAnchorPoint?: { x: number; y: number },
): PaintedRect[] {
  const paintedRects: PaintedRect[] = []
  if (binding.rule) {
    // face-aware:顶面 / 收口(entry) / 立面分别 pick + draw,缺哪面就 skip
    const topFace = binding.rule.faces.top
    const entryFace = binding.rule.faces.entry
    const topCtxBase = {
      sprites: binding.rule.sprites,
      cell, coordsByLayerIdx, regions: binding.regions,
    }
    let drewTop = false
    if (entryFace) {
      const entryIdx = pickFaceSpriteIndexIfMapped({
        face: entryFace, faceTag: 'entry',
        validVariantIdxs: binding.validVariantIdxs.entry,
        validVariantWeights: binding.validVariantWeights.entry,
        validVariantPoolsByTileId: binding.validVariantPoolsByTileId.entry,
        ...topCtxBase,
      })
      if (entryIdx !== null) {
        const entrySprite = binding.rule.sprites[entryIdx] ?? binding.rule.sprites[0]
        if (entrySprite) {
          paintedRects.push(drawSprite(ctx, img, entrySprite, top.x, top.y, cellSize))
          emitResolved(capture, cell, 'top', entryIdx,
            { x: entrySprite.x, y: entrySprite.y, w: entrySprite.w, h: entrySprite.h })
          drewTop = true
        }
      }
    }
    if (!drewTop && topFace) {
      const topSprite = pickFaceSprite({
        face: topFace, faceTag: 'top',
        validVariantIdxs: binding.validVariantIdxs.top,
        validVariantWeights: binding.validVariantWeights.top,
        validVariantPoolsByTileId: binding.validVariantPoolsByTileId.top,
        ...topCtxBase,
      })
      if (topSprite) {
        paintedRects.push(drawSprite(ctx, img, topSprite, top.x, top.y, cellSize))
        emitResolved(capture, cell, 'top', binding.rule.sprites.indexOf(topSprite),
          { x: topSprite.x, y: topSprite.y, w: topSprite.w, h: topSprite.h })
      }
    }
    const frontFace = binding.rule.faces.front
    if (frontFace) {
      const sprite = pickFaceSprite({
        face: frontFace, faceTag: 'front',
        sprites: binding.rule.sprites,
        validVariantIdxs: binding.validVariantIdxs.front,
        validVariantWeights: binding.validVariantWeights.front,
        validVariantPoolsByTileId: binding.validVariantPoolsByTileId.front,
        cell, coordsByLayerIdx, regions: binding.regions,
      })
      if (sprite) {
        paintedRects.push(drawSprite(ctx, img, sprite, front.x, front.y, cellSize))
        emitResolved(capture, cell, 'front', binding.rule.sprites.indexOf(sprite),
          { x: sprite.x, y: sprite.y, w: sprite.w, h: sprite.h })
      }
    }
  } else if (binding.match.tileType) {
    // Tile whose rule is still loading: draw the full source image at PPU size
    // instead of stretching it to one cell.
    const size = sourceDrawSize(img, cellSize)
    ctx.drawImage(img, top.x, top.y, size.w, size.h)
    ctx.drawImage(img, front.x, front.y, size.w, size.h)
    paintedRects.push(
      { x: top.x, y: top.y, w: size.w, h: size.h },
      { x: front.x, y: front.y, w: size.w, h: size.h },
    )
    emitResolved(capture, cell, 'top', -1, null)
    emitResolved(capture, cell, 'front', -1, null)
  } else {
    // object (no rule): keep the image's real size per PPU and align its library
    // anchor to the cell-footprint centre, drawn ONCE (not stretched to the cell).
    paintedRects.push(
      drawAnchoredObject(ctx, img, binding.match.anchor, cell, bbox, cellSize, objectAnchorPoint),
    )
    emitResolved(capture, cell, 'object', -1, null)
  }
  return paintedRects
}

/**
 * Draw an object sprite at 16 PPU (image px / 16 = cells, no scaling). Sprite
 * bottom lands on the voxel bottom anchor; horizontal uses library anchorX.
 */
function drawAnchoredObject(
  ctx: Ctx,
  img: HTMLImageElement,
  anchor: { x: number; y: number } | undefined,
  cell: CollectedCell,
  bbox: VoxelBbox,
  cellPx: number,
  anchorPoint?: { x: number; y: number },
): PaintedRect {
  const rect = objectSpriteGridRect(cell, img, anchor, anchorPoint)
  const dx = (rect.x - bbox.worldOffsetX) * cellPx
  const dy = (rect.y - bbox.worldOffsetY) * cellPx
  const drawW = rect.w * cellPx
  const drawH = rect.h * cellPx
  ctx.drawImage(img, dx, dy, drawW, drawH)
  return { x: dx, y: dy, w: drawW, h: drawH }
}

export interface VoxelBottomFootprint {
  width: number
  depth: number
}

export interface VoxelBottomBounds extends VoxelBottomFootprint {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export function objectVoxelBottomBounds(cells: ReadonlyArray<CollectedCell>): VoxelBottomBounds {
  const minX = Math.min(...cells.map((c) => c.x))
  const maxX = Math.max(...cells.map((c) => c.x))
  const minY = Math.min(...cells.map((c) => c.y))
  const maxY = Math.max(...cells.map((c) => c.y))
  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX + 1,
    depth: maxY - minY + 1,
  }
}

export function objectVoxelBottomFootprint(cells: ReadonlyArray<CollectedCell>): VoxelBottomFootprint {
  const bounds = objectVoxelBottomBounds(cells)
  return { width: bounds.width, depth: bounds.depth }
}

export function objectFootprintAnchorPoint(cells: ReadonlyArray<CollectedCell>): { x: number; y: number } {
  const minX = Math.min(...cells.map((c) => c.x))
  const maxX = Math.max(...cells.map((c) => c.x))
  const maxY = Math.max(...cells.map((c) => c.y))
  const minZ = Math.min(...cells.map((c) => c.z))
  const centerX = (minX + maxX + 1) / 2
  // Front row (maxY) on minZ bottom — z=1 is the top face of ground (z=0).
  return {
    x: centerX,
    y: maxY - minZ + 0.5,
  }
}

/**
 * Object sprite rect at fixed 16 PPU (no scaling). Bottom edge on `anchorPoint`
 * (voxel bottom anchor); horizontal pivot from library anchorX.
 */
export function objectSpriteGridRect(
  cell: CollectedCell,
  img: HTMLImageElement,
  anchor: { x: number; y: number } | undefined,
  anchorPoint?: { x: number; y: number },
): ObjectSpriteGridRect {
  const natW = img.naturalWidth || img.width || TEXTURE_PPU
  const natH = img.naturalHeight || img.height || TEXTURE_PPU
  const w = natW / TEXTURE_PPU
  const h = natH / TEXTURE_PPU
  const ax = anchor?.x ?? 0.5
  const anchorX = anchorPoint?.x ?? cell.x + 0.5
  const anchorY = anchorPoint?.y ?? objectSpriteAnchorScreenY(cell)
  return {
    x: anchorX - ax * w,
    y: anchorY - h,
    w,
    h,
  }
}

export function objectSpriteAnchorScreenY(cell: CollectedCell): number {
  return cell.y - cell.z + 0.5
}

export function objectSpriteAnchorDepthY(cell: CollectedCell): number {
  return cell.y
}

/**
 * Painter-sort y for a billboard object sprite. Object rects live in screen-row
 * space (anchor uses y-z); tiles at z=0 sort by world y which equals their front
 * screen row. Use the sprite's front-most screen row so ground in front of the
 * footprint (world y > footprintDepthY) does not paint over the facade.
 */
export function objectSpritePainterSortY(
  rect: ObjectSpriteGridRect,
  footprintDepthY: number,
): number {
  return Math.max(footprintDepthY, rect.y + rect.h)
}

function drawSprite(
  ctx: Ctx,
  img: HTMLImageElement,
  sprite: RuleSprite,
  dx: number,
  dy: number,
  cellSize: number,
): PaintedRect {
  const drawW = (sprite.w / TEXTURE_PPU) * cellSize
  const drawH = (sprite.h / TEXTURE_PPU) * cellSize
  ctx.drawImage(img, sprite.x, sprite.y, sprite.w, sprite.h, dx, dy, drawW, drawH)
  return { x: dx, y: dy, w: drawW, h: drawH }
}

function sourceDrawSize(img: HTMLImageElement, cellSize: number): { w: number; h: number } {
  const natW = img.naturalWidth || img.width || cellSize
  const natH = img.naturalHeight || img.height || cellSize
  return {
    w: (natW / TEXTURE_PPU) * cellSize,
    h: (natH / TEXTURE_PPU) * cellSize,
  }
}

function paintSelectedAssetHighlight(
  ctx: Ctx,
  rects: ReadonlyArray<PaintedRect>,
): void {
  if (rects.length === 0) return

  ctx.save()
  ctx.fillStyle = 'rgba(255,255,255,0.24)'
  ctx.strokeStyle = 'rgba(45,212,191,0.48)'
  ctx.lineWidth = 1
  for (const rect of rects) {
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
    strokeInsetRect(ctx, rect)
  }
  ctx.restore()
}

function strokeInsetRect(ctx: Ctx, rect: PaintedRect): void {
  ctx.strokeRect(
    rect.x + 0.5,
    rect.y + 0.5,
    Math.max(0, rect.w - 1),
    Math.max(0, rect.h - 1),
  )
}

// ── helpers ────────────────────────────────────────────────────────────

function scaleRgb(c: { r: number; g: number; b: number; a: number }, factor: number)
  : { r: number; g: number; b: number; a: number }
{
  return {
    r: Math.round(c.r * factor),
    g: Math.round(c.g * factor),
    b: Math.round(c.b * factor),
    a: c.a,
  }
}
