
import { describe, it, expect } from "vitest";

import { regionAreaPartition } from "../Partition/region_area_partition/index.ts";

type Grid = number[][];

function fullGrid(rows: number, cols: number, v = 1): Grid {
  return Array.from({ length: rows }, () => new Array<number>(cols).fill(v));
}

function countCells(grid: Grid): number {
  let n = 0;
  for (const row of grid) for (const v of row) if (v !== 0) n++;
  return n;
}

function overlap(a: Grid, b: Grid): number {
  let n = 0;
  for (let r = 0; r < a.length; r++)
    for (let c = 0; c < a[r].length; c++)
      if (a[r][c] !== 0 && b[r][c] !== 0) n++;
  return n;
}

describe("alg_region_area_partition", () => {
  it("按 point2d + areas 产出互不重叠的 partition 列表", () => {
    const region = fullGrid(40, 40);
    const out = regionAreaPartition({
      region,
      points: [{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 30 }],
      areas: [3, 2, 2],
      boundaryStyle: "rectilinear",
      relaxIterations: 3,
      seed: 42,
    });
    const partition = out.partition as Grid[];
    expect(out.count).toBe(3);
    expect(partition.length).toBe(3);

    let covered = 0;
    for (let i = 0; i < partition.length; i++) {
      expect(countCells(partition[i])).toBeGreaterThan(0);
      for (let j = i + 1; j < partition.length; j++) {
        expect(overlap(partition[i], partition[j])).toBe(0);
      }
      covered += countCells(partition[i]);
    }
    expect(covered).toBeGreaterThan(region.length * region[0].length * 0.5);
  });

  it("point2d x→列 y→行", () => {
    const region = fullGrid(20, 20);
    const out = regionAreaPartition({
      region,
      points: [{ x: 5, y: 8 }, { x: 15, y: 8 }],
      areas: [1, 1],
      seed: 1,
    });
    expect(out.count).toBe(2);
  });

  it("positions 九宫格方位可替代 centers", () => {
    const region = fullGrid(30, 30);
    const out = regionAreaPartition({
      region,
      positions: [1, 5, 9],
      areas: [1, 1, 1],
      seed: 99,
    });
    expect(out.count).toBe(3);
  });

  it("给定 seed 可复现", () => {
    const input = {
      region: fullGrid(25, 25),
      points: [{ x: 5, y: 5 }, { x: 20, y: 20 }],
      areas: [2, 1],
      seed: 12345,
    };
    const a = regionAreaPartition(input);
    const b = regionAreaPartition(input);
    expect(a.partition).toEqual(b.partition);
  });

  it("stretch 拉伸系数使分区沿指定轴变长", () => {
    const region = fullGrid(60, 60);
    const points = [{ x: 30, y: 30 }, { x: 5, y: 30 }, { x: 55, y: 30 }, { x: 30, y: 5 }, { x: 30, y: 55 }];
    const areas = [1, 1, 1, 1, 1];
    const bboxOf = (partition: Grid[]) => {
      let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
      for (let r = 0; r < 60; r++) for (let c = 0; c < 60; c++) {
        if (partition[0][r][c]) { minC = Math.min(minC, c); maxC = Math.max(maxC, c); minR = Math.min(minR, r); maxR = Math.max(maxR, r); }
      }
      return { w: maxC - minC + 1, h: maxR - minR + 1 };
    };

    const base = bboxOf(regionAreaPartition({ region, points, areas, relaxIterations: 0, edgeNoise: 0, seed: 7 }).partition as Grid[]);
    const stretched = bboxOf(regionAreaPartition({
      region, points, areas, stretch: [{ x: 4, y: 0.4 }], relaxIterations: 0, edgeNoise: 0, seed: 7,
    }).partition as Grid[]);

    expect(stretched.w / stretched.h).toBeGreaterThan((base.w / base.h) * 1.2);
  });

  it("edgeNoise 扰动后各分区仍互不重叠、完整覆盖", () => {
    const region = fullGrid(50, 50);
    const out = regionAreaPartition({
      region,
      points: [{ x: 10, y: 10 }, { x: 40, y: 10 }, { x: 25, y: 40 }],
      areas: [1, 1, 1],
      edgeNoise: 4,
      seed: 5,
    });
    const partition = out.partition as Grid[];
    let covered = 0;
    for (let i = 0; i < partition.length; i++) {
      for (let j = i + 1; j < partition.length; j++) expect(overlap(partition[i], partition[j])).toBe(0);
      covered += countCells(partition[i]);
    }
    expect(covered).toBeGreaterThan(region.length * region[0].length * 0.9);
  });

  it("空 region 返回空 partition", () => {
    const out = regionAreaPartition({ region: [], points: [{ x: 0, y: 0 }], areas: [1] });
    expect(out.partition).toEqual([]);
    expect(out.count).toBe(0);
  });
});
