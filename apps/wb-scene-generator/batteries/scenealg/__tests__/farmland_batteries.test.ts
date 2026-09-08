/**
 * farmland 一线新增原子电池的核心算法回归测试：
 *   - alg_region_stripe_split : 单方向条带划分，条带等宽、间隙正确、并集覆盖有效区
 *   - alg_region_grid_split   : 规则网格细分，单元数 = 行带×列带、间隙正确、给定 seed 可复现
 *   - alg_region_random_fill  : 概率填充，density=1 满铺、density=0 全空、可复现、只落在有效格
 */
import { describe, it, expect } from "vitest";

import { regionStripeSplit } from "../Partition/region_stripe_split/index.ts";
import { regionGridSplit } from "../Partition/region_grid_split/index.ts";
import { regionRandomFill } from "../Region/region_random_fill/index.ts";

type Grid = number[][];

function fullGrid(rows: number, cols: number, v = 1): Grid {
  return Array.from({ length: rows }, () => new Array<number>(cols).fill(v));
}

function countNonZero(g: Grid): number {
  let n = 0;
  for (const row of g) for (const v of row) if (v !== 0) n++;
  return n;
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

describe("alg_region_stripe_split", () => {
  it("水平条带：等宽、间隙正确、条带+间隙覆盖整块有效区且互不重叠", () => {
    const rows = 20, cols = 16;
    const out = regionStripeSplit({
      region: fullGrid(rows, cols),
      direction: 0, // 按行切，横向条带
      bandWidth: 3,
      gapWidth: 1,
      border: 0,
      seed: 123,
    });
    const part = out.partition as Grid[];
    const gap = out.gap as Grid;
    expect(part.length).toBe(out.count);
    expect(part.length).toBeGreaterThan(1);

    const { union, overlap } = unionStats(part, rows, cols);
    expect(overlap).toBe(false);
    // 条带并集 + 间隙 = 整块有效区
    expect(union + countNonZero(gap)).toBe(rows * cols);

    // 每条带是满列横带：行数固定（除去吃了余量的那条）；至少应是整行
    for (const g of part) {
      // 每个非空行应整行被覆盖（横向条带满铺列）
      for (let r = 0; r < rows; r++) {
        const rowSum = g[r].reduce((a, b) => a + b, 0);
        expect(rowSum === 0 || rowSum === cols).toBe(true);
      }
    }
  });

  it("垂直条带：direction=1 时按列切（每条带满铺行）", () => {
    const rows = 16, cols = 20;
    const out = regionStripeSplit({
      region: fullGrid(rows, cols),
      direction: 1,
      bandWidth: 4,
      gapWidth: 1,
      seed: 7,
    });
    const part = out.partition as Grid[];
    for (const g of part) {
      for (let c = 0; c < cols; c++) {
        let colSum = 0;
        for (let r = 0; r < rows; r++) colSum += g[r][c];
        expect(colSum === 0 || colSum === rows).toBe(true);
      }
    }
  });

  it("border 边带计入 gap：四周一圈不属于任何条带", () => {
    const rows = 20, cols = 20;
    const out = regionStripeSplit({
      region: fullGrid(rows, cols),
      direction: 0,
      bandWidth: 3,
      gapWidth: 1,
      border: 2,
      seed: 1,
    });
    const part = out.partition as Grid[];
    // 四周 2 圈内不应有任何条带格
    for (const g of part) {
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
          if (r < 2 || r >= rows - 2 || c < 2 || c >= cols - 2) expect(g[r][c]).toBe(0);
    }
  });

  it("给定 seed 可复现", () => {
    const a = regionStripeSplit({ region: fullGrid(18, 18), direction: -1, bandWidth: 3, gapWidth: 1, seed: 555 });
    const b = regionStripeSplit({ region: fullGrid(18, 18), direction: -1, bandWidth: 3, gapWidth: 1, seed: 555 });
    expect(a.partition).toEqual(b.partition);
    expect(a.gap).toEqual(b.gap);
  });
});

describe("alg_region_grid_split", () => {
  it("规则网格：单元互不重叠、单元+间隙覆盖整块有效区", () => {
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

    // 每个单元应是一个实心矩形块
    for (const g of part) {
      let r0 = rows, r1 = -1, c0 = cols, c1 = -1;
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
          if (g[r][c] !== 0) {
            r0 = Math.min(r0, r); r1 = Math.max(r1, r);
            c0 = Math.min(c0, c); c1 = Math.max(c1, c);
          }
      const area = (r1 - r0 + 1) * (c1 - c0 + 1);
      expect(countNonZero(g)).toBe(area); // 实心矩形
    }
  });

  it("无间隙时单元数 = 行带×列带（20x20, cell4 → 5x5=25）", () => {
    const out = regionGridSplit({
      region: fullGrid(20, 20),
      cellWidth: 4,
      cellHeight: 4,
      gapWidth: 0,
      seed: 1,
    });
    expect(out.count).toBe(25);
    expect(countNonZero(out.gap as Grid)).toBe(0);
  });

  it("给定 seed 可复现", () => {
    const a = regionGridSplit({ region: fullGrid(22, 19), cellWidth: 4, cellHeight: 3, gapWidth: 1, seed: 999 });
    const b = regionGridSplit({ region: fullGrid(22, 19), cellWidth: 4, cellHeight: 3, gapWidth: 1, seed: 999 });
    expect(a.partition).toEqual(b.partition);
  });
});

describe("alg_region_random_fill", () => {
  it("density=1 满铺、density=0 全空（仅在有效格内）", () => {
    const region = fullGrid(10, 10, 0);
    // 挖一个 6x6 有效区
    for (let r = 2; r < 8; r++) for (let c = 2; c < 8; c++) region[r][c] = 1;

    const full = regionRandomFill({ region, density: 1, seed: 5 });
    expect(full.count).toBe(36);
    // 不溢出到无效格
    const fg = full.region as Grid;
    for (let r = 0; r < 10; r++)
      for (let c = 0; c < 10; c++)
        if (region[r][c] === 0) expect(fg[r][c]).toBe(0);

    const empty = regionRandomFill({ region, density: 0, seed: 5 });
    expect(empty.count).toBe(0);
    expect(countNonZero(empty.region as Grid)).toBe(0);
  });

  it("中间密度：保留格数在合理区间且只落在有效格", () => {
    const region = fullGrid(40, 40);
    const out = regionRandomFill({ region, density: 0.5, seed: 12345 });
    const n = out.count as number;
    // 1600 格 ~ 50%，给宽松区间
    expect(n).toBeGreaterThan(1600 * 0.4);
    expect(n).toBeLessThan(1600 * 0.6);
  });

  it("给定 seed 可复现", () => {
    const a = regionRandomFill({ region: fullGrid(30, 30), density: 0.7, seed: 88 });
    const b = regionRandomFill({ region: fullGrid(30, 30), density: 0.7, seed: 88 });
    expect(a.region).toEqual(b.region);
    expect(a.count).toBe(b.count);
  });
});
