/**
 * regionNoiseFill: 噪声阈值填充 —— 基于坐标哈希生成确定性噪声场，对区域内每个有效格当
 * noise(r,c,seed) > (1 - density) 时保留为 1，得到连片/带纹理的 0/1 点掩码（与输入同形状）。
 *
 * 输入：region (grid) — 0/1（或多值）约束区，只在非零有效格内取值
 *       density (number, 0..1) — 保留比例（阈值 = 1 - density），越大保留越多
 *       seed (number) — 噪声种子，0 用当前时间
 * 输出：region (grid) — 与输入同形状的 0/1 点掩码（保留格=1，其余=0）
 *       count (number) — 实际保留的格数
 *
 * 来源：通用化老 natural_decoration 里的 fillNoise / hashNoise —— 基于坐标+seed 的整数哈希得到
 * [0,1) 噪声，按阈值二值化。去掉装饰语义后是一个纯通用的「哈希噪声阈值散布」算子；同坐标同 seed
 * 结果固定（与逐格伯努利的 region_random_fill 不同：噪声场空间相关、呈连片分布）。单 region 输入
 * 由 autoIterate fanout。
 */

type Grid = number[][];

/** 老 natural_decoration 的坐标哈希噪声：以 seed 混合 r、c，雪崩后归一化到 [0,1)。 */
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

export function regionNoiseFill(input: Record<string, unknown>): Record<string, unknown> {
  const region = input.region as Grid | undefined;
  if (!region || region.length === 0 || (region[0]?.length ?? 0) === 0) {
    return { error: "region is required" };
  }

  const rows = region.length;
  const cols = region[0].length;

  const density = typeof input.density === "number" ? Math.max(0, Math.min(1, input.density)) : 0.3;
  const mode = input.mode === "count" ? "count" : "density";
  const count = typeof input.count === "number" ? Math.max(0, Math.floor(input.count)) : 0;
  const seedRaw = typeof input.seed === "number" ? Math.floor(input.seed) : 0;
  const noiseSeed = (seedRaw === 0 ? Date.now() : seedRaw) >>> 0;

  const out: Grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  if (mode === "count") {
    // 复刻老 fillNoiseCount：按 hashNoise 值降序取前 N
    const cells: { r: number; c: number; n: number }[] = [];
    for (let r = 0; r < rows; r++) {
      const row = region[r];
      for (let c = 0; c < cols; c++) {
        if ((row[c] ?? 0) === 0) continue;
        cells.push({ r, c, n: hashNoise(r, c, noiseSeed) });
      }
    }
    cells.sort((a, b) => b.n - a.n);
    const n = Math.min(count, cells.length);
    if (n <= 0) return { region: out, count: 0 };
    for (let i = 0; i < n; i++) {
      out[cells[i].r][cells[i].c] = 1;
    }
    return { region: out, count: n };
  }

  // mode === "density"：阈值二值化（向后兼容）
  const threshold = 1 - density;
  let count2 = 0;
  for (let r = 0; r < rows; r++) {
    const row = region[r];
    for (let c = 0; c < cols; c++) {
      if ((row[c] ?? 0) === 0) continue;
      if (hashNoise(r, c, noiseSeed) > threshold) {
        out[r][c] = 1;
        count2++;
      }
    }
  }

  return { region: out, count: count2 };
}
