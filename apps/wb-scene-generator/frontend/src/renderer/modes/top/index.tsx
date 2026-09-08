// 💡 mode-top:正交俯视(orthographic top-down)
//
// 数据流:
//   * useVoxelLayerKeys() —— 浅比较 key 列表;变化才触发 plugin 顶层 rerender
//   * 每个 key 对应一个 <VoxelLayerInstance>:订阅自己那一层(useVoxelLayer),
//     用 useLayerSurface 缓存 OffscreenCanvas,把 surface 写入父持有的 ref Map
//   * 父 plugin 在 useEffect 里读 ref Map + viewport,调 compose 重画主 canvas
//
// 本 slice 只投影 voxel 层(SceneOutput 顶视、忽略 z);legacy 的 GridLayer
// 稠密 2D 路径在 scene-generator 里没有数据源,整段 drop。
//
// viewport 变化 → 只触发 compose effect,不触发 VoxelLayerInstance build
// drawMode 切换 → cacheKey 变 → useLayerSurface rebuild;主 canvas 也重画
// 单层数据更新 → 仅那一层 build,其他层 surface 不变,主 canvas 重画

import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useBakedLayer, useBakedLayerKeys, useGridLayer, useGridLayerKeys, useVoxelLayer, useVoxelLayerKeys } from '../../framework/useLayer'
import { useLayerSurface } from '../../framework/useLayerSurface'
import type { Viewport2D } from '../../framework/useViewport'
import { useRenderStore } from '../../store'
import { gridLayerCellSource, voxelLayerCellSource, type CellSource } from '../../framework/cellSource'
import type { DrawMode } from '../../types'
import { registerRenderPlugin, type PluginHandle } from '../../framework/plugin'
import { SCREEN_CELL_SIZE } from '../../framework/geometry/constants'
import { topMasterOrigin } from '../../framework/geometry/top'
import { subscribeToAssetReadiness } from '../../framework/asset/imageCache'
import { subscribeToRuleReadiness } from '../../framework/asset/ruleCache'
import type { AliasMeta } from '../../framework/asset/matchAssetEntry'
import { mergeRenderableVoxelLayerKeys } from '../../framework/layerKeys'
import { buildMaskOutlinePath, buildSurfaceForSource, makeSurfaceCacheKey } from './buildSurface'
import { composeFrame, type ComposeLayer } from './compose'
import type { Surface2D } from '../../framework/canvas2d'
import './ModeTop.css'

// ── 顶层 Plugin Component ─────────────────────────────────────────────────

interface SurfaceEntry {
  surface: Surface2D
  rows: number
  cols: number
  /** 用于 z-order 排序 */
  updatedAt: number
  nodeId: string
  /** 世界对齐(voxel) */
  worldAlign?: boolean
  /** 世界对齐时 layer-local (0,0) 对应的 world (col, row) */
  worldOffsetX?: number
  worldOffsetY?: number
  /** 非零 mask 的 cell-unit 外轮廓 */
  maskOutlinePath?: Path2D
}

