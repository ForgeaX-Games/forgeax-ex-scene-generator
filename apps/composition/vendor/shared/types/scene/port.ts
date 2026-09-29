import { encodeSceneDocument, decodeSceneDocument, type SceneWire } from '@forgeax/scene-authoring/scene-wire';
import type { SceneDocument } from '@forgeax/scene-authoring/scene-asset';
import { sceneDocumentFromGraph, graphFromSceneDocument } from './document.js';
/** Live SceneTree editing view. At JSON boundaries it emits scene-document/1:
 * native entities/resources plus separate authoring metadata and a typed buffer pool.
 * Legacy graph records are accepted at this adapter only. In-process calls share
 * persistent graph snapshots without serializing. Focus chooses an editing subtree;
 * packageId/sourceKey are assigned independently by the publication entry.
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
  /** Explicit native interchange snapshot, computed only at an output boundary. */
  toJSON?: () => SceneWire;
}

/** Official name. Same value as ScenePortValue. */
export type SceneTree = ScenePortValue

/**
 * 解析端口值；若不是合法 ScenePortValue 形态返回 null。
 *
 * 端口运行期实际就是 JS 对象（pass-by-reference），不存在字符串解析路径。
 * 这里做的只是结构形态校验，避免下游电池直接 unsafe cast。
 */
export function parseScenePort(value: unknown): ScenePortValue | null {
  let cur: unknown = value
  for (let depth = 0; depth < 8; depth++) {
    const parsed = parseScenePortShape(cur)
    if (parsed) return parsed
    if (Array.isArray(cur) && cur.length > 0) {
      const first = cur[0] as { items?: unknown[]; path?: unknown }
      if (first && typeof first === 'object' && Array.isArray(first.items) && Array.isArray(first.path)) {
        cur = first.items.length === 1 ? first.items[0] : first.items
        continue
      }
      cur = first
      continue
    }
    if (cur && typeof cur === 'object' && Array.isArray((cur as { items?: unknown }).items)) {
      const items = (cur as { items: unknown[] }).items
      cur = items.length === 1 ? items[0] : items
      continue
    }
    if (cur && typeof cur === 'object' && (cur as { scene?: unknown }).scene !== undefined) {
      cur = (cur as { scene: unknown }).scene
      continue
    }
    return null
  }
  return null
}

function parseScenePortShape(value: unknown): ScenePortValue | null {
  if (!value || typeof value !== 'object') return null;
  if ((value as SceneWire).schemaVersion === 'scene-document/1') {
    const restored = graphFromSceneDocument(decodeSceneDocument<SceneDocument>(value as SceneWire));
    return makeScenePort(restored.graph, restored.focus, restored.focusOrigin);
  }
  const v = value as Partial<ScenePortValue>;
  if (typeof v.focus !== 'string') return null;
  if (!v.graph || typeof v.graph !== 'object') return null;
  const focusOrigin = typeof v.focusOrigin === 'string' ? v.focusOrigin : undefined;
  if (isLiveSceneGraph(v.graph)) return makeScenePort(v.graph, v.focus, focusOrigin);
  const entries = Object.values(v.graph as Record<string, unknown>);
  if (entries.length > 0) {
    const sample = entries[0] as { id?: unknown; children?: unknown } | undefined;
    if (!sample || typeof sample.id !== 'string' || typeof sample.children !== 'object') return null;
  }
  try {
    return makeScenePort(reviveGraphFromWire(v.graph as Record<string, unknown>), v.focus, focusOrigin);
  } catch {
    return null;
  }
}

/**
 * 显式构造端口值。无副作用，仅为可读性提供命名包装；运行期等价于 `{ graph, focus }`。
 */
export function makeScenePort(graph: SceneGraph, focus: NodeId, focusOrigin?: string): ScenePortValue {
  const value: ScenePortValue = { graph, focus, ...(focusOrigin !== undefined ? { focusOrigin } : {}) };
  Object.defineProperty(value, 'toJSON', { value: () => encodeSceneDocument(sceneDocumentFromGraph(graph, focus, focusOrigin)), enumerable: false });
  return value;
}
