// 💡 mode-topBillboard 的 voxel 主缓冲区构造 —— 顶层 orchestrator
//
// 把所有 voxel layers 的 cells 经过 pipeline 烤成一张 OffscreenCanvas:
//
//   ① collect      → collect.ts collectCells()    扁平化 + 建邻域 / xy 投影索引
//   ② cull         → collect.ts cullOccluded()    color/wire 模式占位剔除
//   ③ painter sort → collect.ts painterSort()     (y, z, layerIdx) ASC
//   ④ bind         → bindings.ts buildLayerAssetBindings()  asset alias 匹配 + region 解析
//   ⑤ bake         → paintCell.ts paintCell()      per-cell drawMode 路由 + drawSprite
//
// ── master canvas 像素密度 ──────────────────────────────────────────────
//
// master canvas 内部用 maxPpu(已绑定 rule 的 ppu 取最大,无 rule 时 = SCREEN_CELL_SIZE)
// 作为每 cell 像素数,而不是直接用 SCREEN_CELL_SIZE。原因:源 sprite ppu(16) 高于
// SCREEN_CELL_SIZE(8)时,master 用更高像素密度避免在 master 阶段就 nearest 下采样
// 丢一半细节;compose 那侧 dst 永远用 SCREEN_CELL_SIZE logical。
//
// 公共类型(VoxelLayerInput / BuildVoxelMasterOpts / VoxelMaster)从 ./types re-export。

import {
  computeVoxelMasterBbox,
  type VoxelCellLite,
  type VoxelVisualBoundsLite,
} from '../../../framework/geometry/topBillboard'
import { createSurface } from '../../../framework/canvas2d'
import { SCREEN_CELL_SIZE } from '../../../framework/geometry/constants'
import { matchAssetEntry, type AliasMeta } from '../../../framework/asset/matchAssetEntry'
import { getRegisteredAssetUrl, getLoadTick, getOrLoadImage } from '../../../framework/asset/imageCache'
import { getRuleLoadTick } from '../../../framework/asset/ruleCache'
import type { DrawMode } from '../../../types'
import { collectCells, cullOccluded, painterSort, type PainterSortOverride } from './collect'
import { buildLayerAssetBindings } from './bindings'
import { buildCellBuckets } from './incrementalBake'
import { objectSpriteGridRect, objectFootprintAnchorPoint, objectSpritePainterSortY, paintCell } from './paintCell'
import type {
  VoxelLayerInput, BuildVoxelMasterOpts, VoxelMaster, LayerAssetBinding, CollectedCell,
  IncrementalBakeState,
} from './types'

export type { VoxelLayerInput, BuildVoxelMasterOpts, VoxelMaster, ResolvedDraw, ResolvedDrawSink, ResolvedFace } from './types'
export { appendCellsToVoxelMaster, type AppendCell, buildCellBuckets } from './incrementalBake'