const ModeTopPlugin = forwardRef<PluginHandle, object>(function ModeTopPlugin(_, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawMode = useRenderStore(s => s.drawMode)
  const aliasMetas = useRenderStore(s => s.aliasMetas)
  const selectedEditorNodeIds = useRenderStore(s => s.selectedEditorNodeIds)
  const showGrid = useRenderStore(s => s.viewGuides.top)
  // Viewport (pan/zoom) is intentionally NOT React-subscribed — same fix as
  // mode-topBillboard (see its index.tsx for the full rationale): subscribing
  // re-renders this whole plugin (+ every VoxelLayerInstance/GridLayerInstance
  // child) on every wheel tick, when all that's actually needed is re-blitting
  // the already-built surfaces at a new transform. Tracked in a ref, driven
  // imperatively from a store subscription instead.
  const viewportRef = useRef<Viewport2D>(useRenderStore.getState().viewport2d)

  // 子组件写入的 surface 表,plugin 在 compose effect 里读取。
  // 用 ref + 计数 trigger 模式:子组件 surface 变化时调 onSurfaceUpdate,
  // 触发计数 +1,父 effect 依赖计数重画。这样避免把 Map 当 state(深比较开销)。
  const surfacesRef = useRef<Map<string, SurfaceEntry>>(new Map())
  const composeTickRef = useRef(0)
  const [, forceCompose] = useRefForceUpdate()

  const onSurfaceUpdate = useCallback((
    layerKey: string,
    entry: SurfaceEntry | null,
  ) => {
    if (entry) surfacesRef.current.set(layerKey, entry)
    else surfacesRef.current.delete(layerKey)
    composeTickRef.current++
    forceCompose()
  }, [forceCompose])

  const voxelKeys = useVoxelLayerKeys()
  const bakedKeys = useBakedLayerKeys()
  const renderableVoxelKeys = useMemo(
    () => mergeRenderableVoxelLayerKeys(voxelKeys, bakedKeys),
    [voxelKeys, bakedKeys],
  )
  // Grid previews (any node's grid output). These are projected live
  // as the graph is wired up — even without a scene_output sink — restoring the
  // legacy "watch as you build" preview.
  const gridKeys = useGridLayerKeys()

  // asset drawMode:订阅 image / rule readiness 脉冲 —— 异步资产加载完后 bump
  // assetTick 触发子 VoxelLayerInstance re-render,其 cacheKey 因 url@tick / rule@tick
  // 变化而变,useLayerSurface 只重 build 用到该资产的那一层。非 asset 模式不订阅。
  const [assetTick, setAssetTick] = useState(0)
  useEffect(() => {
    if (drawMode !== 'asset') return
    const bump = () => setAssetTick(t => t + 1)
    const unsubImg = subscribeToAssetReadiness(bump)
    const unsubRule = subscribeToRuleReadiness(bump)
    return () => { unsubImg(); unsubRule() }
  }, [drawMode])

  // 排序:layer.updatedAt 升序(后面覆盖前面),与 legacy mode-2d 视觉一致。
  // editor 选中(success 绿外描边)按 entry.nodeId 命中;voxel + grid 预览层皆参与,
  // 与 legacy「选中预览电池高亮其 grid 预览」一致。compose 的 stroke pass 是 viewport
  // 套层后绘制,故选中态变化只触发 compose,不重 build surface。
  const sortedSurfaces = useMemo(() => {
    const arr: ComposeLayer[] = []
    for (const key of [...renderableVoxelKeys, ...gridKeys]) {
      const entry = surfacesRef.current.get(key)
      if (!entry) continue
      arr.push({
        layerKey: key,
        surface: entry.surface,
        rows: entry.rows,
        cols: entry.cols,
        isSelected: false,
        isEditorSelected: selectedEditorNodeIds.includes(entry.nodeId) || selectedEditorNodeIds.includes(key),
        worldAlign: entry.worldAlign,
        worldOffsetX: entry.worldOffsetX,
        worldOffsetY: entry.worldOffsetY,
        maskOutlinePath: entry.maskOutlinePath,
      })
    }
    arr.sort((a, b) => {
      const ea = surfacesRef.current.get(a.layerKey)?.updatedAt ?? 0
      const eb = surfacesRef.current.get(b.layerKey)?.updatedAt ?? 0
      return ea - eb
    })
    return arr
    // composeTickRef.current 走 useState force trigger,不进 deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderableVoxelKeys, gridKeys, selectedEditorNodeIds, composeTickRef.current])

  // 主 grid bounding box:所有可见 surface 真实占据的 master 坐标极值
  //   * worldAlign 层(voxel):占据 (worldOffsetX..worldOffsetX+cols, worldOffsetY..+rows)
  const { maxRows, maxCols } = useMemo(() => {
    let r = 0, c = 0
    for (const l of sortedSurfaces) {
      const wx = l.worldOffsetX ?? 0
      const wy = l.worldOffsetY ?? 0
      const layerMaxX = wx + l.cols
      const layerMaxY = wy + l.rows
      if (layerMaxX > c) c = layerMaxX
      if (layerMaxY > r) r = layerMaxY
    }
    return { maxRows: r || 1, maxCols: c || 1 }
  }, [sortedSurfaces])

  // ── compose effect ──────────────────────────────────────────
  // viewport read from the ref (NOT the deps array) — see viewportRef above.
  const compose = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    composeFrame({
      canvas,
      layers: sortedSurfaces,
      maxRows,
      maxCols,
      cellSize: SCREEN_CELL_SIZE,
      offsetX: viewportRef.current.offsetX,
      offsetY: viewportRef.current.offsetY,
      scale: viewportRef.current.scale,
      showGrid,
    })
  }, [sortedSurfaces, maxRows, maxCols, showGrid])

  useEffect(() => { compose() }, [compose])

  // Pan/zoom: imperative re-blit, no React re-render. A wheel gesture bumps
  // viewport2d on every tick; subscribing via useViewport2D() would re-render
  // this plugin + every VoxelLayerInstance/GridLayerInstance child on each
  // tick just to re-run the same drawImage. Instead we subscribe to the store
  // directly, update the ref synchronously (so hit-testing is never stale),
  // and coalesce the actual redraw to one per animation frame.
  const composeRef = useRef(compose)
  composeRef.current = compose

  const viewportRafRef = useRef<number | null>(null)
  const scheduleViewportRedraw = useCallback(() => {
    if (viewportRafRef.current !== null) return
    const raf = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number
    viewportRafRef.current = raf(() => {
      viewportRafRef.current = null
      composeRef.current()
    })
  }, [])

  useEffect(() => {
    let prev = useRenderStore.getState().viewport2d
    const unsub = useRenderStore.subscribe((state) => {
      if (state.viewport2d === prev) return
      prev = state.viewport2d
      viewportRef.current = prev
      scheduleViewportRedraw()
    })
    return () => {
      unsub()
      if (viewportRafRef.current !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(viewportRafRef.current)
        viewportRafRef.current = null
      }
    }
  }, [scheduleViewportRedraw])

  // 容器 resize 时重画(jsdom 等环境可能无 ResizeObserver,缺失则跳过)
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

  // §7.2 / §7.3 反向接口需要拿到最新的 master grid 尺寸,但 useImperativeHandle
  // 的 deps 列表敏感会频繁重建 handle。改用 stateRef pattern:每次渲染把最新值
  // 写 ref,handle 闭包同步读 ref。viewport 单独从 viewportRef 读(rAF 节流路径
  // 同步写入,不依赖 React 渲染),避免 pan/zoom 期间这里读到过期值。
  const stateRef = useRef({
    maxRows, maxCols, cellSize: SCREEN_CELL_SIZE,
  })
  stateRef.current = { maxRows, maxCols, cellSize: SCREEN_CELL_SIZE }

  useImperativeHandle(ref, () => ({
    getFrameCanvas: () => canvasRef.current,
    renderFrame: () => compose(),
    screenToCell: (cssX, cssY) => {
      const canvas = canvasRef.current
      if (!canvas) return null
      const viewport = viewportRef.current
      const { maxRows, maxCols, cellSize } = stateRef.current
      const sizeSource = canvas.parentElement ?? canvas
      const rect = sizeSource.getBoundingClientRect()
      const cssW = Math.round(rect.width)
      const cssH = Math.round(rect.height)
      // 逆 viewport 变换:translate(cx + offX) → scale → translate(-cx)
      const cx = Math.round(cssW / 2)
      const cy = Math.round(cssH / 2)
      const worldX = (cssX - cx - viewport.offsetX) / viewport.scale + cx
      const worldY = (cssY - cy - viewport.offsetY) / viewport.scale + cy
      const { originX, originY } = topMasterOrigin(cssW, cssH, maxCols, maxRows, cellSize)
      const col = Math.floor((worldX - originX) / cellSize)
      const row = Math.floor((worldY - originY) / cellSize)
      if (col < 0 || col >= maxCols || row < 0 || row >= maxRows) return null
      return { col, row }
    },
    cellToScreen: (col, row) => {
      const canvas = canvasRef.current
      if (!canvas) return null
      const viewport = viewportRef.current
      const { maxRows, maxCols, cellSize } = stateRef.current
      const sizeSource = canvas.parentElement ?? canvas
      const rect = sizeSource.getBoundingClientRect()
      const cssW = Math.round(rect.width)
      const cssH = Math.round(rect.height)
      const { originX, originY } = topMasterOrigin(cssW, cssH, maxCols, maxRows, cellSize)
      const worldX = originX + (col + 0.5) * cellSize
      const worldY = originY + (row + 0.5) * cellSize
      const cx = Math.round(cssW / 2)
      const cy = Math.round(cssH / 2)
      const x = (worldX - cx) * viewport.scale + cx + viewport.offsetX
      const y = (worldY - cy) * viewport.scale + cy + viewport.offsetY
      return { x, y }
    },
  }), [compose])

  return (
    <>
      <canvas ref={canvasRef} className="mode-top-canvas" />
      {renderableVoxelKeys.map((key, idx) => (
        <VoxelLayerInstance
          key={key}
          layerKey={key}
          drawMode={drawMode}
          layerIdx={idx}
          aliasMetas={aliasMetas}
          assetTick={assetTick}
          onSurfaceUpdate={onSurfaceUpdate}
        />
      ))}
      {gridKeys.map((key, idx) => (
        <GridLayerInstance
          key={key}
          layerKey={key}
          drawMode={drawMode}
          layerIdx={renderableVoxelKeys.length + idx}
          onSurfaceUpdate={onSurfaceUpdate}
        />
      ))}
    </>
  )
})
ModeTopPlugin.displayName = 'ModeTopPlugin'

