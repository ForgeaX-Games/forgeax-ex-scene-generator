/**
 * fieldMountainContour: 在输入 region 的有效格上生成 [0,1] 山地高度标量场。
 *
 * 核心算法来自 scene30/mountain/mountain_contour_generate：
 *   1. Domain-warped FBM 有机底形
 *   2. 多峰高斯增益
 *   3. 等面积分位数重映射（每层占有相近格数）
 *
 * 输入：region (grid) — 父区域掩码，仅对非 0 格生成高度
 * 输出：field (grid) — [0,1] 连续高度场，region 外 = 0
 */

type Grid = number[][];

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
  return fbm(x + dx * warpStrength, y + dy * warpStrength, seed, octaves);
}

/** Place peaks on valid mask cells (normalized to full grid). Avoids
 *  sampling in empty bbox corners when region is an irregular island/Far band. */
function samplePeakCentersOnMask(
  count: number,
  rng: SeededRandom,
  nonZeroIndices: number[],
  width: number,
  height: number,
): { x: number; y: number }[] {
  if (nonZeroIndices.length === 0) return [{ x: 0.5, y: 0.5 }];
  const minDist = clamp(0.6 / Math.sqrt(count), 0.18, 0.4);
  const placed: { x: number; y: number }[] = [];
  const toNorm = (idx: number) => {
    const y = Math.floor(idx / width);
    const x = idx % width;
    return {
      x: width > 1 ? x / (width - 1) : 0.5,
      y: height > 1 ? y / (height - 1) : 0.5,
    };
  };

  for (let i = 0; i < count; i++) {
    let best = toNorm(nonZeroIndices[Math.floor(rng.next() * nonZeroIndices.length)]!);
    let bestScore = -1;
    for (let t = 0; t < 400; t++) {
      const c = toNorm(nonZeroIndices[Math.floor(rng.next() * nonZeroIndices.length)]!);
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

/** Chebyshev-ish BFS distance (in cells) from each valid cell to the region edge
 *  (invalid neighbor or out of bounds). Edge cells get 0. */
function distanceToRegionEdge(
  nonZeroMask: Uint8Array,
  width: number,
  height: number,
): Float64Array {
  const dist = new Float64Array(width * height);
  dist.fill(Infinity);
  const qx: number[] = [];
  const qy: number[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!nonZeroMask[idx]) continue;
      let edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      if (!edge) {
        if (
          !nonZeroMask[idx - 1] ||
          !nonZeroMask[idx + 1] ||
          !nonZeroMask[idx - width] ||
          !nonZeroMask[idx + width]
        ) {
          edge = true;
        }
      }
      if (edge) {
        dist[idx] = 0;
        qx.push(x);
        qy.push(y);
      }
    }
  }

  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;
  let head = 0;
  while (head < qx.length) {
    const x = qx[head]!;
    const y = qy[head]!;
    head++;
    const base = dist[y * width + x]!;
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const nidx = ny * width + nx;
      if (!nonZeroMask[nidx]) continue;
      const nd = base + 1;
      if (nd < dist[nidx]!) {
        dist[nidx] = nd;
        qx.push(nx);
        qy.push(ny);
      }
    }
  }
  return dist;
}

function gaussianPeak(wx: number, wy: number, cx: number, cy: number, radius: number): number {
  const dx = (wx - cx) / radius;
  const dy = (wy - cy) / radius;
  return Math.exp(-2.0 * (dx * dx + dy * dy));
}

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

export function fieldMountainContour(input: Record<string, unknown>): Record<string, unknown> {
  const region = input.region as Grid | undefined;
  if (!region || region.length === 0 || (region[0]?.length ?? 0) === 0) {
    return { error: "region is required" };
  }

  const height = region.length;
  const width = region[0].length;

  const peakCount =
    typeof input.peakCount === "number" ? Math.max(1, Math.round(input.peakCount)) : 3;
  const peakRadius =
    typeof input.peakRadius === "number" ? clamp(input.peakRadius, 0.03, 0.5) : 0.14;
  const peakStrength =
    typeof input.peakStrength === "number" ? clamp(input.peakStrength, 0.1, 4.0) : 1.2;
  const noiseScale =
    typeof input.noiseScale === "number" ? clamp(input.noiseScale, 0.5, 8) : 2.5;
  const warpStrength =
    typeof input.warpStrength === "number" ? clamp(input.warpStrength, 0, 3) : 1.2;
  const seed = typeof input.seed === "number" ? input.seed : 0;
  // Soft rise from the region perimeter (cells). 0 = off. Default ~6 so
  // Contours feather instead of truncating at a hard mask edge.
  const edgeFalloffCells =
    typeof input.edgeFalloffCells === "number"
      ? Math.max(0, Math.round(input.edgeFalloffCells))
      : 6;

  const rng = new SeededRandom(seed);
  const warpScale = noiseScale * 0.6;

  const nonZeroMask = new Uint8Array(width * height);
  const nonZeroIndices: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((region[y]?.[x] ?? 0) !== 0) {
        const idx = y * width + x;
        nonZeroMask[idx] = 1;
        nonZeroIndices.push(idx);
      }
    }
  }

  const field: Grid = Array.from({ length: height }, () => new Array<number>(width).fill(0));
  if (nonZeroIndices.length === 0) {
    return { field };
  }

  const peakCenters = samplePeakCentersOnMask(peakCount, rng, nonZeroIndices, width, height);
  const edgeDist =
    edgeFalloffCells > 0 ? distanceToRegionEdge(nonZeroMask, width, height) : null;

  const raw = new Float64Array(width * height);
  for (let y = 0; y < height; y++) {
    const ny = height > 1 ? y / (height - 1) : 0;
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!nonZeroMask[idx]) continue;
      const nx = width > 1 ? x / (width - 1) : 0;
      const sx = nx * noiseScale;
      const sy = ny * noiseScale;
      const terrain = warpedFbm(sx, sy, seed, 6, warpStrength, warpScale / noiseScale);

      const dxW =
        (fbm(sx * 0.6 + 1.7, sy * 0.6 + 9.2, seed + 1000, 4) * 2 - 1) * warpStrength * 0.15;
      const dyW =
        (fbm(sx * 0.6 + 8.3, sy * 0.6 + 2.8, seed + 2000, 4) * 2 - 1) * warpStrength * 0.15;
      const wnx = nx + dxW;
      const wny = ny + dyW;

      let peakBoost = 0;
      for (const c of peakCenters) {
        peakBoost += gaussianPeak(wnx, wny, c.x, c.y, peakRadius);
      }
      peakBoost = Math.tanh(peakBoost * 1.2) * peakStrength;
      let h = terrain * 0.4 + peakBoost * 0.6;
      if (edgeDist) {
        const d = edgeDist[idx]!;
        const t = edgeFalloffCells <= 0 ? 1 : fade(d / edgeFalloffCells);
        h *= t;
      }
      raw[idx] = h;
    }
  }

  const nonZeroRaw = new Float64Array(nonZeroIndices.length);
  for (let k = 0; k < nonZeroIndices.length; k++) {
    nonZeroRaw[k] = raw[nonZeroIndices[k]!];
  }
  const remappedNonZero = equalAreaRemap(normalizeFlat(nonZeroRaw));

  for (let k = 0; k < nonZeroIndices.length; k++) {
    const idx = nonZeroIndices[k]!;
    const y = Math.floor(idx / width);
    const x = idx % width;
    field[y][x] = remappedNonZero[k]!;
  }

  return { field };
}
