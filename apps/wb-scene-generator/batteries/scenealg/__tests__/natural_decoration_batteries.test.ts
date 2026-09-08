/**
 * natural_decoration 一线新增原子电池的核心算法回归测试：
 *   - alg_region_cluster_scatter : 簇状散布，density=0 全空、点只落在有效格、可复现
 *   - alg_region_noise_fill      : 噪声阈值填充，density=1 满铺、density=0 全空、确定性、只落在有效格
 */
import { describe, it, expect } from "vitest";

import { regionClusterScatter } from "../Region/region_cluster_scatter/index.ts";
import { regionNoiseFill } from "../Region/region_noise_fill/index.ts";

type Grid = number[][];

function fullGrid(rows: number, cols: number, v = 1): Grid {
  return Array.from({ length: rows }, () => new Array<number>(cols).fill(v));
}

function countNonZero(g: Grid): number {
  let n = 0;
  for (const row of g) for (const v of row) if (v !== 0) n++;
  return n;
}

describe("alg_region_cluster_scatter", () => {
  it("density=0 全空；其余密度下点只落在有效格内", () => {
    const region = fullGrid(40, 40, 0);
    for (let r = 5; r < 25; r++) for (let c = 5; c < 25; c++) region[r][c] = 1;

    const empty = regionClusterScatter({ region, density: 0, seed: 5 });
    expect(empty.count).toBe(0);
    expect(countNonZero(empty.region as Grid)).toBe(0);

    const out = regionClusterScatter({ region, density: 0.3, clusterRadius: 4, seed: 12345 });
    const g = out.region as Grid;
    expect(out.count as number).toBeGreaterThan(0);
    for (let r = 0; r < 40; r++)
      for (let c = 0; c < 40; c++)
        if (region[r][c] === 0) expect(g[r][c]).toBe(0);
    expect(countNonZero(g)).toBe(out.count);
  });

  it("count 大致受目标格数（density × 有效格数）约束", () => {
    const region = fullGrid(50, 50);
    const density = 0.25;
    const radius = 5;
    const out = regionClusterScatter({ region, density, clusterRadius: radius, seed: 7 });
    const target = Math.round(50 * 50 * density);
    // 截停判断在每个簇心完成后才检查（与老电池一致），故最后一个簇可能略微超出目标；
    // 余量上界约为一个簇内圆盘的格数。
    const slack = Math.ceil(Math.PI * (radius + 1) * (radius + 1));
    expect(out.count as number).toBeLessThanOrEqual(target + slack);
    expect(out.count as number).toBeGreaterThan(0);
  });

  it("给定 seed 可复现", () => {
    const a = regionClusterScatter({ region: fullGrid(30, 30), density: 0.3, clusterRadius: 4, seed: 88 });
    const b = regionClusterScatter({ region: fullGrid(30, 30), density: 0.3, clusterRadius: 4, seed: 88 });
    expect(a.region).toEqual(b.region);
    expect(a.count).toBe(b.count);
  });
});

describe("alg_region_noise_fill", () => {
  it("density=1 满铺、density=0 全空（仅在有效格内）", () => {
    const region = fullGrid(10, 10, 0);
    for (let r = 2; r < 8; r++) for (let c = 2; c < 8; c++) region[r][c] = 1;

    const full = regionNoiseFill({ region, density: 1, seed: 5 });
    expect(full.count).toBe(36);
    const fg = full.region as Grid;
    for (let r = 0; r < 10; r++)
      for (let c = 0; c < 10; c++)
        if (region[r][c] === 0) expect(fg[r][c]).toBe(0);

    const empty = regionNoiseFill({ region, density: 0, seed: 5 });
    expect(empty.count).toBe(0);
    expect(countNonZero(empty.region as Grid)).toBe(0);
  });

  it("中间密度：保留格数在合理区间且只落在有效格", () => {
    const region = fullGrid(40, 40);
    const out = regionNoiseFill({ region, density: 0.5, seed: 12345 });
    const n = out.count as number;
    expect(n).toBeGreaterThan(1600 * 0.4);
    expect(n).toBeLessThan(1600 * 0.6);
  });

  it("同坐标同 seed 结果确定（与运行时间无关）", () => {
    const a = regionNoiseFill({ region: fullGrid(30, 30), density: 0.3, seed: 777 });
    const b = regionNoiseFill({ region: fullGrid(30, 30), density: 0.3, seed: 777 });
    expect(a.region).toEqual(b.region);
    expect(a.count).toBe(b.count);
  });
});
