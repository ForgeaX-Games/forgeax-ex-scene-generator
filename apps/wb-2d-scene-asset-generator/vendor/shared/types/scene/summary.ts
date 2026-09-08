/**
 * SceneSummary：scene 端口的紧凑"摘要"，仅用于 tooltip / panel 单行展示。
 *
 * 注意（wire 真相）：graph:applied / 端口值 wire 上传输的是**原始** ScenePortValue
 *   `{ tree, focus }`，并不会被替换成 SceneSummary —— 摘要只在前端 nodeTooltip /
 *   nameListPanel 本地从已有端口值现算（summarizeScenePort），不经过广播路径。
 *   （历史上曾设想"广播时压成 summary"，对应的 summarizeSceneForBroadcast 已删除。）
 *
 * 设计动机：前端槽位 hover / 清单面板需要输出概要，全树 JSON 太大，
 *   摘要小且 O(N) 一次树遍历即可。
 *
 * Sentinel：`__kind: 'scene-summary'` 让前端 formatter 识别并定制渲染，
 *   避免被通用 dict 渲染成 `[dict: 7 pairs] keys: "focus", ...`。
 *
 * 节点扁平化模型下，"叶子" = `directChildCount === 0` 的节点；摘要不再二态化 isLeaf。
 */

import type { ScenePortValue } from './port.js';
import { parseScenePort } from './port.js';
import { readNode } from './tree.js';
import type { SceneNodeSnapshot } from './types.js';

export interface SceneSummary {
  readonly __kind: 'scene-summary';
  /** 当前 wire 聚焦路径 */
  readonly focus: string;
  /** focus 节点是否存在；不存在时其余统计仍按 focus 子树（缺省 0） */
  readonly focusExists: boolean;
  /** focus 节点版本号；不存在则 -1 */
  readonly focusVersion: number;
  /** focus 节点 schema（若有） */
  readonly schema?: string;
  /** focus 节点直接子节点数 */
  readonly directChildCount: number;
  /** focus 节点自身携带的体素数 */
  readonly ownVoxelCount: number;
  /** focus 子树（含 focus 自身）所有节点的 cells 总数 */
  readonly voxelCount: number;
  /** focus 子树（含 focus 自身）的节点总数 */
  readonly totalNodes: number;
}

interface Stats {
  totalNodes: number;
  totalVoxels: number;
}

function walkStats(node: SceneNodeSnapshot, acc: Stats): void {
  acc.totalNodes += 1;
  acc.totalVoxels += node.cells?.length ?? 0;
  for (const c of node.children) walkStats(c, acc);
}

/** 从单个 ScenePortValue 计算摘要。无效输入返回 null。 */
export function summarizeScenePort(value: unknown): SceneSummary | null {
  const port: ScenePortValue | null = parseScenePort(value);
  if (!port) return null;

  // focus 路径理论上来自上游电池且经过校验；非法路径（splitPath 抛错）按"不存在"处理
  let node: SceneNodeSnapshot | null;
  try {
    node = readNode(port.tree, port.focus);
  } catch {
    node = null;
  }
  if (!node) {
    return {
      __kind: 'scene-summary',
      focus: port.focus,
      focusExists: false,
      focusVersion: -1,
      directChildCount: 0,
      ownVoxelCount: 0,
      voxelCount: 0,
      totalNodes: 0,
    };
  }

  const stats: Stats = { totalNodes: 0, totalVoxels: 0 };
  walkStats(node, stats);

  const summary: SceneSummary = {
    __kind: 'scene-summary',
    focus: port.focus,
    focusExists: true,
    focusVersion: node.version,
    ...(node.schema !== undefined ? { schema: node.schema } : {}),
    directChildCount: node.children.length,
    ownVoxelCount: node.cells?.length ?? 0,
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
