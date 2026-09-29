// 💡 框架级视口订阅 hook
//
// 渲染插件用来订阅当前视口状态:
//   * useViewport2D() —— 2D 平移/缩放（offsetX / offsetY / scale）
//
// 设计：
//   * 视口状态存在 renderStore（统一在一处，跨组件共享）
//   * 插件订阅这个 hook 后，仅在视口变化时 rerender；layer 数据变化不波及
//   * 视口写入路径走 store action（setViewport2d）
//
// 与 useLayer / useLayerSurface 协作：layer.version 决定是否重建产物 surface
// （cache hit），viewport 决定 surface 在主画布上的变换矩阵（cache 复用 +
// 仅合成阶段重发 frame）。这是「viewport 变化只重发 frame，不重建 surface」
// 的实现基础。

import { useRenderStore } from '../store'

export interface Viewport2D {
  offsetX: number
  offsetY: number
  scale: number
}

/** 订阅 2D 视口（pan + zoom）。供 mode-top / mode-iso / mode-topBillboard 使用。 */
export function useViewport2D(): Viewport2D {
  return useRenderStore(s => s.viewport2d)
}
