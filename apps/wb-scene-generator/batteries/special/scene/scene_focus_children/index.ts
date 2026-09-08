/**
 * scene_focus_children — 把单个 scene 展开成多个 scene，每个 focus 在不同子节点。
 *
 * 输入：scene（focus 指向父节点）
 * 输出：scenes (access:list) — 每个 scene 共享同一棵 tree（不可变共享，无拷贝），
 *       focus 移到当前 focus 的某个直接子节点。子节点为空时输出空 list。
 *
 * 这是「递归展开协议」的下钻入口：一个父 scene fanout 成 N 个子 scene，
 * 后续的展开电池组对每个子 scene 独立处理（DataTree 自动批量）。
 */

import {
  childrenOf,
  getNode,
  makeScenePort,
  parseScenePort,
  type ScenePortValue,
} from '../../../../vendor/dist/shared/types/index.js';

interface Result {
  scenes?: ScenePortValue[];
  childCount?: number;
  error?: string;
}

export function sceneFocusChildren(input: Record<string, unknown>): Result {
  const port = parseScenePort(input.scene);
  if (!port) return { error: 'scene is required and must be a ScenePortValue' };

  const node = getNode(port.graph, port.focus);
  if (node === null) return { error: `focus path does not exist: "${port.focus}"` };

  // graph 引用不变，只是 focus 换到不同的子节点 id——不可变持久化 map 下这是
  // O(1) 的引用赋值，不是拷贝（对照旧 tree.ts 版本的注释：这条性质在新模型下
  // 依然成立，只是"共享的是谁"从嵌套快照换成了持久化 map 实例）。
  const scenes: ScenePortValue[] = childrenOf(port.graph, port.focus).map((c) => makeScenePort(port.graph, c.id));

  return { scenes, childCount: scenes.length };
}
