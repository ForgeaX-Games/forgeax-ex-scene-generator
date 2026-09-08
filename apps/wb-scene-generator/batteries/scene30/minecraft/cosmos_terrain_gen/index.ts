/**
 * cosmos_terrain_gen: 使用warped simplex FBM生成地形高度图+温度图+湿度图
 * 输入：inputGrid (grid[] | grid) — 用于推断尺寸的网格，列表中取第一个；seed, noiseScale, warpStrength
 * 输出：outputGridList — [ elevationGrid, temperatureGrid, moistureGrid ] 三张单值网格
 *        outputNameList — 三张网格对应的名称条目 [{id,name,type}]
 */

// Simplex Noise 排列表（按种子初始化）
const perm = new Uint8Array(512);
const permMod12 = new Uint8Array(512);
const grad2 = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function initNoise(seed: number): void {
  const p = new Uint8Array(256);
  const rng = mulberry32(seed);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
    permMod12[i] = perm[i] % 8;
  }
}

function dot2(g: number[], x: number, y: number): number {
  return g[0] * x + g[1] * y;
}

function noise2D(x: number, y: number): number {
  const s = (x + y) * F2;
  const i = Math.floor(x + s);
  const j = Math.floor(y + s);
  const t = (i + j) * G2;
  const x0 = x - (i - t);
  const y0 = y - (j - t);
  const i1 = x0 > y0 ? 1 : 0;
  const j1 = x0 > y0 ? 0 : 1;
  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2;
  const y2 = y0 - 1 + 2 * G2;
  const ii = i & 255;
  const jj = j & 255;
  const gi0 = permMod12[ii + perm[jj]];
  const gi1 = permMod12[ii + i1 + perm[jj + j1]];
  const gi2 = permMod12[ii + 1 + perm[jj + 1]];
  let n0 = 0, n1 = 0, n2 = 0;
  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 >= 0) { t0 *= t0; n0 = t0 * t0 * dot2(grad2[gi0], x0, y0); }
  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 >= 0) { t1 *= t1; n1 = t1 * t1 * dot2(grad2[gi1], x1, y1); }
  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 >= 0) { t2 *= t2; n2 = t2 * t2 * dot2(grad2[gi2], x2, y2); }
  return 70 * (n0 + n1 + n2);
}

function fbm(x: number, y: number, octaves: number, persistence: number, lacunarity: number, scale: number): number {
  let total = 0, amplitude = 1, frequency = scale, maxValue = 0;
  for (let i = 0; i < octaves; i++) {
    total += noise2D(x * frequency, y * frequency) * amplitude;
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return total / maxValue;
}

function normalizedFbm(x: number, y: number, octaves: number, persistence: number, lacunarity: number, scale: number): number {
  return (fbm(x, y, octaves, persistence, lacunarity, scale) + 1) * 0.5;
}

/** warped simplex FBM：先用FBM对坐标做域变形，再采样，得到更自然的地形 */
function warpedNoise(x: number, y: number, scale: number, warpScale: number, warpStrength: number): number {
  const warpX = fbm(x, y, 3, 0.5, 2.0, warpScale) * warpStrength;
  const warpY = fbm(x + 5.2, y + 1.3, 3, 0.5, 2.0, warpScale) * warpStrength;
  return normalizedFbm(x + warpX, y + warpY, 4, 0.5, 2.0, scale);
}

/** 将[0,1]浮点值映射到int（0-1000，保留3位小数精度） */
function floatToInt(v: number): number {
  return Math.round(Math.max(0, Math.min(1, v)) * 1000);
}

/** 从inputGrid（列表或单网格）解析宽高，默认64x64 */
function resolveGridSize(inputGrid: unknown): [number, number] {
  if (!Array.isArray(inputGrid) || inputGrid.length === 0) return [64, 64];
  // 列表格式：第一个元素是网格
  const first = inputGrid[0];
  let grid: number[][];
  if (Array.isArray(first) && Array.isArray(first[0])) {
    grid = first as number[][];
  } else if (Array.isArray(first) && typeof first[0] === "number") {
    grid = inputGrid as number[][];
  } else {
    return [64, 64];
  }
  const H = Math.max(1, grid.length);
  const W = Math.max(1, grid[0]?.length ?? 1);
  return [W, H];
}

export function cosmosTerrainGen(input: Record<string, unknown>): Record<string, unknown> {
  const [width, height] = resolveGridSize(input.inputGrid);
  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  const noiseScale = typeof input.noiseScale === "number" ? input.noiseScale : 0.02;
  const warpStrength = typeof input.warpStrength === "number" ? input.warpStrength : 15;

  if (width <= 0 || height <= 0) return { error: "width and height must be positive" };

  const seed = seedRaw === 0 ? Date.now() : seedRaw;
  initNoise(seed);

  const elevationGrid: number[][] = [];
  const temperatureGrid: number[][] = [];
  const moistureGrid: number[][] = [];

  for (let y = 0; y < height; y++) {
    elevationGrid[y] = [];
    temperatureGrid[y] = [];
    moistureGrid[y] = [];
    for (let x = 0; x < width; x++) {
      const elevation = warpedNoise(x, y, noiseScale, noiseScale * 0.5, warpStrength);
      const temperature = normalizedFbm(x + 1000, y + 1000, 2, 0.5, 2.0, 0.01);
      const moisture = normalizedFbm(x + 2000, y + 2000, 2, 0.5, 2.0, 0.008);

      elevationGrid[y][x] = floatToInt(elevation);
      temperatureGrid[y][x] = floatToInt(temperature);
      moistureGrid[y][x] = floatToInt(moisture);
    }
  }

  return { elevationGrid, temperatureGrid, moistureGrid };
}
