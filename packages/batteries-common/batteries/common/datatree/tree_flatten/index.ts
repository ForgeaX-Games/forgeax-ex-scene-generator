/**
 * tree_flatten: 对输入 DataTree 执行 Flatten 算子
 * 输入：tree (any) — 源 DataTree（access:tree，整棵透传）
 * 输出：tree (any) — flatten 后的 DataTree（access:tree）
 *
 * 把多 branch（每 branch 任意个 item）顺序拍平到单个 path=[0]，即「多 branch tree → list」。
 * 配合 tree_merge（升一维）即可把多个输入收集成一个干净的 list 喂给下游 list-access 端口。
 */

import { DataTree } from '@forgeax/node-runtime';

// instanceof 在动态 import / 跨模块场景下失效，改用 duck-type 检测（与 tree_merge 一致）。
function isDataTree(v: unknown): v is DataTree<unknown> {
  if (v === null || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o['branches'] === 'function' && typeof o['flatten'] === 'function';
}

export function treeFlatten(input: Record<string, unknown>): Record<string, unknown> {
  const tree = input.tree;
  if (!isDataTree(tree)) {
    return { error: 'tree input must be a DataTree' };
  }
  return { tree: (tree as DataTree<unknown>).flatten() };
}
