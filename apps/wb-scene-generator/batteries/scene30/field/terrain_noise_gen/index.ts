/**
 * terrain_noise_gen: 基于 FBM 噪声生成野外地形网格
 *
 * 算法概述：
 *   1. LCG 伪随机数生成器提供可复现的种子序列
 *   2. 值噪声（Value Noise）：将网格随机化后双线性插值获得连续噪声场
 *   3. FBM（分形布朗运动）：4 层 Octave 叠加，每层频率翻倍、振幅减半
 *   4. 阈值分段：noise < waterThresh → 水(1)；< sandThresh → 沙(2)；其余 → 草(3)
 *
 * 输入：seed (number) — 随机种子；width/height (number) — 地图尺寸
 *       scale (number) — 噪声频率；waterThresh/sandThresh (number) — 地形阈值
 * 输出：terrainGrid (grid) — 二维地形网格（1=水/2=沙/3=草）
 */

type Grid = number[][];

/** LCG 线性同余随机数生成器，保证相同 seed 产出相同序列 */
class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed === 0 ? Date.now() : seed;
    // 预热消除初始相关性
    for (let i = 0; i < 10; i++) this.next();
  }

  next(): number {
    this.state = (this.state * 1664525 + 1013904223) & 0xffffffff;
    return (this.state >>> 0) / 0x100000000;
  }
}

/**
 * 构建值噪声置换表：将格子随机化为 0~1 的随机值
 * 使用 tableSize x tableSize 的值表，超出范围时取模循环
 */
function buildValueTable(rng: SeededRandom, tableSize: number): number[][] {
  const table: number[][] = [];
  for (let r = 0; r < tableSize; r++) {
    table[r] = [];
    for (let c = 0; c < tableSize; c++) {
      table[r][c] = rng.next();
    }
  }
  return table;
}

/** 双线性插值辅助：平滑步进曲线 */
function smoothStep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 从值表中双线性插值采样噪声值，坐标超出范围时取模循环 */
function sampleNoise(table: number[][], tableSize: number, x: number, y: number): number {
  const x0 = Math.floor(x) & (tableSize - 1);
  const y0 = Math.floor(y) & (tableSize - 1);
  const x1 = (x0 + 1) & (tableSize - 1);
  const y1 = (y0 + 1) & (tableSize - 1);

  const tx = smoothStep(x - Math.floor(x));
  const ty = smoothStep(y - Math.floor(y));

  const v00 = table[y0][x0];
  const v10 = table[y0][x1];
  const v01 = table[y1][x0];
  const v11 = table[y1][x1];

  return v00 * (1 - tx) * (1 - ty) +
         v10 * tx * (1 - ty) +
         v01 * (1 - tx) * ty +
         v11 * tx * ty;
}

/**
 * FBM（分形布朗运动）：多层 Octave 叠加
 * 每层频率翻倍（lacunarity=2）、振幅减半（gain=0.5）
 * 结果归一化到 0~1
 */
function fbm(
  table: number[][],
  tableSize: number,
  x: number,
  y: number,
  octaves: number
): number {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;

  for (let i = 0; i < octaves; i++) {
    value += sampleNoise(table, tableSize, x * frequency, y * frequency) * amplitude;
    maxValue += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }

  return value / maxValue;
}

export function terrainNoiseGen(input: Record<string, unknown>): Record<string, unknown> {
  const seed = typeof input.seed === "number" ? input.seed : 0;

  if (typeof input.width !== "number" || typeof input.height !== "number") {
    return { error: "width and height are required" };
  }

  const width = Math.max(1, Math.floor(input.width));
  const height = Math.max(1, Math.floor(input.height));
  const scale = typeof input.scale === "number" && input.scale > 0 ? input.scale : 0.05;
  const waterThresh = typeof input.waterThresh === "number" ? input.waterThresh : 0.35;
  const sandThresh = typeof input.sandThresh === "number" ? input.sandThresh : 0.45;

  if (waterThresh >= sandThresh) {
    return { error: "waterThresh must be less than sandThresh" };
  }

  const rng = new SeededRandom(seed);
  // 值表尺寸必须是 2 的幂，取不小于 max(width, height) 的最小 2 的幂，上限 256
  const tableSize = Math.min(256, nextPowerOfTwo(Math.max(width, height)));
  const table = buildValueTable(rng, tableSize);

  const terrainGrid: Grid = [];
  for (let row = 0; row < height; row++) {
    terrainGrid[row] = [];
    for (let col = 0; col < width; col++) {
      const noiseVal = fbm(table, tableSize, col * scale, row * scale, 4);

      let terrain: number;
      if (noiseVal < waterThresh) {
        terrain = 1; // 水系
      } else if (noiseVal < sandThresh) {
        terrain = 2; // 沙滩
      } else {
        terrain = 3; // 草地
      }
      terrainGrid[row][col] = terrain;
    }
  }

  return { terrainGrid };
}

/** 求不小于 n 的最小 2 的幂 */
function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}