// ── voxel 层实例(顶视投影,忽略 z) ───────────────────────────────────────

interface VoxelLayerInstanceProps {
  layerKey: string
  drawMode: DrawMode
  layerIdx: number
  /** asset drawMode 顶面 autotile 用;非 asset 模式不参与 build */
  aliasMetas: AliasMeta[]
  /** readiness 脉冲计数;变化触发本组件 re-render 重算 cacheKey */
  assetTick: number
  onSurfaceUpdate(key: string, entry: SurfaceEntry | null): void
}

function VoxelLayerInstance({
  layerKey, drawMode, layerIdx, aliasMetas, assetTick, onSurfaceUpdate,
}: VoxelLayerInstanceProps) {
  const voxelLayer = useVoxelLayer(layerKey)
  const bakedLayer = useBakedLayer(layerKey)
  const layer = layerKey.startsWith('baked:') ? bakedLayer : voxelLayer

  const source: CellSource | null = useMemo(
    () => layer ? voxelLayerCellSource(layer) : null,
    [layer],
  )

  // asset cacheKey 上下文:仅 asset 模式带 alias 池 + 本层 asset 属性
  const assetCtx = drawMode === 'asset' && layer
    ? { aliases: aliasMetas, assetName: layer.assetName, assetAlias: layer.assetAlias, assetType: layer.assetType }
    : undefined

  // voxel 层不存在 sub-value 概念,selectedSubValue 永为 null;
  // 选中态本 slice 恒 false(选中高亮 deferred)。assetTick 只用于触发本组件
  // re-render(下方 void 引用),真正的失效粒度由 cacheKey 内 url@tick / rule@tick
  // 决定:readiness 脉冲后 tick 变 → 只有命中该资产的层 cacheKey 变 → 仅它 rebuild。
  void assetTick
  const cacheKey = source
    ? makeSurfaceCacheKey(source, drawMode, null, false, false, assetCtx)
    : undefined
  const surface = useLayerSurface<Surface2D | null>(
    cacheKey,
    () => {
      if (!source) return null
      return buildSurfaceForSource(source, {
        drawMode, layerIdx, selectedSubValue: null,
        isSelected: false, isEditorSelected: false,
        assetName: layer?.assetName,
        assetType: layer?.assetType,
        aliases: drawMode === 'asset' ? aliasMetas : undefined,
      })
    },
  )

  useEffect(() => {
    if (!source || !surface || !layer?.visible) {
      onSurfaceUpdate(layerKey, null)
      return
    }
    onSurfaceUpdate(layerKey, {
      surface,
      rows: source.rows,
      cols: source.cols,
      updatedAt: layer.updatedAt,
      nodeId: layer.nodeId,
      // voxel 层 cells 用世界坐标(可能起点非 0),走世界对齐;layer 顶左点
      // 落在 master(worldOffsetX, worldOffsetY)= cells bbox 的 (minX, minY)
      worldAlign: true,
      worldOffsetX: source.worldOffsetX,
      worldOffsetY: source.worldOffsetY,
      maskOutlinePath: buildMaskOutlinePath(source),
    })
  }, [layerKey, source, surface, layer?.visible, layer?.updatedAt, onSurfaceUpdate])

  useEffect(() => () => onSurfaceUpdate(layerKey, null), [layerKey, onSurfaceUpdate])

  return null
}

