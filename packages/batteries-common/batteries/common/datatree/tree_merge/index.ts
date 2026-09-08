/**
 * tree_merge：把多个输入 DataTree 合并，升一维。
 *
 * 行为档位由 inferredAccess（slot[0] 首次连接时由前端写入 node.params）决定：
 *   - 'item'              → item-级 concat：path 取并集，每个 path 内按 slot 顺序串联 items
 *                           （多 branch 结构按位保留；i-th slot 不前置 [i]）
 *   - 其它（list/tree/缺省）→ 结构 pack：第 i 个 slot 的所有 path 前置 [i]（mergeWithPrefix），
 *                           即在外层加一维 branch，输入 i 的 path P → [i, ...P]
 *
 * 端口端 access 静态都是 'tree'（dispatcher 整树透传，槽位间不参与 fanout），
 * 行为分流仅在函数内部，按 inferredAccess 切换；inferredAccess 缺失时退化为结构 pack。
 *
 * 类型无关：tree_merge 是纯粹的 DataTree 维度算子，对承载的元素类型（number / string /
 * scene / ...）一视同仁——它只在结构层面升一维，从不解读 item 的语义。
 */

import { DataTree } from '@forgeax/node-runtime';

// instanceof 在动态 import 场景下跨模块失效，改用 duck-type 检测
function isDataTree(v: unknown): v is DataTree<unknown> {
  if (v === null || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o['branches'] === 'function' && typeof o['branchCount'] === 'function';
}

export function treeMerge(input: Record<string, unknown>): Record<string, unknown> {
  const portCount = typeof input.portCount === 'number' ? input.portCount : 2;
  const inferredAccess = typeof input.inferredAccess === 'string' ? input.inferredAccess : undefined;

  if (inferredAccess === 'item') {
    const slots: DataTree<unknown>[] = [];
    for (let i = 0; i < portCount; i++) {
      const value = input[`item_${i}`];
      if (value === undefined) continue;
      if (!isDataTree(value)) {
        return { error: `item_${i} input must be a DataTree` };
      }
      slots.push(value as DataTree<unknown>);
    }
    return { tree: DataTree.concatByPath(slots) };
  }

  // 默认 / list / tree → 结构 pack：第 i 个 slot 的所有 path 前置 [i]（升一维）
  let result: DataTree<unknown> = DataTree.empty<unknown>();
  for (let i = 0; i < portCount; i++) {
    const value = input[`item_${i}`];
    if (value === undefined) continue;
    if (!isDataTree(value)) {
      return { error: `item_${i} input must be a DataTree` };
    }
    result = result.mergeWithPrefix(value as DataTree<unknown>, i);
  }
  return { tree: result };
}