export function buildVoxelMaster(
  inputs: ReadonlyArray<VoxelLayerInput>,
  opts: BuildVoxelMasterOpts,
): VoxelMaster | null {
  // ① collect:扁平化 + 邻域 / xy 投影索引
  const collected = collectCells(inputs)
  if (collected.allCells.length === 0) return null

  // ② cull:asset 模式跳过(painter source-over 自然处理),其它模式按 (above,top) 占位剔除
  const visible = cullOccluded(collected.allCells, collected.hasCell, opts.drawMode)
  if (visible.length === 0) return null

  // ④ bindings(仅 asset drawMode):per-layer 一次性预解析。先于 sort / canvas 创建,
  // 因为 object 需要 binding + image 尺寸生成投影 sort key 和视觉 bounds。
  const assetByLayer = (opts.drawMode === 'asset' && opts.aliases && opts.aliases.length > 0)
    ? buildLayerAssetBindings(
        inputs, opts.aliases, opts.fuzzy ?? false,
        collected.xyByParentPath, collected.xyByLayerIdx, collected.parentPathByLayerIdx,
      )
    : null

  // master cell 像素密度:取已绑定 rule 的 ppu 最大值;asset 模式无 rule / 其它模式
  // 按 SCREEN_CELL_SIZE。compose 那侧 dst 永远用 SCREEN_CELL_SIZE logical。
  const cellSize = pickMasterCellSize(assetByLayer)
  const objectGroups = collectObjectInstanceGroups(visible, assetByLayer)
  const objectColumnCells = new Set<CollectedCell>()
  const objectAnchorPointByLayer = new Map<number, { x: number; y: number }>()
  for (const group of objectGroups) {
    objectAnchorPointByLayer.set(group.anchor.layerIdx, objectFootprintAnchorPoint(group.cells))
    for (const cell of group.cells) {
      if (cell !== group.anchor) objectColumnCells.add(cell)
    }
  }
  const objectVisuals = collectObjectVisuals(visible, assetByLayer, objectGroups)

  // ③ painter sort:tiles/autotiles keep raw y/z ordering; non-tile objects use
  // the sprite's front-most screen row so tiles south of the footprint (world y
  // > footprintDepthY, z=0) do not paint over the object facade after it.
  painterSort(visible, objectVisuals.sortOverrides)
  const lite: VoxelCellLite[] = visible.map(c => ({ x: c.x, y: c.y, z: c.z }))
  const bbox = computeVoxelMasterBbox(lite, objectVisuals.bounds)
  const W = Math.max(1, Math.ceil(bbox.cols * cellSize))
  const H = Math.max(1, Math.ceil(bbox.rows * cellSize))
  const canvas = createSurface(W, H)
  // jsdom (no `canvas` pkg) throws on getContext rather than returning null;
  // treat any failure as "no 2D context" so the build is a clean no-op.
  let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null
  try {
    ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  } catch {
    ctx = null
  }
  if (!ctx) return null

  // ⑤ bake
  ctx.imageSmoothingEnabled = false
  // ADDITIVE resolve-capture: when opts.onResolve is set, each drawn sprite is
  // reported in draw order (the bake loop order IS painter order). Default path
  // (no sink) is unchanged — `capture` stays undefined and paintCell short-circuits.
  let resolveSeq = 0
  const capture = opts.onResolve
    ? { sink: opts.onResolve, nextSeq: () => resolveSeq++ }
    : undefined
  for (const c of visible) {
    if (objectColumnCells.has(c)) continue
    const binding = assetByLayer?.get(c.layerIdx)
    const objectAnchor = binding && !binding.match.tileType
      ? objectAnchorPointByLayer.get(c.layerIdx)
      : undefined
    paintCell(
      ctx, c, bbox, cellSize, opts.drawMode, assetByLayer, collected.coordsByLayerIdx, capture,
      objectAnchor,
    )
  }

  // Attach an incremental snapshot so subsequent additive paints can dirty-region
  // re-bake in O(k) instead of a full rebuild. Previously this was DROPPED whenever
  // the scene contained ANY non-tile object sprite anywhere (`hasObjectSprites`),
  // which meant a composite/multi-layer asset scene with a single object elsewhere
  // forced EVERY tile paint to full-rebuild (~960ms). We now keep the snapshot and
  // carry the object metadata (column cells to skip + per-cell visual bounds) so
  // the append path can correctly clear+repaint any object whose oversized sprite
  // overlaps a newly painted tile. Painting a NEW object instance is still handled
  // by a full rebuild (the append path bails on object-instance new cells).
  const incremental: IncrementalBakeState | undefined = {
    cells: visible,
    cellSize,
    drawMode: opts.drawMode,
    assetByLayer,
    coordsByLayerIdx: collected.coordsByLayerIdx,
    objectColumnCells: objectColumnCells.size > 0 ? objectColumnCells : undefined,
    objectBoundsByCell: objectVisuals.boundsByCell.size > 0 ? objectVisuals.boundsByCell : undefined,
    objectAnchorPointByLayer: objectAnchorPointByLayer.size > 0 ? objectAnchorPointByLayer : undefined,
    cellBuckets: buildCellBuckets(visible),
  }
  return { canvas, bbox, incremental }
}

interface ObjectInstanceGroup {
  instanceId: string
  anchor: CollectedCell
  cells: CollectedCell[]
  footprintDepthY: number
  topZ: number
}

