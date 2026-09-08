/**
 * fieldNoise: 在输入 region 的有效格（非零格）上生成一张 [0,1] 标量噪声场（数量场/标量场，
 * 区别于 0/1 掩码）—— 每个有效格 (r,c) 输出 hashNoise(floor(r*scale), floor(c*scale), seed)
 * 得到的连续标量值；region 外（无效格）输出 0。
 *
 * 输入：region (grid) — 0/1（或多值）约束区，只在非零有效格上采样噪声
 *       seed (number)  — 噪声种子，0 用当前时间；相同坐标+相同 seed 结果固定
 *       scale (number, default 1) — 坐标缩放，缩放后再喂 hashNoise，影响噪声空间频率
 * 输出：field (grid)  — 与输入同形状的标量场（number[][]，有效格值域 [0,1]，无效格=0）
 *
 * field 是 scenealg 体系里区别于 region（0/1 掩码）的基本类型：grid 上每格输出一个标量数值。
 * 这里复用 region_noise_fill 的 hashNoise（哈希常数逐字节一致），但不做阈值二值化，而是直接把
 * [0,1) 噪声值写入网格，得到一张空间相关的连续标量场。单 region 输入由 autoIterate fanout。
 */

type Grid = number[][];

/** 与 region_noise_fill 完全一致的坐标哈希噪声：以 seed 混合 r、c，雪崩后归一化到 [0,1)。 */
function hashNoise(r: number, c: number, seed: number): number {
  let h = seed ^ (r * 374761393) ^ (c * 668265263);
  h = (Math.imul(h, 1540483477) + 0x6b43a9b5) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x85ebca77) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 0xc2b2ae3d) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 0x100000000;
}

export function fieldNoise(input: Record<string, unknown>): Record<string, unknown> {
  const region = input.region as Grid | undefined;
  if (!region || region.length === 0 || (region[0]?.length ?? 0) === 0) {
    return { error: "region is required" };
  }

  const rows = region.length;
  const cols = region[0].length;

  const seedRaw = typeof input.seed === "number" ? Math.floor(input.seed) : 0;
  const noiseSeed = (seedRaw === 0 ? Date.now() : seedRaw) >>> 0;
  const scale = typeof input.scale === "number" && input.scale > 0 ? input.scale : 1;

  const out: Grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let r = 0; r < rows; r++) {
    const row = region[r];
    for (let c = 0; c < cols; c++) {
      if ((row[c] ?? 0) === 0) continue;
      out[r][c] = hashNoise(Math.floor(r * scale), Math.floor(c * scale), noiseSeed);
    }
  }

  return { field: out };
}
