/**
 * 三个原子电池的核心算法回归测试：
 *   - alg_points_scatter   : 撒点不重叠、满足 minSpacing
 *   - alg_region_flood_grow: 洪泛生长格数接近 targetSize 且 4-连通
 *   - alg_region_dilate    : 膨胀步数正确（菱形半径 == steps）
 */
import { describe, it, expect } from "vitest";

import { pointsScatter } from "../points/points_scatter/index.ts";
import { regionFloodGrow } from "../Partition/region_flood_grow/index.ts";
import { regionDilate } from "../Region/region_dilate/index.ts";

type Grid = number[][];

function fullGrid(rows: number, cols: number, v = 1): Grid {
  return Array.from({ length: rows }, () => new Array<number>(cols).fill(v));
}

function listPoints(mask: Grid): [number, number][] {
  const pts: [number, number][] = [];
  for (let r = 0; r < mask.length; r++)
    for (let c = 0; c < mask[r].length; c++) if (mask[r][c] !== 0) pts.push([r, c]);
  return pts;
}

function manhattan(a: [number, number], b: [number, number]): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
}

/** 4-连通分量数（用于验证 blob 单连通）。 */
function componentCount(mask: Grid): number {
  const rows = mask.length, cols = mask[0].length;
  const seen = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));
  let comps = 0;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (mask[r][c] === 0 || seen[r][c]) continue;
      comps++;
      const q: [number, number][] = [[r, c]];
      seen[r][c] = true;
      while (q.length) {
        const [cr, cc] = q.pop()!;
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
          const nr = cr + dr, nc = cc + dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !seen[nr][nc] && mask[nr][nc] !== 0) {
            seen[nr][nc] = true;
            q.push([nr, nc]);
          }
        }
      }
    }
  return comps;
}

describe("alg_points_scatter", () => {
  it("产点互不重叠且两两满足 minSpacing", () => {
    const minSpacing = 5;
    const out = pointsScatter({ region: fullGrid(40, 40), count: 8, minSpacing, seed: 12345 });
    const pts = listPoints(out.points as Grid);
    expect(pts.length).toBe(out.count);
    expect(pts.length).toBeGreaterThan(1);
    // 互不重叠
    const keys = new Set(pts.map((p) => `${p[0]},${p[1]}`));
    expect(keys.size).toBe(pts.length);
    // 两两 BFS 间距 >= minSpacing（满格上曼哈顿距离 == BFS 步数）
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++)
        expect(manhattan(pts[i], pts[j])).toBeGreaterThanOrEqual(minSpacing);
  });

  it("给定 seed 可复现", () => {
    const a = pointsScatter({ region: fullGrid(30, 30), count: 6, minSpacing: 3, seed: 777 });
    const b = pointsScatter({ region: fullGrid(30, 30), count: 6, minSpacing: 3, seed: 777 });
    expect(a.points).toEqual(b.points);
  });
});

