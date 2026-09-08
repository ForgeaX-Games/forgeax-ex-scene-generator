/**
 * add_child — 把一组独立 scene 节点挂到 parent.focus 之下，作为兄弟子节点。
 *
 * 输入：
 *   - scene  : 父 scene（focus 指向父节点；focus 必须落在已存在节点上）
 *   - nodes  : scene 列表（rank=1）；每个元素是一棵单节点 scene（如 grid2node 的输出）
 *              子节点名取该节点自身的 name 字段。
 *
 * 输出：
 *   - scene       : 新 graph（focus 保持父节点 id，便于下游再 add_child / 转 transform）
 *   - childPaths  : 实际挂入的子节点绝对路径列表（与 nodes 输入一一对应；顺序不变，
 *                   但被去重改名过的项反映的是「实际落盘的名字」，见下）
 *
 * 实现要点：
 *   - graftSubtree 只重写 parent 与新子树本身（O(子树大小)），不重建任何无关祖先/兄弟——
 *     不是旧 tree.ts 的 graftAt 那种"重写整条祖先 spine"路径拷贝。
 *   - order 接着 parent 现有子节点的最大值往后排，使多个 nodes[] 元素之间保持
 *     "输入数组顺序 = 兄弟展示顺序"（同 graph.ts addChildren 的理由）。
 *   - 任一元素失败立即返回 error，不留半成品（graph 是局部变量）。
 *
 * 复盘（2026-07-23，scene v3 命名冲突事故）：v3 的 children 是 Map<name, id>——
 * 兄弟节点名字面必须唯一，这是图结构本身的硬约束（graftSubtree 撞到已占用的 name
 * 会直接 throw）。但"一批同名装饰实例"是本仓库大量模板（PlaceOneDecoration /
 * NaturalDecorationDistribution 等）的常规产出形态——上游 Name 端口对同一装饰类型
 * 的 N 个点位广播同一个字符串（如 2 个"路边驿亭"），在 v2（路径树、无名字唯一性
 * 约束）下从不出问题，v3 上线后这里原先"批内重名直接报错"，导致这些模板在
 * count>1 时 100% 落地失败（voxel_range 都能正常跑，add_child 却因为"scene 是
 * 必须的"级联报错——根子是这批同名节点从未真正挂上去）。
 * 修复：不再报错，改成自动去重——同名的第 2 个及以后实例自动加 `_2`/`_3`... 后缀
 * 再落盘（对批内重复 和 与 parent 已有同名子节点冲突都适用）。这与
 * locationNameGate.ts 自己文档化的容忍策略完全对齐（"望江客栈_主楼"仍算命中
 * "望江客栈"）——叙事地点名的子串匹配不受影响，只是图里存的兄弟节点名字符串
 * 本身变成加了后缀的、真正唯一的版本。
 */

import {
  getNode,
  graftSubtree,
  makeScenePort,
  parseScenePort,
  pathOf,
  type ScenePortValue,
} from '../../../../vendor/dist/shared/types/index.js';

interface AddChildResult {
  scene?: ScenePortValue;
  childPaths?: string[];
  error?: string;
}

export function addChild(input: Record<string, unknown>): AddChildResult {
  const parent = parseScenePort(input.scene);
  if (!parent) return { error: 'scene (parent) is required and must be a ScenePortValue' };

  const parentNode = getNode(parent.graph, parent.focus);
  if (parentNode === null) {
    return { error: `parent path not found: "${parent.focus}"` };
  }

  const rawNodes = input.nodes;
  if (!Array.isArray(rawNodes)) {
    return { error: 'nodes must be a list of scene values (rank=1)' };
  }
  if (rawNodes.length === 0) {
    return { scene: makeScenePort(parent.graph, parent.focus), childPaths: [] };
  }

  let graph = parent.graph;
  let nextOrder = 0;
  const usedNames = new Set<string>(parentNode.children.keys());
  for (const existingId of parentNode.children.values()) {
    const existing = graph.get(existingId);
    if (existing && existing.order >= nextOrder) nextOrder = existing.order + 1;
  }

  /** First free `${base}` / `${base}_2` / `${base}_3` ... not already in `usedNames`. */
  function dedupeName(base: string): string {
    if (!usedNames.has(base)) return base;
    let suffix = 2;
    while (usedNames.has(`${base}_${suffix}`)) suffix++;
    return `${base}_${suffix}`;
  }

  const childPaths: string[] = [];
  for (let i = 0; i < rawNodes.length; i++) {
    const sn = parseScenePort(rawNodes[i]);
    if (!sn) return { error: `nodes[${i}] is not a valid ScenePortValue` };

    const subtree = getNode(sn.graph, sn.focus);
    if (subtree === null) {
      return { error: `nodes[${i}] focus "${sn.focus}" does not exist in its graph` };
    }
    const rawName = subtree.name;
    if (!rawName) return { error: `nodes[${i}] focus is that source's own root; cannot graft the root itself` };
    const name = dedupeName(rawName);
    usedNames.add(name);

    try {
      const result = graftSubtree(graph, parent.focus, name, sn.graph, sn.focus, { order: nextOrder++ });
      graph = result.graph;
      childPaths.push(pathOf(graph, result.id) ?? `/${name}`);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  return { scene: makeScenePort(graph, parent.focus), childPaths };
}
