import { describe, it, expect } from "vitest";

import { regionCompassSqueeze } from "../Region/region_compass_squeeze/index.ts";

type Grid = number[][];

function fullGrid(rows: number, cols: number, v = 1): Grid {
  return Array.from({ length: rows }, () => new Array<number>(cols).fill(v));
}

function rectInCanvas(rows: number, cols: number, r0: number, r1: number, c0: number, c1: number): Grid {
  const g = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      g[r]![c] = 1;
    }
  }
  return g;
}

function countCells(grid: Grid): number {
  let n = 0;
  for (const row of grid) for (const v of row) if (v !== 0) n++;
  return n;
}

function shape(grid: Grid): [number, number] {
  return [grid.length, grid[0]?.length ?? 0];
}

describe("alg_region_compass_squeeze", () => {
  it("region 缺失时报错", () => {
    const out = regionCompassSqueeze({});
    expect(out.error).toBeTruthy();
  });

  it("全部力度为 0 时原样返回（仅归一化），delta 全 0", () => {
    const region = fullGrid(10, 10);
    region[0]![0] = 5; // 多值前景
    const out = regionCompassSqueeze({ region });
    const result = out.region as Grid;
    expect(countCells(result)).toBe(100);
    expect(result[0]![0]).toBe(1);
    const delta = out.delta as Grid;
    expect(delta.every((row) => row.every((v) => v === 0))).toBe(true);
  });

  it("正数=压缩：east 正值使区域从东侧向内收缩，格数减少且与输入同形状", () => {
    const region = fullGrid(30, 30);
    const out = regionCompassSqueeze({ region, east: 6, radius: 20 });
    const result = out.region as Grid;
    expect(shape(result)).toEqual(shape(region));
    expect(countCells(result)).toBeLessThan(countCells(region));
    // 东侧（最右列附近）应有格子被压缩掉
    const delta = out.delta as Grid;
    const lostNearEast = delta.some((row) => row[29] === -1 || row[28] === -1);
    expect(lostNearEast).toBe(true);
  });

  it("贴满画布边缘时，负值（拉伸）因无背景余量而被裁掉，格数不变", () => {
    const region = fullGrid(20, 20);
    const out = regionCompassSqueeze({ region, west: -8, radius: 15 });
    const result = out.region as Grid;
    expect(countCells(result)).toBe(countCells(region));
  });

  it("负数=拉伸：留有背景余量时 west 负值使区域向西扩张，格数增加", () => {
    const region = rectInCanvas(30, 30, 5, 24, 10, 20); // 左侧留 0..9 的背景余量
    const before = countCells(region);
    const out = regionCompassSqueeze({ region, west: -6, radius: 15 });
    const result = out.region as Grid;
    expect(countCells(result)).toBeGreaterThan(before);
    const delta = out.delta as Grid;
    const gainedNearWest = delta.some((row) => row.slice(0, 10).some((v) => v === 1));
    expect(gainedNearWest).toBe(true);
  });

  it("多方向可同时叠加：north 压缩 + south 拉伸", () => {
    const region = rectInCanvas(40, 20, 15, 25, 5, 15); // 南北都留了余量
    const before = countCells(region);
    const out = regionCompassSqueeze({ region, north: 5, south: -5, radius: 12 });
    const result = out.region as Grid;
    expect(shape(result)).toEqual(shape(region));
    // 北侧变少（内缩），南侧变多（外扩）：至少各有一处变化
    const delta = out.delta as Grid;
    const northLoss = delta.slice(15, 22).some((row) => row.includes(-1));
    const southGain = delta.slice(20).some((row) => row.includes(1));
    expect(northLoss).toBe(true);
    expect(southGain).toBe(true);
    expect(countCells(result)).not.toBe(before); // 两侧变化不会恰好完全抵消到原值也没关系，这里只确认确有变化
  });

  it("支持异形/非凸区域（L 形）不报错，输出同形状", () => {
    const rows = 20;
    const cols = 20;
    const region = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
    for (let r = 2; r < 18; r++) for (let c = 2; c < 8; c++) region[r]![c] = 1; // 竖条
    for (let r = 12; r < 18; r++) for (let c = 2; c < 16; c++) region[r]![c] = 1; // 横条，组成 L 形
    const out = regionCompassSqueeze({ region, east: 3, north: 4, radius: 8 });
    expect(out.error).toBeUndefined();
    const result = out.region as Grid;
    expect(shape(result)).toEqual([rows, cols]);
  });

  it("给定相同参数可复现（无随机性）", () => {
    const region = rectInCanvas(25, 25, 5, 19, 5, 19);
    const input = { region, north: 4, east: -3, south: 2, west: -2, radius: 9 };
    const a = regionCompassSqueeze(input);
    const b = regionCompassSqueeze(input);
    expect(a.region).toEqual(b.region);
    expect(a.delta).toEqual(b.delta);
  });
});
