// 💡 框架级图层订阅 hook：让渲染插件按 key 订阅"单层"，避免拿全集后再 filter。
//
// 设计目标：
//   * 单层订阅（useVoxelLayer）：组件仅当 *该层* 数据 / 视图态变化时 re-render。
//     其他层的更新不波及。这是 per-layer 组件 + OffscreenCanvas 缓存的前置条件——
//     只有引用稳定，缓存的 reuse 决策才稳。
//   * 键集合订阅（useVoxelLayerKeys）：图层列表组件用，依赖 zustand useShallow
//     做浅比较，避免 Object.keys 每次返回新数组导致的无谓 re-render。
//   * 版本订阅（useVoxelLayerVersion）：插件想做 "data 变了再重建 mesh" 这种
//     dirty 比较时，订阅一个数字而非整个对象，避免引用比较语义的混淆。
//
// 这些 hook 是渲染插件和 shared store 之间的 *唯一* 推荐契约。新写的渲染
// 插件不应再 useRenderStore(s => s.layers) 直接拿整个 Record。

import { useShallow } from 'zustand/react/shallow'
import { useRenderStore } from '../store'
import type { GridLayer, GuideLayer, MeshLayer, RendererVoxelLayer } from '../types'
import { applyOutputLayerOrder, parentsBeforeChildren } from './outputOrder'

/**
 * 订阅一个 voxel 图层（layers 桶 / SceneOutput sink 投影）。
 * key = `${nodeId}:${nodePath}`。
 *
 * setLayers 更新 *其他* 层时该层引用保持稳定 → 订阅者不 re-render。
 * 仅当写入该 key（数据/visible 任一变化）才返回新引用 → 订阅者 re-render。
 */
export function useVoxelLayer(layerKey: string | null | undefined): RendererVoxelLayer | undefined {
  return useRenderStore(s => (layerKey ? s.layers[layerKey] : undefined))
}

/**
 * 订阅 voxel 图层 key 列表，用浅比较防抖。
 * 列表组件（图层面板）用这个 + 子行用 useVoxelLayer(key) 才能做到「单层数据变化
 * 不重渲整个面板」。
 */
export function useVoxelLayerKeys(): string[] {
  // 排序在这里做，因为这是画布 5 个渲染模式和图层面板唯一的公共入口 —— 面板行序和
  // 叠压序必须来自同一个列表，否则用户拖出来的顺序和画出来的顺序会对不上。
  // 这个列表**直接就是**画布的绘制序（越靠后越在上层）：兄弟之间不做 Editable 区那种
  // 面板序→画笔序的反转，那会把既有场景的默认叠压关系整体翻一遍。只有父子轴要纠正
  // （parentsBeforeChildren），因为「子盖父」是场景图的结构事实、不含用户意图。
  return useRenderStore(useShallow(s => parentsBeforeChildren(
    applyOutputLayerOrder(Object.keys(s.layers), s.outputLayerOrder, k => s.layers[k]?.nodePath),
    k => s.layers[k]?.nodePath,
  )))
}

/**
 * 仅订阅图层的 version（updatedAt）。插件需要"数据变了再重建 mesh / OffscreenCanvas"
 * 这类 dirty 比较时用，避免订阅整个 layer 引用导致的边角不必要重建。
 */
export function useVoxelLayerVersion(layerKey: string | null | undefined): number | undefined {
  return useRenderStore(s => (layerKey ? s.layers[layerKey]?.updatedAt : undefined))
}

/**
 * 订阅一个 grid 预览图层（previewLayers 桶 / 任意节点 grid 输出）。
 * key = `${nodeId}:${portName}`。语义同 useVoxelLayer：仅该 key 写入时返回新引用。
 */
export function useGridLayer(layerKey: string | null | undefined): GridLayer | undefined {
  return useRenderStore(s => (layerKey ? s.previewLayers[layerKey] : undefined))
}

/** 订阅 grid 预览图层 key 列表，用浅比较防抖（同 useVoxelLayerKeys）。 */
export function useGridLayerKeys(): string[] {
  return useRenderStore(useShallow(s => Object.keys(s.previewLayers)))
}

export function useMeshLayer(layerKey: string | null | undefined): MeshLayer | undefined {
  return useRenderStore(s => (layerKey ? s.meshLayers[layerKey] : undefined))
}

export function useMeshLayerKeys(): string[] {
  return useRenderStore(useShallow(s => Object.keys(s.meshLayers)))
}

export function useMeshLayerKeysByRole(role: 'terrain' | 'road' | 'houses'): string[] {
  return useRenderStore(useShallow((s) =>
    Object.values(s.meshLayers)
      .filter((layer) => (layer.mesh.role ?? 'terrain') === role)
      .map((layer) => layer.key),
  ))
}

export function useGuideLayer(layerKey: string | null | undefined): GuideLayer | undefined {
  return useRenderStore(s => (layerKey ? s.guideLayers[layerKey] : undefined))
}

export function useGuideLayerKeys(): string[] {
  return useRenderStore(useShallow(s => Object.keys(s.guideLayers)))
}

/**
 * 订阅一个 baked 图层（bakedLayers 桶 / 图外可编辑层）。key = `baked:${nodePath}`。
 * 语义同 useVoxelLayer：仅该 key 写入时返回新引用。
 */
export function useBakedLayer(layerKey: string | null | undefined): RendererVoxelLayer | undefined {
  return useRenderStore(s => (layerKey ? s.bakedLayers[layerKey] : undefined))
}

/** 订阅 baked 图层 key 列表，用浅比较防抖（同 useVoxelLayerKeys）。 */
export function useBakedLayerKeys(): string[] {
  return useRenderStore(useShallow(s => Object.keys(s.bakedLayers)))
}
