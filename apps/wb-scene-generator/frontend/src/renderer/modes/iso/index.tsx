// 💡 mode-iso:2D 等角投影(2:1 dimetric pixel art 风)
//
// Voxel 层 = 整组烤进单张 master OffscreenCanvas(详见 buildIsoSurface);
// compose 阶段 drawImage 一次完事,viewport pan/zoom 在 compose 时套 transform。
//
// 本期只实现 wire + color drawMode(asset 留给后续)。Grid layer 在 iso 视角下
// 没有自然位置(等角是 3D voxel 的 2D 投影),本插件忽略 grid layers。

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import {
  useBakedLayer, useBakedLayerKeys, useVoxelLayer, useVoxelLayerKeys,
} from '../../framework/useLayer'
import { useLayerSurface } from '../../framework/useLayerSurface'
import { useViewport2D } from '../../framework/useViewport'
import { useRenderStore } from '../../store'
import { voxelLayerCellSource, type CellSource } from '../../framework/cellSource'
import { drawIsoGuides2d } from '../../framework/guides2d'
import { ISO_CELL_H, ISO_CELL_W } from '../../framework/geometry/iso'
import { mergeRenderableVoxelLayerKeys } from '../../framework/layerKeys'
import { registerRenderPlugin, type PluginHandle } from '../../framework/plugin'
import {
  buildIsoSurface, makeIsoSurfaceCacheKey,
  type IsoLayerInput, type IsoMaster,
} from './buildIsoSurface'
import './ModeIso.css'

interface VoxelLayerEntry {
  source: CellSource
  layer: { nodeId: string; updatedAt: number; visible: boolean }
  layerIdx: number
}

const ModeIsoPlugin = forwardRef<PluginHandle, object>(function ModeIsoPlugin(_, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawMode = useRenderStore(s => s.drawMode)
  const showGrid = useRenderStore(s => s.viewGuides.iso)
  const viewport = useViewport2D()

  // voxel 层数据表(整组送进 buildIsoSurface)
  const voxelLayersRef = useRef<Map<string, VoxelLayerEntry>>(new Map())
  const [, forceCompose] = useState(0)
  const tickRef = useRef(0)
  const bumpTick = useCallback(() => {
    tickRef.current++
    forceCompose(t => t + 1)
  }, [])

  const onVoxelLayer = useCallback((key: string, entry: VoxelLayerEntry | null) => {
    if (entry) voxelLayersRef.current.set(key, entry)
    else voxelLayersRef.current.delete(key)
    bumpTick()
  }, [bumpTick])

  const voxelKeys = useVoxelLayerKeys()
  const bakedKeys = useBakedLayerKeys()
  const renderableVoxelKeys = useMemo(
    () => mergeRenderableVoxelLayerKeys(voxelKeys, bakedKeys),
    [voxelKeys, bakedKeys],
  )

  // master inputs(顺序按 layerIdx 稳定)
  const inputs = useMemo<IsoLayerInput[]>(() => {
    const arr: IsoLayerInput[] = []
    for (const key of renderableVoxelKeys) {
      const entry = voxelLayersRef.current.get(key)
      if (!entry || !entry.layer.visible) continue
      arr.push({
        source: entry.source,
        layerIdx: entry.layerIdx,
        isSelected: false,
        // Editor selection deferred (would rebuild iso master on every click).
        isEditorSelected: false,
      })
    }
    return arr
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderableVoxelKeys, tickRef.current])

  const cacheKey = useMemo(
    () => makeIsoSurfaceCacheKey(inputs, drawMode),
    [inputs, drawMode],
  )
  const master = useLayerSurface<IsoMaster | null>(
    inputs.length === 0 ? undefined : cacheKey,
    () => buildIsoSurface(inputs, { drawMode }),
  )

  // compose
  const compose = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    composeIsoFrame(canvas, master, viewport, showGrid)
  }, [master, viewport, showGrid])

  useEffect(() => { compose() }, [compose])

  // ResizeObserver 观察父容器(jsdom 等环境可能无此 API,缺失则跳过)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    if (!parent) return
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => compose())
    ro.observe(parent)
    return () => ro.disconnect()
  }, [compose])

  // ── §7.3 反向接口 ────────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    getFrameCanvas: () => canvasRef.current,
    renderFrame: () => compose(),
    // §7.2 screenToCell / cellToScreen:iso 视角下"屏幕点 → 哪个 voxel"涉及深度
    // 歧义(同屏幕点对应多个 z),本期不实现,留 null。后续若 host 真有 iso 鼠标
    // 选取需求再加(典型做法:painter sort 反向扫,首个命中的 voxel)。
  }), [compose])

  return (
    <>
      <canvas ref={canvasRef} className="mode-iso-canvas" />
      {renderableVoxelKeys.map((key, idx) => (
        <VoxelLayerSubscriber
          key={key}
          layerKey={key}
          layerIdx={idx}
          onLayerUpdate={onVoxelLayer}
        />
      ))}
    </>
  )
})
ModeIsoPlugin.displayName = 'ModeIsoPlugin'

