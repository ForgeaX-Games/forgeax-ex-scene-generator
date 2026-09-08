/**
 * partition_field_quantize + field_mountain_contour 回归测试
 */
import { describe, it, expect } from "vitest";

import { fieldMountainContour } from "../fields/field_mountain_contour/index.ts";
import { partitionFieldQuantize } from "../Partition/partition_field_quantize/index.ts";

type Grid = number[][];

function fullGrid(rows: number, cols: number, v = 1): Grid {
  return Array.from({ length: rows }, () => new Array<number>(cols).fill(v));
}

function countCells(grid: Grid, value = 1): number {
  let n = 0;
  for (const row of grid) for (const c of row) if (c === value) n++;
  return n;
}

describe("alg_field_mountain_contour", () => {
  it("有效格 field 在 [0,1]，无效格为 0", () => {
    const region = fullGrid(24, 24);
    region[0][0] = 0;
    const field = fieldMountainContour({ region, seed: 42 }).field as Grid;
    for (let r = 0; r < 24; r++)
      for (let c = 0; c < 24; c++) {
        if (region[r][c] === 0) expect(field[r][c]).toBe(0);
        else {
          expect(field[r][c]).toBeGreaterThanOrEqual(0);
          expect(field[r][c]).toBeLessThanOrEqual(1);
        }
      }
  });

  it("相同 seed 可复现", () => {
    const region = fullGrid(16, 16);
    const a = fieldMountainContour({ region, seed: 7 }).field as Grid;
    const b = fieldMountainContour({ region, seed: 7 }).field as Grid;
    expect(a).toEqual(b);
  });

  it("缺少 region 返回 error", () => {
    expect(fieldMountainContour({}).error).toBeTruthy();
  });
});

describe("alg_partition_field_quantize", () => {
  it("maxElevationLayers=0 时全部为层 0，仅 1 张 partition", () => {
    const region = fullGrid(8, 8);
    const field: Grid = fullGrid(8, 8, 0.8);
    const out = partitionFieldQuantize({ region, field, maxElevationLayers: 0 });
    const parts = out.partition as Grid[];
    expect(out.count).toBe(1);
    expect(parts.length).toBe(1);
    expect(countCells(parts[0])).toBe(64);
  });

  it("maxElevationLayers=1 时分两层且互斥覆盖全部有效格", () => {
    const region = fullGrid(4, 4);
    const field: Grid = [
      [0, 0.2, 0.5, 1],
      [0, 0.1, 0.9, 0.8],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    const out = partitionFieldQuantize({ region, field, maxElevationLayers: 1 });
    const parts = out.partition as Grid[];
    expect(parts.length).toBe(2);
    // 有效格 4x4 中 row2-3 无效？ region 全 1，field row2-3 有 0 值 but region valid
    // row 2,3 all valid in region - field 0 still gets level 0
    let total = 0;
    for (let lv = 0; lv < 2; lv++) total += countCells(parts[lv]);
    expect(total).toBe(16);
    // 同一格不能两层都有
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++) {
        const hits = parts.filter((p) => p[r][c] === 1).length;
        expect(hits).toBe(1);
      }
  });

  it("nameList 默认前缀 等高线+层号", () => {
    const region = fullGrid(2, 2);
    const field = fullGrid(2, 2, 0.5);
    const out = partitionFieldQuantize({ region, field, maxElevationLayers: 2 });
    const names = out.nameList as { id: number; name: string }[];
    expect(names[0].name).toBe("等高线0");
    expect(names[2].name).toBe("等高线2");
  });

  it("缺少 field 返回 error", () => {
    expect(partitionFieldQuantize({ region: fullGrid(2, 2) }).error).toBeTruthy();
  });
});
