/**
 * scene_prune_to_focus — 把 graph 物理裁剪到只含当前 focus 节点自身 + 其后代。
 *
 * 与 scene_focus_path 的区别：scene_focus_path 只换 focus 指针，graph 引用不变
 * （祖先/旁支原样留在内存里）；这个电池会真正构造一张不含祖先/旁支的新 graph，
 * 让它们失去引用、可以被 GC 回收。
 *
 * 代价 / 权衡（务必知情后使用）：
 *   - 裁剪之后，focus 变成新 graph 的本地根（parent === null）。绝对路径记录会
 *     写进输出 scene 的 focusOrigin 字段（仅供展示/审计，不能拿去在新 graph 上
 *     解析——祖先节点已经不在图里了）。
 *   - 裁剪之后再也无法把 focus 移回原图里的祖先或旁支节点（那些节点已经不在
 *     graph 里）——如果下游流程还需要"多层 fanout 后把 focus 重置回公共祖先"
 *     （scene_focus_path 的原设计用途之一），必须在调用这个电池之前完成，或者
 *     从没裁剪过的另一路分支重新取数据。
 *   - 裁剪本身是 O(focus 子树节点数) 的一次遍历（重建"id → node"索引），节点自
 *     身的 content/attributes 等负载按引用复用，不做深拷贝。
 */
import {
  makeScenePort,
  parseScenePort,
  pruneToFocus,
  type ScenePortValue,
} from '../../../../vendor/dist/shared/types/index.js'

interface Result {
  scene?: ScenePortValue
  error?: string
}

export function scenePruneToFocus(input: Record<string, unknown>): Result {
  const port = parseScenePort(input.scene)
  if (!port) return { error: 'scene is required and must be a ScenePortValue' }

  const { graph, originPath } = pruneToFocus(port.graph, port.focus)

  const combinedOrigin =
    port.focusOrigin !== undefined
      ? originPath === '/' || originPath === null
        ? port.focusOrigin
        : port.focusOrigin === '/'
          ? originPath
          : port.focusOrigin + originPath
      : (originPath ?? undefined)

  return { scene: makeScenePort(graph, port.focus, combinedOrigin) }
}