// ── compose ────────────────────────────────────────────────────────────

/** 跟 mode-top/compose.ts 同款:读 CSS background 当 canvas bg fill */
function readCanvasBg(el: HTMLElement): string {
  const cs = window.getComputedStyle(el)
  const bg = cs.backgroundColor
  if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg
  return '#000'
}

function composeIsoFrame(
  canvas: HTMLCanvasElement,
  master: IsoMaster | null,
  viewport: { offsetX: number; offsetY: number; scale: number },
  showGrid: boolean,
): void {
  // jsdom (no `canvas` pkg) throws on getContext rather than returning null;
  // treat any failure as "no 2D context" so the plugin still mounts cleanly.
  let ctx: CanvasRenderingContext2D | null = null
  try { ctx = canvas.getContext('2d') } catch { ctx = null }
  if (!ctx) return

  const dpr = window.devicePixelRatio || 1
  const sizeSource = canvas.parentElement ?? canvas
  const rect = sizeSource.getBoundingClientRect()
  const cssW = Math.round(rect.width)
  const cssH = Math.round(rect.height)
  if (cssW <= 0 || cssH <= 0) return

  const wantW = Math.round(cssW * dpr)
  const wantH = Math.round(cssH * dpr)
  if (canvas.width !== wantW || canvas.height !== wantH) {
    canvas.width = wantW
    canvas.height = wantH
    canvas.style.width = cssW + 'px'
    canvas.style.height = cssH + 'px'
  }

  // bg
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = readCanvasBg(canvas)
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  if (!master && !showGrid) return

  ctx.scale(dpr, dpr)

  // viewport transform(中心点 + pan + zoom)
  const cx = Math.round(cssW / 2)
  const cy = Math.round(cssH / 2)
  ctx.translate(cx + Math.round(viewport.offsetX), cy + Math.round(viewport.offsetY))
  ctx.scale(viewport.scale, viewport.scale)

  ctx.imageSmoothingEnabled = false

  if (master) {
    // master 居中:把 master canvas 中心对到 (0, 0) 视口中心
    const { canvas: vmCanvas, bbox } = master
    // master 内部 (worldOffsetX, worldOffsetY) 对应世界 (0, 0)。让世界 (0, 0) 落在视口中心
    // 即 master 画在 (-worldOffsetX, -worldOffsetY) 位置。
    ctx.drawImage(vmCanvas as unknown as CanvasImageSource, -bbox.worldOffsetX, -bbox.worldOffsetY, bbox.pxW, bbox.pxH)
  }
  if (showGrid) {
    drawIsoGuides2d(ctx, {
      cssW,
      cssH,
      offsetX: Math.round(viewport.offsetX),
      offsetY: Math.round(viewport.offsetY),
      scale: viewport.scale,
      cellW: ISO_CELL_W,
      cellH: ISO_CELL_H,
    })
  }
}

// ── voxel 层 subscriber ────────────────────────────────────────────────

interface VoxelLayerSubscriberProps {
  layerKey: string
  layerIdx: number
  onLayerUpdate(key: string, entry: VoxelLayerEntry | null): void
}

function VoxelLayerSubscriber({ layerKey, layerIdx, onLayerUpdate }: VoxelLayerSubscriberProps) {
  const voxelLayer = useVoxelLayer(layerKey)
  const bakedLayer = useBakedLayer(layerKey)
  const layer = layerKey.startsWith('baked:') ? bakedLayer : voxelLayer
  const source: CellSource | null = useMemo(
    () => layer ? voxelLayerCellSource(layer) : null,
    [layer],
  )
  useEffect(() => {
    if (!source || !layer) {
      onLayerUpdate(layerKey, null)
      return
    }
    onLayerUpdate(layerKey, {
      source,
      layer: { nodeId: layer.nodeId, updatedAt: layer.updatedAt, visible: layer.visible },
      layerIdx,
    })
  }, [layerKey, source, layer, layerIdx, onLayerUpdate])
  useEffect(() => () => onLayerUpdate(layerKey, null), [layerKey, onLayerUpdate])
  return null
}

// ── 自注册 ────────────────────────────────────────────────────────────

registerRenderPlugin({
  name: 'iso',
  modes: ['iso'],
  Component: ModeIsoPlugin,
})

export default ModeIsoPlugin
