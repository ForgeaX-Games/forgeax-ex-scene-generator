/**
 * tessEdgeDeform: 镶嵌格边界变形
 *
 * 对镶嵌格（hexGrid / triGrid / 任意 regionGrid）的边界施加 FBM 位移场变形：
 * 对每个像素 (x, y)，计算位移 (dx, dy)，再查询 (x+dx, y+dy) 处的原始单元 ID，
 * 使得边界从直线变为有机曲线，且整体镶嵌拓扑不被破坏。
 *
 * FBM 位移场：多层 Value Noise 叠加（与原单元 ID 完全解耦）
 */

// ─── LCG 随机数 ──────────────────────────────────────────────────────────────

class LCG {
  private state: bigint;
  constructor(seed: number) {
    const s = Math.abs(Math.round(seed)) % 2147483647 || 12345;
    this.state = BigInt(s);
  }
  next(): bigint {
    this.state =
      (this.state * 6364136223846793005n + 1442695040888963407n) &
      0xffffffffffffffffn;
    return this.state;
  }
  float64(): number {
    return Number(this.next() & 0xffffffffn) / 0xffffffff;
  }
}

// ─── Value Noise（晶格插值）────────────────────────────────────────────────────

function hash2(ix: number, iy: number, seed: number): number {
  let h =
    Math.imul(ix | 0, 1619) ^
    Math.imul(iy | 0, 31337) ^
    Math.imul((seed | 0) % 99991, 1013904223);
  h = Math.imul(h ^ (h >>> 13), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 15), 0xc4ceb9fe);
  return ((h >>> 0) / 4294967296) * 2 - 1; // [-1, 1]
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = smoothstep(fx), uy = smoothstep(fy);

  const v00 = hash2(ix,     iy,     seed);
  const v10 = hash2(ix + 1, iy,     seed);
  const v01 = hash2(ix,     iy + 1, seed);
  const v11 = hash2(ix + 1, iy + 1, seed);

  return v00 + (v10 - v00) * ux
       + (v01 - v00) * uy
       + (v00 - v10 - v01 + v11) * ux * uy;
}

// ─── FBM（分形布朗运动）──────────────────────────────────────────────────────

function fbm(x: number, y: number, octaves: number, seedX: number, seedY: number): [number, number] {
  let dx = 0, dy = 0;
  let amp = 1, freq = 1, total = 0;
  for (let i = 0; i < octaves; i++) {
    const octSeedX = seedX + Math.imul(i, 7919);
    const octSeedY = seedY + Math.imul(i, 6271);
    dx += valueNoise(x * freq, y * freq, octSeedX) * amp;
    dy += valueNoise(x * freq, y * freq, octSeedY) * amp;
    total += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return [dx / total, dy / total];
}

// ─── 主导出函数 ──────────────────────────────────────────────────────────────

export function tessEdgeDeform(
  input: Record<string, unknown>
): Record<string, unknown> {
  const regionGrid = input.regionGrid as number[][] | undefined;
  if (!regionGrid || !regionGrid.length) {
    return { error: "regionGrid is required" };
  }

  const h = regionGrid.length;
  const w = regionGrid[0].length;

  const warpScale = typeof input.warpScale === "number" ? Math.max(0, input.warpScale) : 3;
  const warpFreq  = typeof input.warpFreq  === "number" ? Math.max(0.001, input.warpFreq) : 0.1;
  const octaves   = typeof input.octaves   === "number" ? Math.max(1, Math.min(6, Math.round(input.octaves))) : 3;
  const seedRaw   = typeof input.seed      === "number" ? Math.round(input.seed) : 0;
  const baseSeed  = seedRaw === 0 ? Date.now() : seedRaw;

  const rng = new LCG(baseSeed);
  const seedX = Math.round(rng.float64() * 99991);
  const seedY = Math.round(rng.float64() * 99991);

  const warpedGrid: number[][] = Array.from({ length: h }, () => new Array(w).fill(0));

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [dx, dy] = fbm(x * warpFreq, y * warpFreq, octaves, seedX, seedY);

      const sx = Math.round(x + dx * warpScale);
      const sy = Math.round(y + dy * warpScale);

      // 钳制到边界内（边缘使用原值）
      const cx = Math.max(0, Math.min(w - 1, sx));
      const cy = Math.max(0, Math.min(h - 1, sy));

      warpedGrid[y][x] = regionGrid[cy][cx];
    }
  }

  return { warpedGrid };
}
