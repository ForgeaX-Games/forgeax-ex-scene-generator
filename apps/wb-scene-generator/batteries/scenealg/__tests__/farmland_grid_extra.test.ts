/**
 * farmland 电池纯算法补口的回归测试：
 *   - alg_region_grid_split             : partition 互不重叠、行优先序、gap 不重叠、给定 seed 确定性
 *   - alg_region_uniform_bsp            : 叶子互不重叠、叶子+gap 覆盖有效区、叶子间留 pathWidth 通道、
 *                                        满足 minSize 约束、给定 seed 确定性
 */
import { describe, it, expect } from "vitest";

import { regionGridSplit } from "../Partition/region_grid_split/index.ts";
import { regionUniformBsp } from "../Partition/region_uniform_bsp/index.ts";

type Grid = number[][];

function fullGrid(rows: number, cols: number, v = 1): Grid {
  return Array.from({ length: rows }, () => new Array<number>(cols).fill(v));
}

function countNonZero(g: Grid): number {
  let n = 0;
  for (const row of g) for (const v of row) if (v !== 0) n++;
  return n;
}

function bbox(g: Grid): { r0: number; r1: number; c0: number; c1: number } | null {
  let r0 = g.length, r1 = -1, c0 = (g[0]?.length ?? 0), c1 = -1;
  for (let r = 0; r < g.length; r++)
    for (let c = 0; c < g[r].length; c++)
      if (g[r][c] !== 0) {
        r0 = Math.min(r0, r); r1 = Math.max(r1, r);
        c0 = Math.min(c0, c); c1 = Math.max(c1, c);
      }
  return r1 === -1 ? null : { r0, r1, c0, c1 };
}

/** partition 列表逐格求并（应彼此不重叠）。返回 [并集格数, 是否有重叠]。 */
function unionStats(part: Grid[], rows: number, cols: number): { union: number; overlap: boolean } {
  const occ = new Set<string>();
  let overlap = false;
  for (const g of part)
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        if (g[r][c] !== 0) {
          const k = `${r},${c}`;
          if (occ.has(k)) overlap = true;
          occ.add(k);
        }
  return { union: occ.size, overlap };
}

describe("alg_region_grid_split", () => {
  it("partition 互不重叠、行优先序，partition 并集 + gap = 整块有效区", () => {
    const rows = 20, cols = 20;
    const out = regionGridSplit({
      region: fullGrid(rows, cols),
      cellWidth: 4,
      cellHeight: 4,
      gapWidth: 1,
      seed: 42,
    });
    const part = out.partition as Grid[];
    const gap = out.gap as Grid;

    expect(part.length).toBe(out.count);
    expect(part.length).toBeGreaterThan(1);

    const { union, overlap } = unionStats(part, rows, cols);
    expect(overlap).toBe(false);
    expect(union + countNonZero(gap)).toBe(rows * cols);
  });

  it("行优先序：单元按外接矩形左上角 (行, 列) 严格递增（先行后列）", () => {
    const rows = 22, cols = 19;
    const out = regionGridSplit({
      region: fullGrid(rows, cols),
      cellWidth: 4,
      cellHeight: 3,
      gapWidth: 1,
      seed: 999,
    });
    const part = out.partition as Grid[];
    expect(part.length).toBeGreaterThan(1);

    let prevKey = -1;
    for (const g of part) {
      const bb = bbox(g);
      expect(bb).not.toBeNull();
      const { r0, c0 } = bb!;
      const key = r0 * (cols + 1) + c0;
      expect(key).toBeGreaterThan(prevKey);
      prevKey = key;
    }
  });

  it("给定 seed 可复现", () => {
    const a = regionGridSplit({ region: fullGrid(20, 20), cellWidth: 4, cellHeight: 4, gapWidth: 1, seed: 7 });
    const b = regionGridSplit({ region: fullGrid(20, 20), cellWidth: 4, cellHeight: 4, gapWidth: 1, seed: 7 });
    expect(a.partition).toEqual(b.partition);
    expect(a.gap).toEqual(b.gap);
    expect(a.count).toBe(b.count);
  });
});

