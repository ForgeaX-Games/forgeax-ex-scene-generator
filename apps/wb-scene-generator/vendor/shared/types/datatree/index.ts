/**
 * Path-keyed DataTree：跨进程 wire payload + 一等算子（参见 docs/refactor/datatree.md）。
 *
 * 拓扑：
 *   types.ts     — Path / DataTreeEntry / 路径工具（comparePaths/pathToString/validatePath）
 *   operators.ts — 纯算子（graft/flatten/trim/shift/simplify/renumber/mergeWithPrefix）
 *   tree.ts      — DataTree<T> 不可变 wrapper class（算子方法 + JSON 同构）
 */

export * from './types.js';
export * from './operators.js';
export * from './tree.js';
