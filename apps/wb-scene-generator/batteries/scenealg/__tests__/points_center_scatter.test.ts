/**
 * alg_points_center_scatter 回归测试
 */
import { describe, it, expect } from "vitest";

import { pointsCenterScatter } from "../points/points_center_scatter/index.ts";

type Grid = number[][];

function fullGrid(rows: number, cols: number, v = 1): Grid {
  return Array.from({ length: rows }, () => new Array<number>(cols).fill(v));
}

function countOnes(grid: Grid): number {
  let n = 0;
  for (const row of grid) for (const v of row) if (v === 1) n++;
  return n;
}

describe("alg_points_center_scatter", () => {
  it("在半径内采样 count 个单点网格", () => {
    const region = fullGrid(20, 20);
    const out = pointsCenterScatter({
      region,
      point: { x: 10, y: 10 },
      count: 6,
      scatterRadius: 5,
      seed: 42,
    });
    const points = out.points as Grid[];
    expect(points.length).toBe(out.count);
    expect(points.length).toBeGreaterThan(0);
    for (const g of points) expect(countOnes(g)).toBe(1);
  });

  it("兴趣点在外部时 BFS 吸附后仍能采样", () => {
    const region = fullGrid(10, 10);
    region[5][5] = 0;
    region[5][6] = 0;
    const out = pointsCenterScatter({
      region,
      point: { x: 5, y: 5 },
      count: 3,
      scatterRadius: 8,
      seed: 7,
    });
    expect((out.points as Grid[]).length).toBeGreaterThan(0);
    expect(out.snappedCenter).toBeTruthy();
  });

  it("相同 seed 可复现", () => {
    const region = fullGrid(16, 16);
    const args = { region, point: { x: 8, y: 8 }, count: 4, scatterRadius: 6, seed: 99 };
    const a = pointsCenterScatter(args).points as Grid[];
    const b = pointsCenterScatter(args).points as Grid[];
    expect(a).toEqual(b);
  });

  it("缺少 region 返回 error", () => {
    expect(pointsCenterScatter({}).error).toBeTruthy();
  });
});