describe("alg_region_uniform_bsp", () => {
  it("叶子互不重叠，叶子并集 + gap = 整块有效区", () => {
    const rows = 40, cols = 40;
    const out = regionUniformBsp({
      region: fullGrid(rows, cols),
      minSize: 4,
      pathWidth: 1,
      maxDepth: 6,
      seed: 123,
    });
    const part = out.partition as Grid[];
    const gap = out.gap as Grid;
    expect(part.length).toBe(out.count);
    expect(part.length).toBeGreaterThan(1);

    const { union, overlap } = unionStats(part, rows, cols);
    expect(overlap).toBe(false);
    expect(union + countNonZero(gap)).toBe(rows * cols);
  });

  it("每个叶子是实心矩形且满足 minSize 约束（除被掩码裁切外）", () => {
    const rows = 40, cols = 40, minSize = 4;
    const out = regionUniformBsp({ region: fullGrid(rows, cols), minSize, pathWidth: 1, maxDepth: 6, seed: 55 });
    const part = out.partition as Grid[];
    for (const g of part) {
      const bb = bbox(g)!;
      const h = bb.r1 - bb.r0 + 1;
      const w = bb.c1 - bb.c0 + 1;
      // 满铺矩形（满格输入下叶子不被裁切）
      expect(countNonZero(g)).toBe(h * w);
      // 切分保证每个叶子边长 >= minSize
      expect(h).toBeGreaterThanOrEqual(minSize);
      expect(w).toBeGreaterThanOrEqual(minSize);
    }
  });

  it("两叶子之间沿切向至少留出 pathWidth 格通道", () => {
    const rows = 40, cols = 40, pathWidth = 2;
    const out = regionUniformBsp({ region: fullGrid(rows, cols), minSize: 4, pathWidth, maxDepth: 6, seed: 88 });
    const part = (out.partition as Grid[]).map((g) => bbox(g)!);

    // 对每一对叶子：若它们在某一轴上的区间重叠（说明是同一条切分链上的相邻关系），
    // 则在另一轴上的间隙应 >= pathWidth（相邻）或为分离（>pathWidth）。这里验证：
    // 任意两叶子若在行/列任一轴投影相交，则另一轴的边界间隙 >= pathWidth。
    function overlap1D(a0: number, a1: number, b0: number, b1: number): boolean {
      return a0 <= b1 && b0 <= a1;
    }
    for (let i = 0; i < part.length; i++)
      for (let j = i + 1; j < part.length; j++) {
        const A = part[i], B = part[j];
        const rowOv = overlap1D(A.r0, A.r1, B.r0, B.r1);
        const colOv = overlap1D(A.c0, A.c1, B.c0, B.c1);
        // 两矩形不能同时在两轴都重叠（那就是叠在一起了）
        expect(rowOv && colOv).toBe(false);
        if (rowOv && !colOv) {
          // 列向相邻：列间隙 >= pathWidth
          const gapCols = A.c1 < B.c0 ? B.c0 - A.c1 - 1 : A.c0 - B.c1 - 1;
          expect(gapCols).toBeGreaterThanOrEqual(pathWidth);
        }
        if (colOv && !rowOv) {
          const gapRows = A.r1 < B.r0 ? B.r0 - A.r1 - 1 : A.r0 - B.r1 - 1;
          expect(gapRows).toBeGreaterThanOrEqual(pathWidth);
        }
      }
  });

  it("maxDepth=0 时不切，整块作为单一叶子", () => {
    const out = regionUniformBsp({ region: fullGrid(30, 30), minSize: 4, pathWidth: 1, maxDepth: 0, seed: 1 });
    expect(out.count).toBe(1);
    expect(countNonZero((out.partition as Grid[])[0])).toBe(30 * 30);
    expect(countNonZero(out.gap as Grid)).toBe(0);
  });

  it("给定 seed 可复现", () => {
    const a = regionUniformBsp({ region: fullGrid(36, 30), minSize: 3, pathWidth: 1, maxDepth: 6, seed: 2026 });
    const b = regionUniformBsp({ region: fullGrid(36, 30), minSize: 3, pathWidth: 1, maxDepth: 6, seed: 2026 });
    expect(a.partition).toEqual(b.partition);
    expect(a.gap).toEqual(b.gap);
    expect(a.count).toBe(b.count);
  });

  it("不同 seed 一般给出不同切分（健全性检查）", () => {
    const a = regionUniformBsp({ region: fullGrid(40, 40), minSize: 4, pathWidth: 1, maxDepth: 6, seed: 11 });
    const b = regionUniformBsp({ region: fullGrid(40, 40), minSize: 4, pathWidth: 1, maxDepth: 6, seed: 22 });
    expect(JSON.stringify(a.partition)).not.toBe(JSON.stringify(b.partition));
  });
});
