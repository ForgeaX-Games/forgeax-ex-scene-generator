/**
 * SceneSummary：scene 端口的紧凑"摘要"，仅用于 tooltip / panel 单行展示。
 *
 * 注意（wire 真相）：graph:applied / 端口值 wire 上传输的是**原始** ScenePortValue
 *   `{ graph, focus }`，并不会被替换成 SceneSummary —— 摘要只在前端 nodeTooltip /
 *   nameListPanel 本地从已有端口值现算（summarizeScenePort），不经过广播路径。
 *
 * v3 变化：
 *   - focusVersion 字段已删除——持久化 map 下"这段子树有没有变"直接用引用相等
 *     判断，没有版本字段可报（见重构规格「核心结论」）。
 *   - directChildCount 用 children.size（Map）取代 children.length（Array）。
 *   - voxelCount 用 cellCount(content) 逐节点累加，不材料化整棵体素数组。
 *
 * Sentinel：`__kind: 'scene-summary'` 让前端 formatter 识别并定制渲染，
 *   避免被通用 dict 渲染成 `[dict: 7 pairs] keys: "focus", ...`。
 *
 * 节点扁平化模型下，"叶子" = `directChildCount === 0` 的节点；摘要不再二态化 isLeaf。
 */

import type { ScenePortValue } from './port.js';
import { parseScenePort } from './port.js';
import { childrenOf, getNode } from './graph.js';
import type { NodeId, SceneGraph, SceneNode } from './graph.js';
import { cellCount } from './volume.js';

export interface SceneSummary {
  readonly __kind: 'scene-summary';
  /** 当前 wire 聚焦节点 id */
  readonly focus: NodeId;
  /** focus 节点是否存在；不存在时其余统计仍按 focus 子树（缺省 0） */
  readonly focusExists: boolean;
  /** focus 节点 schema（若有） */
  readonly schema?: string;
  /** focus 节点直接子节点数 */
  readonly directChildCount: number;
  /** focus 节点自身携带的体素数 */
  readonly ownVoxelCount: number;
  /** focus 子树（含 focus 自身）所有节点的体素总数 */
  readonly voxelCount: number;
  /** focus 子树（含 focus 自身）的节点总数 */
  readonly totalNodes: number;
}

interface Stats {
  totalNodes: number;
  totalVoxels: number;
}

function walkStats(graph: SceneGraph, node: SceneNode, acc: Stats, visited: Set<NodeId>): void {
  if (visited.has(node.id)) return;
  visited.add(node.id);
  acc.totalNodes += 1;
  acc.totalVoxels += node.content ? cellCount(node.content) : 0;
  for (const child of childrenOf(graph, node.id)) walkStats(graph, child, acc, visited);
}

/** 从单个 ScenePortValue 计算摘要。无效输入返回 null。 */
export function summarizeScenePort(value: unknown): SceneSummary | null {
  const port: ScenePortValue | null = parseScenePort(value);
  if (!port) return null;

  const node = getNode(port.graph, port.focus);
  if (!node) {
    return {
      __kind: 'scene-summary',
      focus: port.focus,
      focusExists: false,
      directChildCount: 0,
      ownVoxelCount: 0,
      voxelCount: 0,
      totalNodes: 0,
    };
  }

  const stats: Stats = { totalNodes: 0, totalVoxels: 0 };
  walkStats(port.graph, node, stats, new Set());

  const summary: SceneSummary = {
    __kind: 'scene-summary',
    focus: port.focus,
    focusExists: true,
    ...(node.schema !== undefined ? { schema: node.schema } : {}),
    directChildCount: node.children.size,
    ownVoxelCount: node.content ? cellCount(node.content) : 0,
    voxelCount: stats.totalVoxels,
    totalNodes: stats.totalNodes,
  };
  return summary;
}

/** 类型守卫：从未知值识别摘要（含 array of summary 中的元素）。前端 tooltip 使用。 */
export function isSceneSummary(value: unknown): value is SceneSummary {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { __kind?: unknown }).__kind === 'scene-summary'
  );
}

/** Scene 摘要单行字符串：focus + 体素 / 子节点 / 子树规模统计。
 *  前端 tooltip / 后端 panel 共用同一份压缩展示。 */
export function formatSceneSummary(s: SceneSummary): string {
  if (!s.focusExists) return `scene focus="${s.focus}" (missing)`;
  const schemaPart = s.schema ? ` schema="${s.schema}"` : '';
  return `scene focus="${s.focus}"${schemaPart} voxels=${s.voxelCount} children=${s.directChildCount} nodes=${s.totalNodes}`;
}
