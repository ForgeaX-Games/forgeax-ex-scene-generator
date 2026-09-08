// 💡 框架级图层 surface 缓存 hook
//
// 渲染插件用来按 version 决定「重建 / 复用」单层的渲染产物（OffscreenCanvas /
// HTMLImageElement / THREE.Object3D / 任何 mode 选定的目标），无须自管：
//   * Map / WeakMap 全局缓存
//   * LRU 淘汰（per-layer 隔离做对了，不需要）
//   * 项目切换 invalidate（lifecycle 已统一处理）
//   * Strict mode 双 mount 边界（hook 内已处理）
//
// 这里走「订阅引用稳定 + per-component 持有 surface」的方向，每个 surface
// 的命名空间天然隔离到组件实例。命中判定 = 单一比较 cached.version === version
//
// 用法（per-layer 组件示例）：
//
//   function VoxelLayerInstance({ layerKey }: { layerKey: string }) {
//     const layer = useVoxelLayer(layerKey)
//     const surface = useLayerSurface(
//       layer?.updatedAt,
//       () => buildOffscreenForLayer(layer!),  // 仅当 version 变化时调用
//       (s) => s.disposeOrRelease(),           // 可选 dispose
//     )
//     // 用 surface 写到主 canvas 即可
//   }

import { useEffect, useRef } from 'react'

/**
 * 按 version 缓存一个图层的渲染产物。
 *
 * @param version 数据版本(layer.updatedAt / 复合 cacheKey 字符串等)。undefined 表示无图层 → 立即清缓存返 null。
 *                复合场景如「`${updatedAt}:${drawMode}`」让 drawMode 切换也触发 rebuild。
 * @param build  构造函数;仅当 version 与上次不同(或首次)时调用。所返 T 的所有权交给 hook。
 * @param dispose 可选:当旧 surface 被替换 / 组件卸载时调用,用于释放底层资源(Three.js geometry/texture、ImageBitmap 等)。
 * @returns 当前 surface(同一 version 下引用稳定);version 为 undefined 时返 null。
 */
export function useLayerSurface<T>(
  version: number | string | undefined,
  build: () => T,
  dispose?: (surface: T) => void,
): T | null {
  // 缓存槽:与本组件实例一对一,挂在 ref 不进入 React state
  const slotRef = useRef<{ surface: T; version: number | string } | null>(null)
  // dispose 闭包随时变（消费者可能传 inline lambda），用 ref 镜像最新值
  const disposeRef = useRef(dispose)
  disposeRef.current = dispose

  let surface: T | null = null
  if (version !== undefined) {
    const cached = slotRef.current
    if (cached && cached.version === version) {
      // 同 version → 复用，零成本
      surface = cached.surface
    } else {
      // version 变化 / 首次：先释放旧 surface，再构造新的
      if (cached) disposeRef.current?.(cached.surface)
      const fresh = build()
      slotRef.current = { surface: fresh, version }
      surface = fresh
    }
  } else if (slotRef.current) {
    // version 转为 undefined（图层被删除等）：清缓存
    disposeRef.current?.(slotRef.current.surface)
    slotRef.current = null
  }

  // 卸载清理：组件 unmount 时释放最后一份 surface
  useEffect(() => () => {
    if (slotRef.current) {
      disposeRef.current?.(slotRef.current.surface)
      slotRef.current = null
    }
  }, [])

  return surface
}
