/**
 * Scene 端口值 v3：scene 类型的端口承载的对象。
 *
 * 与 v2（{ tree: SceneNodeSnapshot, focus: string }）的根本差异：
 *   - tree（嵌套快照）→ graph（ID-addressed 持久化 map）：mutation 不再需要
 *     path-copying 重建整条祖先 spine，只重写真正改动的节点记录本身
 *     （见 graph.ts 顶部注释 + scene-v3-refactor-spec canvas）。
 *   - focus: string（路径）→ focus: NodeId：路径仍然可以通过 resolvePath/pathOf
 *     双向转换，但 wire 上传的是稳定的 id，不是每次都要重新沿路径下钻的字符串。
 *
 * 设计契约（保持不变）：
 *   - graph 是不可变持久化 map；任何 mutation 走 graph.ts 的纯函数返回新 graph
 *   - 管线内部（battery ↔ battery，同进程）跨 wire 传递只是 JS 对象引用赋值，
 *     不做 JSON 序列化（避免大文件多次拷贝）
 *   - 真正跨 HTTP/JSON 边界的那一次（/api/v1/.../execute 的响应体 → 浏览器
 *     `fetch().json()`）不是"避免序列化"能绕开的——PersistentStringMap 会被
 *     JSON.stringify 自动拍平（见 persistent-map.ts 的 toJSON），到前端拿到的
 *     `graph` 只是个 plain object，不再有 .get/.set。parseScenePort 在这里做
 *     双模兼容：graph 已经是活的 PersistentStringMap 就直接用（同进程零成本），
 *     否则视为线上形态，调 reviveGraphFromWire 一次性重建成可查询的图——调用方
 *     不需要关心自己拿到的值到底有没有经过 JSON 往返。
 *   - focus 表达本 wire 聚焦在哪个节点；mutator 通常在 focus 处操作
 *   - Focus 读取范围约定（不是类型系统能强制的边界，需要 review 纪律）：电池只应该
 *     从自己声明的 focus 出发导航（graph.get(focus) → 顺 children 往下），
 *     不得凭空用别的 NodeId 去访问不相关节点。
 */

import { isLiveSceneGraph, reviveGraphFromWire, type NodeId, type SceneGraph } from './graph.js';

export interface ScenePortValue {
  /**
   * 当前 wire 上的 scene graph。默认情况下这是完整图（含 focus 的祖先/旁支），
   * 电池只应从 focus 往下导航——但如果这个 port 是 scene_prune_to_focus 的输出，
   * graph 就已经被物理裁剪到只含 focus 自身+其后代，此时 focus 是这个 graph 的
   * 本地根（parent === null），graph.get(ROOT_ID) 未必还存在。
   */
  graph: SceneGraph;
  /** 该 wire 聚焦的节点 id（必须存在于 graph 中）。 */
  focus: NodeId;
  /**
   * 仅当 graph 已被 scene_prune_to_focus 裁剪过时才存在：记录 focus 在裁剪前
   * 那张（更大的）graph 里的绝对路径，纯粹用于展示/审计——祖先节点已经不在
   * 当前 graph 里了，不能拿这个字符串去做任何解析。多次裁剪会依次拼接。
   */
  focusOrigin?: string;
}

/**
 * 解析端口值；若不是合法 ScenePortValue 形态返回 null。
 *
 * 端口运行期实际就是 JS 对象（pass-by-reference），不存在字符串解析路径。
 * 这里做的只是结构形态校验，避免下游电池直接 unsafe cast。
 */
export function parseScenePort(value: unknown): ScenePortValue | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<ScenePortValue>;
  if (typeof v.focus !== 'string') return null;
  if (!v.graph || typeof v.graph !== 'object') return null;
  const focusOrigin = typeof v.focusOrigin === 'string' ? v.focusOrigin : undefined;
  if (isLiveSceneGraph(v.graph)) return { graph: v.graph, focus: v.focus, ...(focusOrigin !== undefined ? { focusOrigin } : {}) };
  // 线上形态（JSON.parse 之后）：graph 是 { [id]: plainNode } 的 plain object。
  // 防御性地要求它至少长得像"一堆 SceneNode"，避免把任意 object 误判成 scene。
  const entries = Object.values(v.graph as Record<string, unknown>);
  if (entries.length > 0) {
    const sample = entries[0] as { id?: unknown; children?: unknown } | undefined;
    if (!sample || typeof sample.id !== 'string' || typeof sample.children !== 'object') return null;
  }
  try {
    return {
      graph: reviveGraphFromWire(v.graph as Record<string, unknown>),
      focus: v.focus,
      ...(focusOrigin !== undefined ? { focusOrigin } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * 显式构造端口值。无副作用，仅为可读性提供命名包装；运行期等价于 `{ graph, focus }`。
 */
export function makeScenePort(graph: SceneGraph, focus: NodeId, focusOrigin?: string): ScenePortValue {
  return { graph, focus, ...(focusOrigin !== undefined ? { focusOrigin } : {}) };
}
