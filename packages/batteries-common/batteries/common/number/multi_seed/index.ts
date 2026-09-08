/**
 * multi_seed: 借形状播种 —— 借用输入对象的 DataTree 形状，为每个 branch 生成各异且确定的 number 种子。
 *
 * 关键不变量（务必保持，否则下游逐分支配对会失效）：
 *   - shape 端口 access:tree —— dispatcher 跳过 normalize/lacing/fanout，op 只被调用一次，
 *     execute 收到整棵原始 DataTree。
 *   - 输出树用 inputTree.map(...) 构造 —— DataTree.map 是 per-item 变换，paths 与每个 branch 的
 *     items.length 都保持不变，仅替换 value。paths 零变换 是下游 lacing 能按分支序号精确配对的硬条件。
 *   - 返回的 DataTree<number> 命中 dispatcher 的 isDataTree 透传分支，会原样透传（rebuild 经
 *     fromEntries，但 paths 不变）。
 *   - 种子推导：branchSeed = mulberry32( hash(baseSeed, pathString) ) 取一个无符号整数。
 *     同 baseSeed + 同 path → 同 seed（确定可复现）；不同 path → 不同 seed（多样化）。
 *     path 是 readonly number[]（稳定可哈希），用 pathToString(path)（形如 {0;1}）作哈希盐，比纯序号更稳。
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

/** 从 seed 输入提取标量基种子：tree 则取第一个 item；标量则直接用；其余按 0 处理。 */
function extractBaseSeed(seed: unknown): number {
  if (DataTree.isDataTree(seed)) {
    for (const branch of (seed as DataTree<unknown>).branches()) {
      if (branch.items.length > 0) {
        const v = branch.items[0];
        return typeof v === 'number' ? Math.floor(v) : 0;
      }
    }
    return 0;
  }
  return typeof seed === 'number' ? Math.floor(seed) : 0;
}

export function multiSeed(input: Record<string, unknown>): Record<string, unknown> {
  const shape = input.shape;
  if (!DataTree.isDataTree(shape)) {
    return { error: 'shape input must be a DataTree' };
  }
  const inputTree = shape as DataTree<unknown>;

  // 0 → 用当前时间戳作为基种子（每次不同）；非零 → 确定可复现。统一取无符号 32-bit。
  const rawBase = extractBaseSeed(input.seed);
  const baseSeed = (rawBase === 0 ? Date.now() : rawBase) >>> 0;

  // DataTree.map 是 per-item 变换 fn(value, path, idx)，paths 与 items.length 不变。
  // 要求“同形状”：每个 branch 内每个 item 位置都填同一个该分支种子（逐分支一个种子）。
  // 同 branch 的所有 item 同 path → 同 pathString → 同 branchSeed，自然一致。
  const seedTree = inputTree.map((_value, path) => {
    const branchSeed = mulberry32(hash(baseSeed, pathToString(path)))();
    // 取一个确定的无符号 31-bit 整数种子，便于下游当作 seed 数值使用。
    return Math.floor(branchSeed * 0x80000000);
  });

  return { seed: seedTree };
}
