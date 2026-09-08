/**
 * mountainContourGenerate
 *
 * 生成策略：
 *   1. Domain-warped FBM：先用两路 FBM 对采样坐标做扭曲，再采样主 FBM，
 *      得到有机不规则的地形——等高线不会是圆或椭圆，而是参考图那样流动的曲线。
 *   2. 多峰高斯增益（同样经过域扭曲坐标）：山峰自然融入地形，不孤立。
 *   3. 等面积重映射：对归一化高度场做分位数拉伸，使每层占有相近的格子数，
 *      解决低层面积巨大、高层面积极小的问题。
 *
 * 输入：
 *   grid           (grid)         — 输入掩码网格，仅对非 0 格子生成等高线
 *
 * 输出：
 *   contourLayers  (array<grid>) — 每层填充 mask，值=层序号(1-based)，其余=0
 *   heightGrid     (grid)        — 0~100 连续高度场（重映射后），0 格子保持 0
 *   outputNameList (array)       — 各层名称清单
 */

type Grid = number[][];
type NameEntry = { id: number; name: string };
type Point = { x: number; y: number };

// ─── PRNG ─────────────────────────────────────────────────────────────────────

class SeededRandom {
  private s: number;

  constructor(seed: number) {
    this.s = seed === 0 ? Date.now() >>> 0 : (Math.abs(Math.round(seed)) >>> 0) || 1;
    for (let i = 0; i < 8; i++) this.next();
  }

  next(): number {
    this.s = (this.s * 1664525 + 1013904223) >>> 0;
    return this.s / 0xffffffff;
  }
}

// ─── 数学工具 ──────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function fade(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

// ─── Value Noise ───────────────────────────────────────────────────────────────

function hash(ix: number, iy: number, seed: number): number {
  let n = (ix * 374761393 + iy * 668265263 + seed * 69069) | 0;
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 1274126177) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 0xffffffff;
}

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = fade(x - x0);
  const ty = fade(y - y0);
  return lerp(
    lerp(hash(x0, y0, seed), hash(x0 + 1, y0, seed), tx),
    lerp(hash(x0, y0 + 1, seed), hash(x0 + 1, y0 + 1, seed), tx),
    ty
  );
}

function fbm(x: number, y: number, seed: number, octaves: number, lacunarity = 2.0, gain = 0.5): number {
  let total = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxAmplitude = 0;
  for (let i = 0; i < octaves; i++) {
    total += valueNoise(x * frequency, y * frequency, seed + i * 97) * amplitude;
    maxAmplitude += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return maxAmplitude > 0 ? total / maxAmplitude : 0;
}

/**
 * Domain-warped FBM：
 * 先用两路独立 FBM 采样得到偏移量 (dx, dy)，
 * 再用扭曲后的坐标 (x+dx, y+dy) 采样主地形 FBM。
 * 结果：等高线呈流动、有机的不规则形状，类似参考图。
 *
 * warpStrength 控制扭曲幅度，0=无扭曲（圆形山），1.5=强扭曲（有机流动）
 */
function warpedFbm(
  x: number,
  y: number,
  seed: number,
  octaves: number,
  warpStrength: number,
  warpScale: number
): number {
  const dx = fbm(x * warpScale + 1.7, y * warpScale + 9.2, seed + 1000, 4) * 2 - 1;
  const dy = fbm(x * warpScale + 8.3, y * warpScale + 2.8, seed + 2000, 4) * 2 - 1;

  const wx = x + dx * warpStrength;
  const wy = y + dy * warpStrength;

  return fbm(wx, wy, seed, octaves);
}

// ─── 山峰采样 ──────────────────────────────────────────────────────────────────

function samplePeakCenters(count: number, rng: SeededRandom): Point[] {
  const margin = 0.15;
  const minDist = clamp(0.6 / Math.sqrt(count), 0.18, 0.4);
  const placed: Point[] = [];

  for (let i = 0; i < count; i++) {
    let best: Point = { x: 0.5, y: 0.5 };
    let bestScore = -1;

    for (let t = 0; t < 300; t++) {
      const c = {
        x: lerp(margin, 1 - margin, rng.next()),
        y: lerp(margin, 1 - margin, rng.next()),
      };
      let nearest = Infinity;
      for (const p of placed) {
        const d = Math.hypot(c.x - p.x, c.y - p.y);
        if (d < nearest) nearest = d;
      }
      if (placed.length === 0 || nearest >= minDist) {
        best = c;
        break;
      }
      if (nearest > bestScore) {
        best = c;
        bestScore = nearest;
      }
    }
    placed.push(best);
  }

  return placed;
}

/**
 * 高斯峰增益：用经过域扭曲坐标的距离计算，使峰形也不规则。
 */
function gaussianPeak(
  wx: number, wy: number,
  cx: number, cy: number,
  radius: number
): number {
  const dx = (wx - cx) / radius;
  const dy = (wy - cy) / radius;
  return Math.exp(-2.0 * (dx * dx + dy * dy));
}

// ─── 高度场归一化 ──────────────────────────────────────────────────────────────

function normalizeFlat(values: Float64Array): Float64Array {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < values.length; i++) {
    if (values[i] < lo) lo = values[i];
    if (values[i] > hi) hi = values[i];
  }
  const span = hi - lo;
  if (span < 1e-8) return new Float64Array(values.length).fill(0);
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = (values[i] - lo) / span;
  return out;
}

