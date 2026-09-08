/**
 * DataTree 一等算子的纯实现：接受 entries 数组、返回 entries 数组。
 *
 * tree.ts 里的 DataTree<T> 方法是这些函数的薄包装；分离让算子可单独被
 * dispatcher / 测试 / 其他底层路径直接消费，不被 wrapper class 绑住。
 *
 * 约定：所有算子返回的 entries 已是「path 唯一、items 同 branch 同质」，
 *       但是否排序由调用方负责（DataTree.fromEntries 会再排）。
 */

import {
  type DataTreeEntry,
  type Path,
  pathToString,
} from './types.js';

/** Graft：每个 item 升一层为独立 branch。{A}=[a,b,c] → {A;0}=[a],{A;1}=[b],{A;2}=[c]；空 branch 被丢弃。 */
export function graftEntries<T>(entries: ReadonlyArray<DataTreeEntry<T>>): DataTreeEntry<T>[] {
  const out: DataTreeEntry<T>[] = [];
  for (const { path, items } of entries) {
    items.forEach((item, idx) => {
      out.push({ path: [...path, idx], items: [item] });
    });
  }
  return out;
}

/** Flatten：所有 branch 顺序拍到 {0}。空树仍为空树（不是 {0}=[]）。 */
export function flattenEntries<T>(entries: ReadonlyArray<DataTreeEntry<T>>): DataTreeEntry<T>[] {
  if (entries.length === 0) return [];
  const all: T[] = [];
  for (const { items } of entries) all.push(...items);
  return [{ path: [0], items: all }];
}

/** Trim：砍 path 末尾 N 段，相同新 path 的 items 顺序合并；剩余 path 必须 >=1。 */
export function trimEntries<T>(
  entries: ReadonlyArray<DataTreeEntry<T>>,
  n: number,
): DataTreeEntry<T>[] {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`DataTree: trim n must be non-negative integer (got ${n})`);
  }
  if (n === 0) return entries.map(e => ({ path: [...e.path], items: [...e.items] }));
  return reduceByNewPath(entries, ({ path }) => {
    if (path.length - n < 1) {
      throw new Error(`DataTree: trim(${n}) would empty path ${pathToString(path)}`);
    }
    return path.slice(0, path.length - n);
  });
}

/** Shift：砍 path 头部 N 段；剩余 path 必须 >=1。 */
export function shiftEntries<T>(
  entries: ReadonlyArray<DataTreeEntry<T>>,
  n: number,
): DataTreeEntry<T>[] {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`DataTree: shift n must be non-negative integer (got ${n})`);
  }
  if (n === 0) return entries.map(e => ({ path: [...e.path], items: [...e.items] }));
  return reduceByNewPath(entries, ({ path }) => {
    if (path.length - n < 1) {
      throw new Error(`DataTree: shift(${n}) would empty path ${pathToString(path)}`);
    }
    return path.slice(n);
  });
}

/**
 * Simplify：剥所有 branch 共享的前缀；至少保留一段（避免任何 path 被砍空）。
 * 0/1 个 branch 的树原样返回；显式调用语义，禁止隐式 simplify。
 */
export function simplifyEntries<T>(entries: ReadonlyArray<DataTreeEntry<T>>): DataTreeEntry<T>[] {
  if (entries.length <= 1) {
    return entries.map(e => ({ path: [...e.path], items: [...e.items] }));
  }
  const first = entries[0]!.path;
  let common = first.length;
  for (let i = 1; i < entries.length; i++) {
    const p = entries[i]!.path;
    let j = 0;
    while (j < common && j < p.length && first[j] === p[j]) j++;
    common = j;
    if (common === 0) break;
  }
  let minLen = Infinity;
  for (const e of entries) if (e.path.length < minLen) minLen = e.path.length;
  const cutoff = Math.min(common, minLen - 1);
  if (cutoff <= 0) {
    return entries.map(e => ({ path: [...e.path], items: [...e.items] }));
  }
  return entries.map(({ path, items }) => ({
    path: path.slice(cutoff),
    items: [...items],
  }));
}

/**
 * Renumber：保 sibling 顺序的前提下，把每层的 path 段稠密化为 0..N。
 * 用途：消除 trim/shift/合并后留下的 hole；让序列化结果稳定。
 */
