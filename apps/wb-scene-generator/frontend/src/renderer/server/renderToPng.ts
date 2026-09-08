// 💡 Zero-browser server render
//
// Renders voxel layers to a PNG entirely in node (NO browser, NO jsdom) by
// reusing the SAME pure paint code the browser uses. The only difference is the
// canvas2d backend: we swap the framework backend to @napi-rs/canvas (prebuilt
// Skia) so `createSurface(w, h)` returns a real raster canvas with toBuffer().
//
// HARD RULE: @napi-rs/canvas is imported ONLY here (renderer/server). It must
// never reach the browser bundle. Vite only bundles modules reachable from the
// app entry; nothing under renderer/server is imported by browser code.

import { createCanvas } from '@napi-rs/canvas'
import { setCanvas2DBackend, type Surface2D } from '../framework/canvas2d'
import { voxelLayerCellSource } from '../framework/cellSource'
import { SCREEN_CELL_SIZE } from '../framework/geometry/constants'
import { buildIsoSurface, type IsoLayerInput } from '../modes/iso/buildIsoSurface'
import { buildSurfaceForSource } from '../modes/top/buildSurface'
import { buildVoxelMaster, type VoxelLayerInput } from '../modes/topBillboard/buildVoxelMaster'
import type { AliasMeta } from '../framework/asset/matchAssetEntry'
import type { RendererVoxelLayer, DrawMode } from '../types'

let installed = false

/** Swap the framework canvas2d backend to @napi-rs/canvas. Idempotent. */
function installNapiBackend(): void {
  if (installed) return
  setCanvas2DBackend({
    createSurface: (w, h) => createCanvas(w, h) as unknown as never,
    devicePixelRatio: () => 1,
  })
  installed = true
}

export interface RenderOpts {
  mode: 'top' | 'topBillboard' | 'iso'
  drawMode: DrawMode
  /** Optional output size; when omitted the PNG is exactly the scene bbox. */
  width?: number
  height?: number
  /** Background fill behind the scene; defaults to opaque black (matches in-browser canvas bg). */
  background?: string
  /** asset drawMode: merged alias pool (required for textured topBillboard/top renders). */
  aliases?: ReadonlyArray<AliasMeta>
  /** asset drawMode: allow fuzzy name matching; defaults to false. */
  fuzzy?: boolean
}

// Renders the voxel layers to a PNG using the SAME paint code, on @napi-rs/canvas. NO browser.
export async function renderToPng(
  layers: RendererVoxelLayer[],
  opts: RenderOpts,
): Promise<Buffer> {
  installNapiBackend()

  if (opts.mode === 'iso') return renderIso(layers, opts)
  if (opts.mode === 'top') return renderTop(layers, opts)
  if (opts.mode === 'topBillboard') return renderTopBillboard(layers, opts)
  throw new Error(`renderToPng: mode '${opts.mode}' not implemented yet`)
}

// ── shared compositor ──────────────────────────────────────────────────────
//
// Paint a pre-baked master canvas (already holding the full scene) onto an
// opaque output canvas of size (sceneW, sceneH) or opts.width/height (centered).
function encodeMaster(
  master: Surface2D | null,
  sceneW: number,
  sceneH: number,
  opts: RenderOpts,
): Buffer {
  const bg = opts.background ?? '#000'
  const outW = Math.max(1, opts.width ?? sceneW)
  const outH = Math.max(1, opts.height ?? sceneH)

  const out = createCanvas(outW, outH)
  const ctx = out.getContext('2d')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, outW, outH)

  if (master) {
    ctx.imageSmoothingEnabled = false
    const dx = Math.round((outW - sceneW) / 2)
    const dy = Math.round((outH - sceneH) / 2)
    ctx.drawImage(master as unknown as never, dx, dy)
  }
  return out.toBuffer('image/png')
}

// ── iso path ─────────────────────────────────────────────────────────────
//
// Replicates modes/iso/index.tsx's headless assembly: each visible voxel layer
// becomes a CellSource, fed as an IsoLayerInput into buildIsoSurface (same
// collect → sort → paint pipeline the browser runs). The returned master canvas
// already holds the fully painted scene; we composite it onto an opaque output
// canvas (bbox-sized, or opts.width/height with the scene centered) and encode.

function renderIso(layers: RendererVoxelLayer[], opts: RenderOpts): Buffer {
  const inputs: IsoLayerInput[] = []
  layers.forEach((layer, idx) => {
    if (!layer.visible) return
    inputs.push({
      source: voxelLayerCellSource(layer),
      layerIdx: idx,
      isSelected: false,
      isEditorSelected: false,
    })
  })

  const master = buildIsoSurface(inputs, { drawMode: opts.drawMode })
  return encodeMaster(
    master?.canvas ?? null,
    master ? master.bbox.pxW : 1,
    master ? master.bbox.pxH : 1,
    opts,
  )
}