/**
 * 等面积重映射（分位数拉伸）：
 * 对高度值排序，将每个像素的高度替换为其在全局的排名比例。
 * 效果：整个 0~1 范围被均匀使用，每层等高段对应相近的格子数。
 */
function equalAreaRemap(values: Float64Array): Float64Array {
  const n = values.length;
  if (n === 0) return new Float64Array(0);
  if (n === 1) return new Float64Array([0]);
  const indices = Array.from({ length: n }, (_, i) => i);
  indices.sort((a, b) => values[a] - values[b]);

  const out = new Float64Array(n);
  for (let rank = 0; rank < n; rank++) {
    out[indices[rank]] = rank / (n - 1);
  }
  return out;
}

// ─── 等高线分层 ────────────────────────────────────────────────────────────────

function levelOf(v: number, totalLevels: number): number {
  if (v >= 1) return totalLevels;
  return Math.floor(v * totalLevels) + 1;
}

// ─── 主导出函数 ────────────────────────────────────────────────────────────────

export function mountainContourGenerate(input: Record<string, unknown>): Record<string, unknown> {
  const grid = Array.isArray(input.grid) ? (input.grid as Grid) : [];
  if (grid.length === 0 || !Array.isArray(grid[0]) || grid[0].length === 0) {
    return { contourLayers: [], heightGrid: [], outputNameList: [] };
  }

  const height = grid.length;
  const width  = grid[0].length;

  const peakCount     = typeof input.peakCount     === "number" ? Math.max(1, Math.round(input.peakCount))       : 3;
  const contourLevels = typeof input.contourLevels === "number" ? Math.max(2, Math.round(input.contourLevels))   : 8;
  const peakRadius    = typeof input.peakRadius    === "number" ? clamp(input.peakRadius, 0.03, 0.5)             : 0.14;
  const peakStrength  = typeof input.peakStrength  === "number" ? clamp(input.peakStrength, 0.1, 2.0)            : 1.2;
  const noiseScale    = typeof input.noiseScale    === "number" ? clamp(input.noiseScale, 0.5, 8)                : 2.5;
  const warpStrength  = typeof input.warpStrength  === "number" ? clamp(input.warpStrength, 0, 3)                : 1.2;
  const seed          = typeof input.seed          === "number" ? input.seed                                      : 0;

  const rng = new SeededRandom(seed);
  const peakCenters = samplePeakCenters(peakCount, rng);

  // ── 构建非零掩码并收集非零格子索引 ──────────────────────────────────────────
  const nonZeroMask = new Uint8Array(width * height);
  const nonZeroIndices: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((grid[y]?.[x] ?? 0) !== 0) {
        const idx = y * width + x;
        nonZeroMask[idx] = 1;
        nonZeroIndices.push(idx);
      }
    }
  }

  if (nonZeroIndices.length === 0) {
    const emptyGrid: Grid = Array.from({ length: height }, () => new Array(width).fill(0));
    return {
      contourLayers: Array.from({ length: contourLevels }, () =>
        Array.from({ length: height }, () => new Array(width).fill(0))
      ),
      heightGrid: emptyGrid,
      outputNameList: Array.from({ length: contourLevels }, (_, i) => ({ id: i + 1, name: `等高线${i + 1}` })),
    };
  }

  const warpScale = noiseScale * 0.6;

  // ── 计算所有格子的原始高度值（非零格子后续参与归一化）──────────────────────
  const raw = new Float64Array(width * height);
  for (let y = 0; y < height; y++) {
    const ny = height > 1 ? y / (height - 1) : 0;
    for (let x = 0; x < width; x++) {
      const nx = width > 1 ? x / (width - 1) : 0;

      const sx = nx * noiseScale;
      const sy = ny * noiseScale;

      const terrain = warpedFbm(sx, sy, seed, 6, warpStrength, warpScale / noiseScale);

      const dxW = (fbm(sx * 0.6 + 1.7, sy * 0.6 + 9.2, seed + 1000, 4) * 2 - 1) * warpStrength * 0.15;
      const dyW = (fbm(sx * 0.6 + 8.3, sy * 0.6 + 2.8, seed + 2000, 4) * 2 - 1) * warpStrength * 0.15;
      const wnx = nx + dxW;
      const wny = ny + dyW;

      let peakBoost = 0;
      for (const c of peakCenters) {
        peakBoost += gaussianPeak(wnx, wny, c.x, c.y, peakRadius);
      }
      peakBoost = Math.tanh(peakBoost * 1.2) * peakStrength;

      raw[y * width + x] = terrain * 0.4 + peakBoost * 0.6;
    }
  }

  // ── 仅对非零格子做归一化与等面积重映射 ──────────────────────────────────────
  const nonZeroRaw = new Float64Array(nonZeroIndices.length);
  for (let k = 0; k < nonZeroIndices.length; k++) {
    nonZeroRaw[k] = raw[nonZeroIndices[k]];
  }

  const normalizedNonZero = normalizeFlat(nonZeroRaw);
  const remappedNonZero   = equalAreaRemap(normalizedNonZero);

  // 将非零格子的重映射值写回全局数组（零格子保持 -1 作为哨兵值）
  const remapped = new Float64Array(width * height).fill(-1);
  for (let k = 0; k < nonZeroIndices.length; k++) {
    remapped[nonZeroIndices[k]] = remappedNonZero[k];
  }

  // ── 连续高度场 (0~100)，零格子保持 0 ──────────────────────────────────────
  const heightGrid: Grid = [];
  for (let y = 0; y < height; y++) {
    const row: number[] = [];
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      row.push(nonZeroMask[idx] ? Math.round(remapped[idx] * 100) : 0);
    }
    heightGrid.push(row);
  }

  // ── 按层提取填充区域列表，零格子保持 0 ────────────────────────────────────
  const contourLayers: Grid[] = [];
  for (let lv = 1; lv <= contourLevels; lv++) {
    const layerGrid: Grid = [];
    for (let y = 0; y < height; y++) {
      const row: number[] = [];
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (nonZeroMask[idx]) {
          row.push(levelOf(remapped[idx], contourLevels) === lv ? lv : 0);
        } else {
          row.push(0);
        }
      }
      layerGrid.push(row);
    }
    contourLayers.push(layerGrid);
  }

  // ── 名称清单 ────────────────────────────────────────────────────────────────
  const outputNameList: NameEntry[] = [];
  for (let lv = 1; lv <= contourLevels; lv++) {
    outputNameList.push({ id: lv, name: `等高线${lv}` });
  }

  return {
    contourLayers,
    heightGrid,
    outputNameList,
  };
}
