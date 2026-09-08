/**
 * deeperDensityField: 生成深层空间密度场
 * 输入：width/height (number) — 网格尺寸; scale/octaves/persistence (number) — 分形参数;
 *       polarize (number) — 极化指数; seed (number) — 随机种子
 * 输出：densityGrid (grid) — 密度权重图 0–100; groundGrid (grid) — 全1地面底图
 */

import { LCG, buildDensityField } from "./noise.js";

export function deeperDensityField(input: Record<string, unknown>): Record<string, unknown> {
  const width      = typeof input.width      === "number" ? Math.max(8, Math.round(input.width))      : 64;
  const height     = typeof input.height     === "number" ? Math.max(8, Math.round(input.height))     : 64;
  const scale      = typeof input.scale      === "number" ? Math.max(1, input.scale)                  : 8;
  const octaves    = typeof input.octaves    === "number" ? Math.min(8, Math.max(1, Math.round(input.octaves))) : 4;
  const persistence = typeof input.persistence === "number" ? Math.min(1, Math.max(0.1, input.persistence))    : 0.5;
  const polarize   = typeof input.polarize   === "number" ? Math.max(0.5, input.polarize)             : 3.0;
  const seedRaw    = typeof input.seed       === "number" ? input.seed                                 : 0;

  const baseSeed = seedRaw === 0 ? Date.now() : seedRaw;
  const rng = new LCG(baseSeed);

  const densityGrid = buildDensityField(width, height, scale, octaves, persistence, polarize, rng);

  // 全 1 地面底图（所有格子均为可用地面）
  const groundGrid: number[][] = Array.from({ length: height }, () => new Array(width).fill(1));

  return { densityGrid, groundGrid };
}
