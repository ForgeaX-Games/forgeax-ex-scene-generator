/**
 * noise.ts — 轻量分形值噪声实现，无外部依赖
 * 使用 LCG 伪随机 + 双线性插值，效果接近柏林噪声
 */

export class LCG {
  private state: number;
  constructor(seed: number) {
    this.state = (seed === 0 ? Date.now() : seed) >>> 0;
    if (this.state === 0) this.state = 0x6d2b79f5;
  }
  next(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }
}

/** 构建一张随机梯度表（256 个 [0,1) 值） */
function buildGradTable(rng: LCG): Float32Array {
  const table = new Float32Array(256);
  for (let i = 0; i < 256; i++) table[i] = rng.next();
  return table;
}

/** 平滑插值（fade 曲线：6t^5 - 15t^4 + 10t^3） */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

/**
 * 单层值噪声，返回 [0, 1) 的浮点值
 * nx / ny 是归一化坐标（[0, 1] 范围）乘以频率
 */
function valueNoise(nx: number, ny: number, table: Float32Array): number {
  const xi = Math.floor(nx);
  const yi = Math.floor(ny);
  const xf = nx - xi;
  const yf = ny - yi;

  const sx = fade(xf);
  const sy = fade(yf);

  const idx = (x: number, y: number) => ((x & 255) * 131 + (y & 255) * 97) & 255;

  const v00 = table[idx(xi, yi)];
  const v10 = table[idx(xi + 1, yi)];
  const v01 = table[idx(xi, yi + 1)];
  const v11 = table[idx(xi + 1, yi + 1)];

  return lerp(lerp(v00, v10, sx), lerp(v01, v11, sx), sy);
}

/**
 * 分形噪声（fBm）：多层叠加
 * @param nx          归一化 x（col / width）
 * @param ny          归一化 y（row / height）
 * @param scale       基础频率倍率（越大噪声越细碎）
 * @param octaves     叠加层数
 * @param persistence 每层振幅衰减系数（0–1）
 * @param table       梯度表
 * @returns           [0, 1) 的浮点值
 */
export function fbmNoise(
  nx: number,
  ny: number,
  scale: number,
  octaves: number,
  persistence: number,
  table: Float32Array,
): number {
  let value = 0;
  let amplitude = 1;
  let totalAmp = 0;
  let freq = scale;

  for (let o = 0; o < octaves; o++) {
    value += valueNoise(nx * freq, ny * freq, table) * amplitude;
    totalAmp += amplitude;
    amplitude *= persistence;
    freq *= 2;
  }

  return value / totalAmp;
}

/**
 * 生成完整的密度场网格
 * @param width       格子列数
 * @param height      格子行数
 * @param scale       基础噪声频率（推荐 4–16；越小区域越大）
 * @param octaves     层数（推荐 3–5）
 * @param persistence 衰减（推荐 0.4–0.6）
 * @param polarize    幂次极化指数（越大两极分化越剧烈，推荐 2–5）
 * @param rng         随机数生成器
 * @returns           整数网格，值域 0–100
 */
export function buildDensityField(
  width: number,
  height: number,
  scale: number,
  octaves: number,
  persistence: number,
  polarize: number,
  rng: LCG,
): number[][] {
  const table = buildGradTable(rng);
  const grid: number[][] = [];

  for (let row = 0; row < height; row++) {
    const rowArr: number[] = new Array(width);
    for (let col = 0; col < width; col++) {
      const nx = col / width;
      const ny = row / height;
      const raw = fbmNoise(nx, ny, scale, octaves, persistence, table);
      // 幂函数极化：将连续分布压向两极
      const polarized = Math.pow(raw, polarize);
      rowArr[col] = Math.round(polarized * 100);
    }
    grid.push(rowArr);
  }

  return grid;
}