// ── grid 预览层实例(稠密 2D;来自任意节点 grid 输出) ───────────────
//
// 与 VoxelLayerInstance 同构,只是 source 用 gridLayerCellSource。grid 不携带
// asset_name,asset drawMode 在 buildSurfaceForSource 内优雅降级回 color。
// worldOffset 恒 (0,0)(dense 从 0 起),走世界对齐使其与 voxel 层共享 master 坐标。

interface GridLayerInstanceProps {
  layerKey: string
  drawMode: DrawMode
  layerIdx: number
  onSurfaceUpdate(key: string, entry: SurfaceEntry | null): void
}

function GridLayerInstance({ layerKey, drawMode, layerIdx, onSurfaceUpdate }: GridLayerInstanceProps) {
  const layer = useGridLayer(layerKey)

  const source: CellSource | null = useMemo(
    () => (layer ? gridLayerCellSource(layer) : null),
    [layer],
  )

  const cacheKey = source
    ? makeSurfaceCacheKey(source, drawMode, null, false, false, undefined)
    : undefined
  const surface = useLayerSurface<Surface2D | null>(
    cacheKey,
    () => {
      if (!source) return null
      return buildSurfaceForSource(source, {
        drawMode, layerIdx, selectedSubValue: null,
        isSelected: false, isEditorSelected: false,
      })
    },
  )

  useEffect(() => {
    if (!source || !surface || !layer?.visible) {
      onSurfaceUpdate(layerKey, null)
      return
    }
    onSurfaceUpdate(layerKey, {
      surface,
      rows: source.rows,
      cols: source.cols,
      updatedAt: layer.updatedAt,
      nodeId: layer.nodeId,
      worldAlign: true,
      worldOffsetX: source.worldOffsetX,
      worldOffsetY: source.worldOffsetY,
      maskOutlinePath: buildMaskOutlinePath(source),
    })
  }, [layerKey, source, surface, layer?.visible, layer?.updatedAt, onSurfaceUpdate])

  useEffect(() => () => onSurfaceUpdate(layerKey, null), [layerKey, onSurfaceUpdate])

  return null
}

// ── 工具:用 useState 强行触发 rerender(没有显式 state) ──────────────────

function useRefForceUpdate(): [number, () => void] {
  const tickRef = useRef(0)
  // useState 仅用于触发 rerender;tick 的真正存储在 ref(避免 stale closure)
  const [, setTick] = useState(0)
  return [tickRef.current, useCallback(() => {
    tickRef.current++
    setTick(t => t + 1)
  }, [])]
}

// ── 自注册 ────────────────────────────────────────────────────────────

// memo: RenderCanvas (host) re-renders on every wheel tick (it subscribes to
// viewport2d.scale for the on-screen zoom% readout). Without memo, React would
// re-render this WHOLE plugin subtree (and every VoxelLayerInstance/
// GridLayerInstance child) on every tick regardless of this component's own
// viewport handling above — memo bails out early since its props never change
// (it takes none), so the cascade stops here instead of at the leaf.
const MemoizedModeTopPlugin = memo(ModeTopPlugin)

registerRenderPlugin({
  name: 'top',
  modes: ['top'],
  Component: MemoizedModeTopPlugin,
})

export default MemoizedModeTopPlugin
