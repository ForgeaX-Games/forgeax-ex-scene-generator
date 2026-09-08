/**
 * fieldFbmWarp: 用低频 FBM 值噪声对标量场做零均值加性扰动。
 *
 * out(r,c) = clamp0( field(r,c) + (fbm(c*scale, r*scale, seed) - 0.5) * 2 * amplitude )
 *
 * 输入：field (grid)        — 待扰动的标量场（约定：无效格 0、源格 0、不可达 -1）
 *       region (grid)       — 有效范围掩码，非零为有效格
 *       amplitude (number)  — 偏移幅度（与 field 同单位），0 = 原样透传
 *       featureScale        — 噪声空间频率，越小波浪越长
 *       seed (number)       — 0 用当前时间戳
 * 输出：field (grid)        — 同形状标量场
 *
 * 噪声零均值，所以下游阈值的「平均格数」语义不变；只有等值线的形状被打散，
 * 阈值化后不再是与源轮廓平行的等距同心环。field<0（不可达）原样透传，
 * 扰动结果下限截断到 0，保证仍能被 alg_field_threshold 判为近处。
 *
 * FBM 与 zone_nesting_riverbank 同款（4 阶 value noise），保证两处海岸线质感一致。
 */

type Grid = number[][];

function hash2D(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 43758.5453) * 43758.5453;
  return n - Math.floor(n);
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const ux = smoothstep(x - ix), uy = smoothstep(y - iy);
  const a = hash2D(ix, iy, seed);
  const b = hash2D(ix + 1, iy, seed);
  const c = hash2D(ix, iy + 1, seed);
  const d = hash2D(ix + 1, iy + 1, seed);
  return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy;
}

function fbm(x: number, y: number, seed: number): number {
  let value = 0, amplitude = 0.5, frequency = 1, total = 0;
  for (let i = 0; i < 4; i++) {
    value += valueNoise(x * frequency, y * frequency, seed + i * 17) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value / total;
}

export function fieldFbmWarp(input: Record<string, unknown>): Record<string, unknown> {
  const field = input.field as Grid | undefined;
  const region = input.region as Grid | undefined;
  if (!field || field.length === 0 || (field[0]?.length ?? 0) === 0) {
    return { error: "field is required" };
  }
  if (!region || region.length === 0 || (region[0]?.length ?? 0) === 0) {
    return { error: "region is required" };
  }

  const rows = field.length;
  const cols = field[0].length;
  if (region.length !== rows || (region[0]?.length ?? 0) !== cols) {
    return { error: "field and region must have the same shape" };
  }

  const amplitude = typeof input.amplitude === "number" ? Math.max(0, input.amplitude) : 2.5;
  const featureScale = typeof input.featureScale === "number" && input.featureScale > 0
    ? input.featureScale
    : 0.08;
  const rawSeed = typeof input.seed === "number" ? Math.floor(input.seed) : 0;
  const seed = rawSeed === 0 ? (Date.now() & 0x7fffffff) : rawSeed;

  const out: Grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if ((region[r]?.[c] ?? 0) === 0) continue;
      const v = field[r]?.[c] ?? 0;
      if (v < 0) { out[r][c] = v; continue; } // 不可达格原样透传
      if (amplitude === 0) { out[r][c] = v; continue; }
      const offset = (fbm(c * featureScale, r * featureScale, seed) - 0.5) * 2 * amplitude;
      const warped = v + offset;
      out[r][c] = warped > 0 ? warped : 0;
    }
  }

  return { field: out };
}
