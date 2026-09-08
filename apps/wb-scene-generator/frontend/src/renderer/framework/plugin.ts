// 💡 渲染插件契约
//
// 「插件 = 一个 React 组件 + 它声明的 ViewMode 列表」。
//
// ──────────────────────────────────────────────────────────────────────────
// 框架已为插件提供的能力（plugin 不要重新发明）
// ──────────────────────────────────────────────────────────────────────────
//
// 数据订阅：
//   * useVoxelLayerKeys()  —— 浅比较的 key 列表
//   * useVoxelLayer(key)   —— 单层引用稳定订阅
//   * useVoxelLayerVersion(key) —— 仅 version
//
// 视口：
//   * useViewport2D()       —— offsetX / offsetY / scale
//
// 缓存生命周期：
//   * useLayerSurface(version, build, dispose?) —— 按 version 自动 reuse / rebuild
//
// 失效信号（项目切换）：
//   * RenderLifecycle.projectChanged
//   * 插件在自己的模块顶部 .on() 注册自己关心的事件（不要走 useEffect 订阅）
//
// 串号过滤、批量合批、Strict Mode 双 mount —— 框架已统一处理，插件不写一行
// 相关代码。
//
// ──────────────────────────────────────────────────────────────────────────
// 插件契约（plugin 必须做的）
// ──────────────────────────────────────────────────────────────────────────
//
// 1. 声明 modes: ViewMode[]
// 2. 提供 Component: React.FC —— 用上面的 hook 订阅它关心的状态，渲染到自己
//    选定的 surface（OffscreenCanvas / THREE.Object3D / DOM / 任何）
// 3. 在自己的模块顶部 registerRenderPlugin(plugin)，模块通过 transitive
//    import 在框架启动时被加载（与 RenderLifecycle 同模式）
//
// 不允许：
//   * 直接 useRenderStore(s => s.layers) 拿全集
//   * 自己监听 WS / 自己处理 executionId
//   * 自己 LRU / 自己 invalidate cache

import type { ForwardRefExoticComponent, MemoExoticComponent, RefAttributes } from 'react'
import type { ViewMode } from '../types'
import type { BillboardVoxelHit } from './geometry/topBillboard'

/**
 * 插件向 host 暴露的命令式接口(plugin → host 反向通道)。
 *
 * 各方法皆可选 —— 插件按需实现。host 以 `pluginRef.current?.method?.(...)` 调用。
 *
 * 详见 `docs/refactor/render-plugin-framework.md` §7.2 / §7.3。
 */
export interface PluginHandle {
  // ── §7.2 鼠标交互协议 ───────────────────────────────────────────────
  /** 给定 CSS 像素鼠标位置,返回当前所在的 cell 坐标。host 用作"屏幕角 cell 提示"。 */
  screenToCell?(cssX: number, cssY: number): { col: number; row: number } | null
  /** 反向:cell 中心点 → CSS 像素。host 用作 ai-agent select_cell 高亮等。 */
  cellToScreen?(col: number, row: number): { x: number; y: number } | null
  /**
   * 编辑模式专用:CSS 像素 + 当前 z 层 → 要写入的 voxel {x,y,z}。与
   * screenToCell 不同,它不裁剪到当前 bbox(允许在空层/边界外落子扩展),并直接
   * 返回世界坐标。当前只有 billboard 实现编辑映射。
   */
  screenToEditCell?(cssX: number, cssY: number, z: number): { x: number; y: number; z: number } | null
  /**
   * SELECT 工具专用:给定 CSS 像素鼠标位置,返回投影到该屏幕格的 voxel 栈
   * (视觉最上层优先,top→bottom)。一个像素可能属于多个 voxel(不同高度沿屏幕
   * 列重叠),host 据此做"首点选最上层、原地重复点逐层下钻"的命中循环。插件用
   * 自己维护的 column occupancy 索引解析(O(该列 voxel 数)),host 不重建几何。
   */
  voxelStackAtScreen?(cssX: number, cssY: number): BillboardVoxelHit[]
  // ── §7.3 截图协议 ────────────────────────────────────────────────
  /** 同步触发一次合成,确保截图前帧最新。host 截图前调用。 */
  renderFrame?(): void
  /** 当前 plugin 主帧的 canvas;host 截图直接 drawImage。 */
  getFrameCanvas?(): HTMLCanvasElement | null
  // ── §7.4 视图重置 ────────────────────────────────────────────────
  /**
   * Toolbar 的"重置视图"按钮触发(host 在 viewResetTrigger 增量时调用)。
   * 自管视口的插件(如 free3d 的 OrbitControls)用此把相机摆回 auto-fit 起点;
   * 不自管视口的插件可以不实现(host 会兜底重置 viewport2d / nav3d)。
   */
  resetView?(): void
}

export interface RenderPlugin {
  /** 该插件接管的 viewMode 列表。同一 ViewMode 不能被多个 plugin 同时 register。 */
  modes: ViewMode[]
  /**
   * 插件的 React 实现(forwardRef,通常再套一层 React.memo —— host 侧
   * RenderCanvas 会因为自身订阅 viewport2d.scale 等状态而频繁重渲染,插件不
   * memo 的话会被拖着一起重渲染整棵子树)。框架在 viewMode 切到 modes 之一时
   * 挂载此组件,并通过 ref 拿到 PluginHandle(供 host 调 §7.2 / §7.3 反向接口)。
   *
   * 显式列出 memo 变体(而不是用 `ComponentType<RefAttributes<PluginHandle>>`
   * 泛化两者):`ComponentType` 展开成 `FunctionComponent`,其 `propTypes`
   * 字段会把 legacy string ref 的兼容性问题带进来,导致纯 forwardRef(无 memo)
   * 插件反而报类型错误。
   */
  Component:
    | ForwardRefExoticComponent<RefAttributes<PluginHandle>>
    | MemoExoticComponent<ForwardRefExoticComponent<RefAttributes<PluginHandle>>>
  /** 调试 / 错误信息显示用。 */
  name: string
}

const registry = new Map<ViewMode, RenderPlugin>()

/**
 * 注册渲染插件。在 plugin 模块顶部调用，模块被 import 时即注册。
 * 重复注册同 ViewMode 视为更新（覆盖），调试时会打 warn。
 */
export function registerRenderPlugin(plugin: RenderPlugin): void {
  for (const mode of plugin.modes) {
    if (registry.has(mode) && registry.get(mode)?.name !== plugin.name) {
      console.warn(`[RenderPlugin] mode '${mode}' was registered by '${registry.get(mode)?.name}', overwritten by '${plugin.name}'`)
    }
    registry.set(mode, plugin)
  }
}

/** 框架内部用：按 ViewMode 取插件；未注册返 undefined。 */
export function getRenderPlugin(mode: ViewMode): RenderPlugin | undefined {
  return registry.get(mode)
}

/** 是否有任何插件接管该 ViewMode。RenderCanvas 据此决定走新路径还是 legacy dispatch。 */
export function hasRenderPlugin(mode: ViewMode): boolean {
  return registry.has(mode)
}

/** 已注册插件全表（debug / dev tool 用）。 */
export function listRenderPlugins(): ReadonlyMap<ViewMode, RenderPlugin> {
  return registry
}