function collectObjectInstanceGroups(
  visible: ReadonlyArray<CollectedCell>,
  assetByLayer: Map<number, LayerAssetBinding | null> | null,
): ObjectInstanceGroup[] {
  if (!assetByLayer) return []
  // One renderer layer = one object instance (scene voxel-mass or painted column).
  const byLayer = new Map<number, CollectedCell[]>()
  for (const cell of visible) {
    const binding = assetByLayer.get(cell.layerIdx)
    if (!binding || binding.match.tileType) continue
    const bucket = byLayer.get(cell.layerIdx)
    if (bucket) bucket.push(cell)
    else byLayer.set(cell.layerIdx, [cell])
  }
  const out: ObjectInstanceGroup[] = []
  for (const [layerIdx, cells] of byLayer) {
    if (cells.length === 0) continue
    const anchor = chooseObjectAnchor(cells)
    out.push({
      instanceId: `layer:${layerIdx}`,
      anchor,
      cells,
      footprintDepthY: Math.max(...cells.map((c) => c.y)),
      topZ: Math.max(...cells.map((c) => c.z)),
    })
  }
  return out
}

function chooseObjectAnchor(cells: CollectedCell[]): CollectedCell {
  const explicit = cells.find((cell) => cell.state?.role === 'anchor')
  if (explicit) return explicit
  return chooseLayerFootprintAnchor(cells)
}

/** Bottom-face front row of the layer footprint (camera-facing foot contact cell). */
function chooseLayerFootprintAnchor(cells: CollectedCell[]): CollectedCell {
  const minZ = Math.min(...cells.map((c) => c.z))
  const bottom = cells.filter((c) => c.z === minZ)
  const maxY = Math.max(...bottom.map((c) => c.y))
  const front = bottom.filter((c) => c.y === maxY)
  const minX = Math.min(...front.map((c) => c.x))
  const maxX = Math.max(...front.map((c) => c.x))
  const targetX = (minX + maxX + 1) / 2
  return front.slice().sort((a, b) => {
    const da = Math.abs(a.x + 0.5 - targetX)
    const db = Math.abs(b.x + 0.5 - targetX)
    if (da !== db) return da - db
    return a.x - b.x
  })[0]!
}

/**
 * 取已绑定 rule 的最大 ppu;无 rule(color/wire 模式 / asset 未匹配)= SCREEN_CELL_SIZE。
 * 多 rule 不同 ppu 时取 max:小 ppu 的 sprite 在 master 阶段被 nearest 上采样到大
 * ppu(无损,只是分辨率冗余);用 min 反而把大 ppu 的细节强行下采样丢。
 */
function pickMasterCellSize(
  assetByLayer: Map<number, LayerAssetBinding | null> | null,
): number {
  if (!assetByLayer) return SCREEN_CELL_SIZE
  let maxPpu = 0
  for (const binding of assetByLayer.values()) {
    if (binding?.rule && binding.rule.ppu > maxPpu) maxPpu = binding.rule.ppu
  }
  return maxPpu > 0 ? maxPpu : SCREEN_CELL_SIZE
}

function collectObjectVisuals(
  visible: ReadonlyArray<CollectedCell>,
  assetByLayer: Map<number, LayerAssetBinding | null> | null,
  objectGroups: ReadonlyArray<ObjectInstanceGroup>,
): {
  bounds: VoxelVisualBoundsLite[]
  sortOverrides: Map<CollectedCell, PainterSortOverride>
  /** Visual bounds keyed by the cell that DRAWS the sprite (object anchor, or a
   *  free non-tile cell). Used by the incremental append path to know an object's
   *  true painted extent (its 1-cell footprint understates it). */
  boundsByCell: Map<CollectedCell, VoxelVisualBoundsLite>
} {
  const bounds: VoxelVisualBoundsLite[] = []
  const sortOverrides = new Map<CollectedCell, PainterSortOverride>()
  const boundsByCell = new Map<CollectedCell, VoxelVisualBoundsLite>()
  if (!assetByLayer) return { bounds, sortOverrides, boundsByCell }

  const groupedCells = new Set<CollectedCell>()
  for (const group of objectGroups) {
    const binding = assetByLayer.get(group.anchor.layerIdx)
    if (!binding || binding.match.tileType) continue
    const img = getOrLoadImage(binding.imgUrl)
    const anchorPoint = objectFootprintAnchorPoint(group.cells)
    const rect = img
      ? objectSpriteGridRect(group.anchor, img, binding.match.anchor, anchorPoint)
      : null
    const painterY = rect
      ? objectSpritePainterSortY(rect, group.footprintDepthY)
      : group.footprintDepthY
    for (const cell of group.cells) {
      groupedCells.add(cell)
      sortOverrides.set(cell, { y: painterY, z: group.topZ })
    }
    if (!img || !rect) continue
    const b: VoxelVisualBoundsLite = {
      minX: rect.x,
      minY: rect.y,
      maxX: rect.x + rect.w,
      maxY: rect.y + rect.h,
    }
    bounds.push(b)
    // The anchor is the cell that actually draws the group's sprite.
    boundsByCell.set(group.anchor, b)
  }

  return { bounds, sortOverrides, boundsByCell }
}

