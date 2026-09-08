/**
 * multi_random_int: 借形状产随机整数 —— 借用输入对象的 DataTree 形状，为每个 branch 生成一个
 * 各异且确定的 [0, count) 整数（如逐地块随机挑一种作物的下标）。
 *
 * 关键不变量（务必保持，否则下游逐分支配对会失效）：
 *   - shape 端口 access:tree —— dispatcher 跳过 normalize/lacing/fanout，op 只被调用一次，
 *     execute 收到整棵原始 DataTree。
 *   - 输出树用 inputTree.map(...) 构造 —— DataTree.map 是 per-item 变换，paths 与每个 branch 的
 *     items.length 都保持不变，仅替换 value。paths 零变换 是下游 lacing 能按分支序号精确配对的硬条件。
 *   - 返回的 DataTree<number> 命中 dispatcher 的 isDataTree 透传分支，会原样透传（rebuild 经
 *     fromEntries，但 paths 不变）。
 *   - 取值推导：rng = mulberry32( hash(baseSeed, pathString) )，再 Math.floor(rng() * count)
 *     映射到 [0, count)。同 baseSeed + 同 path → 同值（确定可复现）；不同 path → 可不同（多样化）。
 *     path 是 readonly number[]（稳定可哈希），用 pathToString(path)（形如 {0;1}）作哈希盐，比纯序号更稳。
 *   - count<=0 兜底返回 0。
 */

import { DataTree } from '@forgeax/node-runtime';

/** mulberry32 伪随机数生成器，返回 [0,1) 浮点数（uint32 状态，>>> 0 无符号推进，给定 seed 确定）。 */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a 风格的确定性 32-bit 字符串哈希；以 baseSeed 为初始状态，pathString 为盐。返回无符号整数。 */
function hash(baseSeed: number, salt: string): number {
  let h = (baseSeed >>> 0) ^ 0x811c9dc5;
  for (let i = 0; i < salt.length; i++) {
    h ^= salt.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** path 的人类可读盐：形如 {0;1;2}，与 node-editor 约定一致，稳定可哈希。 */
function pathToString(path: readonly number[]): string {
  return `{${path.join(';')}}`;
}

/** 从 tree-access 标量输入提取一个标量数值：tree 则取第一个 item；标量则直接用；其余按 fallback 处理。 */
function extractScalar(value: unknown, fallback: number): number {
  if (DataTree.isDataTree(value)) {
    for (const branch of (value as DataTree<unknown>).branches()) {
      if (branch.items.length > 0) {
        const v = branch.items[0];
        return typeof v === 'number' ? Math.floor(v) : fallback;
      }
    }
    return fallback;
  }
  return typeof value === 'number' ? Math.floor(value) : fallback;
}

export function multiRandomInt(input: Record<string, unknown>): Record<string, unknown> {
  const shape = input.shape;
  if (!DataTree.isDataTree(shape)) {
    return { error: 'shape input must be a DataTree' };
  }
  const inputTree = shape as DataTree<unknown>;

  // 0 → 用当前时间戳作为基种子（每次不同）；非零 → 确定可复现。统一取无符号 32-bit。
  const rawBase = extractScalar(input.seed, 0);
  const baseSeed = (rawBase === 0 ? Date.now() : rawBase) >>> 0;

  // 上界 count；缺省 4。count<=0 视为无效，逐分支兜底返回 0。
  const count = extractScalar(input.count, 4);

  // DataTree.map 是 per-item 变换 fn(value, path, idx)，paths 与 items.length 不变。
  // 同 branch 的所有 item 同 path → 同 pathString → 同随机数，自然一致（逐分支一个整数）。
  const valueTree = inputTree.map((_value, path) => {
    if (count <= 0) return 0;
    const rng = mulberry32(hash(baseSeed, pathToString(path)));
    return Math.floor(rng() * count);
  });

  return { value: valueTree };
}