// ── top path ─────────────────────────────────────────────────────────────
//
// Replicates modes/top/index.tsx's headless assembly: each visible voxel layer
// becomes a CellSource → buildSurfaceForSource (same color/wire/asset code the
// browser runs). The browser composeFrame is DPR / parent-rect / getComputedStyle
// coupled, so we composite directly instead: we lay every layer surface onto a
// single tight master canvas at its world offset (worldOffsetX/Y * SCREEN_CELL_SIZE),
// matching compose.ts's worldAlign branch. asset with no server resolver degrades
// to color inside buildSurfaceForSource; wire/color need no images.

function renderTop(layers: RendererVoxelLayer[], opts: RenderOpts): Buffer {
  const cellSize = SCREEN_CELL_SIZE

  interface Placed { surface: Surface2D; cols: number; rows: number; ox: number; oy: number; updatedAt: number }
  const placed: Placed[] = []
  layers.forEach((layer, idx) => {
    if (!layer.visible) return
    const source = voxelLayerCellSource(layer)
    const surface = buildSurfaceForSource(source, {
      drawMode: opts.drawMode,
      layerIdx: idx,
      selectedSubValue: null,
      isSelected: false,
      isEditorSelected: false,
      assetName: layer.assetName,
      assetAlias: layer.assetAlias,
      assetType: layer.assetType,
      aliases: opts.aliases,
      fuzzy: opts.fuzzy,
    })
    if (!surface) return
    placed.push({
      surface,
      cols: source.cols,
      rows: source.rows,
      ox: source.worldOffsetX,
      oy: source.worldOffsetY,
      updatedAt: layer.updatedAt,
    })
  })

  if (placed.length === 0) return encodeMaster(null, 1, 1, opts)

  // Tight scene bbox in world cells (offsets may be negative).
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of placed) {
    if (p.ox < minX) minX = p.ox
    if (p.oy < minY) minY = p.oy
    if (p.ox + p.cols > maxX) maxX = p.ox + p.cols
    if (p.oy + p.rows > maxY) maxY = p.oy + p.rows
  }
  const sceneW = Math.max(1, (maxX - minX) * cellSize)
  const sceneH = Math.max(1, (maxY - minY) * cellSize)

  const master = createCanvas(sceneW, sceneH)
  const ctx = master.getContext('2d')
  ctx.imageSmoothingEnabled = false
  // z-order: updatedAt ASC (later layers paint over earlier), matching index.tsx.
  placed.sort((a, b) => a.updatedAt - b.updatedAt)
  for (const p of placed) {
    const dx = (p.ox - minX) * cellSize
    const dy = (p.oy - minY) * cellSize
    ctx.drawImage(p.surface as unknown as never, dx, dy, p.cols * cellSize, p.rows * cellSize)
  }

  return encodeMaster(master as unknown as Surface2D, sceneW, sceneH, opts)
}

// ── topBillboard path ──────────────────────────────────────────────────────
//
// Replicates modes/topBillboard/index.tsx's assembly: all visible voxel layers
// feed buildVoxelMaster (collect → cull → painter sort → bake) which returns a
// single pre-baked master + bbox, exactly like iso. asset path: no alias pool is
// passed (and no server image resolver in this call), so build degrades to color.

function renderTopBillboard(layers: RendererVoxelLayer[], opts: RenderOpts): Buffer {
  const cellSize = SCREEN_CELL_SIZE
  const inputs: VoxelLayerInput[] = []
  layers.forEach((layer, idx) => {
    if (!layer.visible) return
    inputs.push({
      source: voxelLayerCellSource(layer),
      layerIdx: idx,
      isSelected: false,
      isEditorSelected: false,
      assetName: layer.assetName,
      assetAlias: layer.assetAlias,
      assetType: layer.assetType,
      nodePath: layer.nodePath,
    })
  })

  const master = buildVoxelMaster(inputs, {
    drawMode: opts.drawMode,
    aliases: opts.aliases,
    fuzzy: opts.fuzzy,
  })
  const sceneW = master ? Math.max(1, master.bbox.cols * cellSize) : 1
  const sceneH = master ? Math.max(1, master.bbox.rows * cellSize) : 1
  return encodeMaster(master?.canvas ?? null, sceneW, sceneH, opts)
}