describe("alg_region_flood_grow", () => {
  it("每个 blob 格数接近 targetSize 且 4-连通", () => {
    const region = fullGrid(60, 60);
    const pts = pointsScatter({ region, count: 4, minSpacing: 12, seed: 42 });
    const size = 50;
    const out = regionFloodGrow({ region, points: pts.points, size, sizeVariance: 0, seed: 99 });
    const partition = out.partition as Grid[];
    expect(partition.length).toBe(out.count);
    expect(partition.length).toBeGreaterThan(0);
    for (const blob of partition) {
      const cells = listPoints(blob).length;
      // sizeVariance=0 时应正好长到 size（空间足够）
      expect(cells).toBe(size);
      // 单一 4-连通分量
      expect(componentCount(blob)).toBe(1);
    }
  });

  it("blob 之间互不重叠", () => {
    const region = fullGrid(60, 60);
    const pts = pointsScatter({ region, count: 5, minSpacing: 10, seed: 7 });
    const out = regionFloodGrow({ region, points: pts.points, size: 60, sizeVariance: 0.2, seed: 3 });
    const partition = out.partition as Grid[];
    const occ = new Set<string>();
    for (const blob of partition)
      for (const [r, c] of listPoints(blob)) {
        const k = `${r},${c}`;
        expect(occ.has(k)).toBe(false);
        occ.add(k);
      }
  });

  it("spacingDilate=0 与不传 spacingDilate 行为完全一致（严格向后兼容）", () => {
    const region = fullGrid(60, 60);
    const pts = pointsScatter({ region, count: 5, minSpacing: 8, seed: 7 });
    const base = regionFloodGrow({ region, points: pts.points, size: 50, sizeVariance: 0.2, seed: 3 });
    const zero = regionFloodGrow({ region, points: pts.points, size: 50, sizeVariance: 0.2, seed: 3, spacingDilate: 0 });
    expect(zero.count).toEqual(base.count);
    expect(zero.partition).toEqual(base.partition);
  });

  it("spacingDilate>0 时相邻种子长出的 blob 之间至少保持 spacingDilate 圈间隔", () => {
    const spacingDilate = 3;
    const region = fullGrid(40, 40);
    // 两个种子点：相距足够远使两个 blob 都能长出，但又足够近以验证禁区把它们撑开。
    const points: Grid = fullGrid(40, 40, 0);
    points[20][8] = 1;
    points[20][22] = 1;
    const size = 6;

    const out = regionFloodGrow({ region, points, size, sizeVariance: 0, seed: 5, spacingDilate });
    const partition = out.partition as Grid[];
    // 两个种子都应长出 blob
    expect(partition.length).toBe(2);

    const cellsA = listPoints(partition[0]);
    const cellsB = listPoints(partition[1]);
    expect(cellsA.length).toBe(size);
    expect(cellsB.length).toBe(size);

    // 后长 blob 的任意格与先长 blob 的任意格之间，BFS（满格上=曼哈顿）距离必须 > spacingDilate，
    // 即至少隔 spacingDilate 圈空格（后 blob 不会落在前 blob 的 spacingDilate 步膨胀禁区内）。
    let minDist = Infinity;
    for (const a of cellsA)
      for (const b of cellsB) minDist = Math.min(minDist, manhattan(a, b));
    expect(minDist).toBeGreaterThan(spacingDilate);
  });

  it("spacingDilate 越大，相邻 blob 被撑得越开（禁区随步数增长）", () => {
    const region = fullGrid(50, 50);
    const points: Grid = fullGrid(50, 50, 0);
    points[25][12] = 1;
    points[25][30] = 1;
    const size = 6;

    function minGap(spacingDilate: number): number {
      const out = regionFloodGrow({ region, points, size, sizeVariance: 0, seed: 11, spacingDilate });
      const part = out.partition as Grid[];
      expect(part.length).toBe(2);
      const a = listPoints(part[0]);
      const b = listPoints(part[1]);
      let m = Infinity;
      for (const p of a) for (const q of b) m = Math.min(m, manhattan(p, q));
      return m;
    }

    // 不开禁区时两 blob 自然间距；开启后间距必须严格大于步数，且更大步数撑得不更近。
    const gap0 = minGap(0);
    const gap2 = minGap(2);
    const gap5 = minGap(5);
    expect(gap2).toBeGreaterThan(2);
    expect(gap5).toBeGreaterThan(5);
    expect(gap5).toBeGreaterThanOrEqual(gap2);
    expect(gap2).toBeGreaterThanOrEqual(gap0);
  });
});

describe("alg_region_dilate", () => {
  it("单点膨胀 steps 步得到曼哈顿半径 == steps 的菱形", () => {
    const region = fullGrid(21, 21, 0);
    region[10][10] = 1;
    const steps = 4;
    const out = regionDilate({ region, steps, connectivity: 4 });
    const res = out.region as Grid;
    let count = 0;
    for (let r = 0; r < 21; r++)
      for (let c = 0; c < 21; c++) {
        const d = Math.abs(r - 10) + Math.abs(c - 10);
        if (res[r][c] === 1) {
          count++;
          expect(d).toBeLessThanOrEqual(steps); // 不超出半径
        }
        if (d <= steps) expect(res[r][c]).toBe(1); // 半径内全覆盖
      }
    // 曼哈顿菱形格数 = 2*steps^2 + 2*steps + 1
    expect(count).toBe(2 * steps * steps + 2 * steps + 1);
  });

  it("steps=0 仅归一化不膨胀", () => {
    const region = fullGrid(10, 10, 0);
    region[5][5] = 3;
    const out = regionDilate({ region, steps: 0 });
    expect(listPoints(out.region as Grid)).toEqual([[5, 5]]);
  });

  it("connectivity=8 单点膨胀 1 步得到 3x3 方块", () => {
    const region = fullGrid(11, 11, 0);
    region[5][5] = 1;
    const out = regionDilate({ region, steps: 1, connectivity: 8 });
    expect(listPoints(out.region as Grid).length).toBe(9);
  });
});