export function renumberEntries<T>(entries: ReadonlyArray<DataTreeEntry<T>>): DataTreeEntry<T>[] {
  if (entries.length === 0) return [];
  const sorted = entries.slice().sort((a, b) => {
    const len = Math.min(a.path.length, b.path.length);
    for (let i = 0; i < len; i++) if (a.path[i] !== b.path[i]) return a.path[i]! - b.path[i]!;
    return a.path.length - b.path.length;
  });
  let maxDepth = 0;
  for (const e of sorted) if (e.path.length > maxDepth) maxDepth = e.path.length;
  const layerBuckets: Map<string, Map<number, number>>[] = [];
  for (let d = 0; d < maxDepth; d++) layerBuckets.push(new Map());
  return sorted.map(({ path, items }) => {
    const newPath: number[] = [];
    let parentKey = '';
    for (let d = 0; d < path.length; d++) {
      const orig = path[d]!;
      const layer = layerBuckets[d]!;
      let bucket = layer.get(parentKey);
      if (!bucket) {
        bucket = new Map();
        layer.set(parentKey, bucket);
      }
      let mapped = bucket.get(orig);
      if (mapped === undefined) {
        mapped = bucket.size;
        bucket.set(orig, mapped);
      }
      newPath.push(mapped);
      parentKey += `.${orig}`;
    }
    return { path: newPath, items: [...items] };
  });
}

/**
 * MergeWithPrefix：把 other 的所有 path 前置 [prefix] 段后拼到 base 之上；
 * base 自己 path 不动；冲突抛错。
 *
 * 多路合并惯用法：
 *   DataTree.empty<T>().mergeWithPrefix(t0, 0).mergeWithPrefix(t1, 1)...
 */
export function mergeEntriesWithPrefix<T>(
  base: ReadonlyArray<DataTreeEntry<T>>,
  other: ReadonlyArray<DataTreeEntry<T>>,
  prefix: number,
): DataTreeEntry<T>[] {
  if (!Number.isInteger(prefix) || prefix < 0 || !Number.isFinite(prefix)) {
    throw new Error(`DataTree: merge prefix must be non-negative finite integer (got ${prefix})`);
  }
  const seen = new Set<string>();
  const out: DataTreeEntry<T>[] = [];
  for (const { path, items } of base) {
    seen.add(path.join('.'));
    out.push({ path: [...path], items: [...items] });
  }
  for (const { path, items } of other) {
    const newPath = [prefix, ...path];
    const key = newPath.join('.');
    if (seen.has(key)) {
      throw new Error(`DataTree: merge collision at ${pathToString(newPath)}`);
    }
    seen.add(key);
    out.push({ path: newPath, items: [...items] });
  }
  return out;
}

/**
 * ConcatByPath：按 path 取并集；对每个 path，按 slot 顺序把 items 拼起来。
 *
 * 用于 tree_merge 在 inferredAccess === 'item' 时的 item-级合并：保留每个分支
 * 的 path 不变，只在每个分支内做跨 slot 顺序串联。slot 缺该 path 则跳过。
 *
 * 例：slots=[{[0]:[a,b],[1]:[c]}, {[0]:[x],[1]:[y,z]}]
 *     → {[0]:[a,b,x], [1]:[c,y,z]}
 */
export function concatEntriesByPath<T>(
  slots: ReadonlyArray<ReadonlyArray<DataTreeEntry<T>>>,
): DataTreeEntry<T>[] {
  const grouped = new Map<string, { path: Path; items: T[] }>();
  for (const slot of slots) {
    for (const { path, items } of slot) {
      const key = path.join('.');
      let bucket = grouped.get(key);
      if (!bucket) {
        bucket = { path: [...path], items: [] };
        grouped.set(key, bucket);
      }
      bucket.items.push(...items);
    }
  }
  return [...grouped.values()];
}

/** 内部工具：按 fn 计算的新 path 分组，items 顺序合并；保持首次出现顺序。 */
function reduceByNewPath<T>(
  entries: ReadonlyArray<DataTreeEntry<T>>,
  fn: (entry: DataTreeEntry<T>) => Path,
): DataTreeEntry<T>[] {
  const grouped = new Map<string, { path: Path; items: T[] }>();
  for (const entry of entries) {
    const newPath = fn(entry);
    const key = newPath.join('.');
    let bucket = grouped.get(key);
    if (!bucket) {
      bucket = { path: [...newPath], items: [] };
      grouped.set(key, bucket);
    }
    bucket.items.push(...entry.items);
  }
  return [...grouped.values()];
}