// ── cacheKey ───────────────────────────────────────────────────────────

/**
 * useLayerSurface 的 version key。
 * 任意 layer 数据 / drawMode 变化 → 重 build。
 *
 * asset 模式额外把 aliasesKey + fuzzy + 已匹配 alias 的 url@tick 列表写进 key,
 * 用 imageCache 的 per-URL load tick 实现"图 X 加载完只重 build 用到 X 的 master"
 * 的细粒度失效。其它 master cacheKey 不含 X 的 tick → 不重 build。
 */
export function makeVoxelMasterCacheKey(
  inputs: ReadonlyArray<VoxelLayerInput>,
  drawMode: DrawMode,
  assetCtx?: {
    aliases: ReadonlyArray<AliasMeta>
    fuzzy: boolean
    /** 资产库标识,资产库切换时 key 自然变 */
    aliasesKey: string
  },
): string {
  if (inputs.length === 0) return `empty:${drawMode}`
  const structural = makeStructuralLayerKey(inputs, drawMode)
  const assetTokens = makeAssetTokenKey(inputs, drawMode, assetCtx)
  return assetTokens ? `${structural}${assetTokens}` : structural
}

/**
 * Cheap (O(layers), regex-free) portion of the master cache key: layer set,
 * order, per-layer content version, and selection flags. Does NOT touch the
 * asset library, so it's safe to recompute on every render.
 */
export function makeStructuralLayerKey(
  inputs: ReadonlyArray<VoxelLayerInput>,
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

/**
 * Expensive (O(aliases × regex) per layer) portion of the cache key: resolves
 * each layer's asset binding against the alias library and folds in image/rule
 * load ticks. Returns '' for non-asset modes / empty pools.
 *
 * This is the ~156ms-per-paint hotspot when the alias pool is large, so callers
 * that re-key on every render (e.g. the billboard's structuralKey memo) should
 * memoize the result on stable asset-binding inputs instead of recomputing it on
 * plain cell appends — its value only changes on asset rebind / mode switch /
 * alias-pool change / a load-tick pulse, never on an additive paint.
 */
export function makeAssetTokenKey(
  inputs: ReadonlyArray<VoxelLayerInput>,
  drawMode: DrawMode,
  assetCtx?: {
    aliases: ReadonlyArray<AliasMeta>
    fuzzy: boolean
    aliasesKey: string
  },
): string {
  if (drawMode !== 'asset' || !assetCtx || assetCtx.aliases.length === 0) return ''
  // 把每层 match 的 primary URL + tick 拼进 key,加上 rule alias + tick(若命中):
  // 图 X 加载完只重 build 用到 X 的 master;rule Y 加载完只重 build 用到 Y 的 master。
  const tokens: string[] = []
  for (const i of inputs) {
    const m = matchAssetEntry(
      { assetName: i.assetName, assetAlias: i.assetAlias, assetType: i.assetType },
      assetCtx.aliases, assetCtx.fuzzy,
    )
    if (!m) continue
    const imgUrl = getRegisteredAssetUrl(m.primary)
    tokens.push(`img:${imgUrl}@${getLoadTick(imgUrl)}`)
    if (m.tileType) {
      tokens.push(`rule:${m.tileType}@${getRuleLoadTick(m.tileType)}`)
    }
  }
  tokens.sort()
  return `::asset:${assetCtx.aliasesKey}:fz=${assetCtx.fuzzy ? 1 : 0}:${tokens.join(';')}`
}
