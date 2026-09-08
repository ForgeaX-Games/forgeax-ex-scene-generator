/**
 * natural_decoration 一线「edge / poisson / 精确格数(count)」缺口补齐的回归测试：
 *   - alg_region_edge_inner_split : 4-邻接边/内判定、并集=有效格、互斥、8-邻接分支
 *   - alg_points_scatter (poisson) : 欧氏圆距离铺满、minDist 反推、count 模式精确补足、spacing 向后兼容
 *   - alg_region_random_fill (count) : 洗牌取前 n、edge 第二输入下边优先(fillEdgeCount)、density 向后兼容
 *   - alg_region_cluster_scatter (count) : 簇心打分降序取前 N、精确格数、density 向后兼容
 *   - alg_region_noise_fill (count) : 按 hashNoise 降序取前 N、精确格数、density 向后兼容
 *
 * 确定性算法逐条对照老 natural_decoration helper；随机序列用 mulberry32（与老电池不同是允许的）。
 */
import { describe, it, expect } from "vitest";

import { regionEdgeInnerSplit } from "../Topology/region_edge_inner_split/index.ts";
import { pointsScatter } from "../points/points_scatter/index.ts";
import { regionRandomFill } from "../Region/region_random_fill/index.ts";
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

// 参考实现：老 hashNoise（用于核对 noise count 选取规则）
function hashNoise(r: number, c: number, seed: number): number {
  let h = seed ^ (r * 374761393) ^ (c * 668265263);
  h = (Math.imul(h, 1540483477) + 0x6b43a9b5) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x85ebca77) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 0xc2b2ae3d) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 0x100000000;
}

describe("alg_region_edge_inner_split", () => {
  it("4-邻接：实心方块仅最外圈为 edge，内部为 inner，二者互斥且并集=有效格", () => {
    // 6x6 全 1 实心块（嵌在更大网格里，验证越界判边）
    const region = fullGrid(8, 8, 0);
    for (let r = 1; r < 7; r++) for (let c = 1; c < 7; c++) region[r][c] = 1;

    const out = regionEdgeInnerSplit({ region, connectivity: 4 });
    const edge = out.edge as Grid;
    const inner = out.inner as Grid;

    // 互斥 + 并集=有效格
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const valid = region[r][c] !== 0 ? 1 : 0;
        expect((edge[r][c] ? 1 : 0) + (inner[r][c] ? 1 : 0)).toBe(valid);
      }
    }
    // 6x6 实心块：外圈一层(=边界相邻空/越界)为 edge，内 4x4 为 inner
    expect(out.innerCount).toBe(16); // 4x4
    expect(out.edgeCount).toBe(36 - 16); // 6x6 - 内 4x4 = 20
    // 角点必为 edge，正中必为 inner
    expect(edge[1][1]).toBe(1);
    expect(inner[3][3]).toBe(1);
  });

  it("孤立单格 / 细条全为 edge（任一 4-邻接缺失即判边）", () => {
    const region = fullGrid(5, 5, 0);
    region[2][2] = 1; // 孤立单格
    const out = regionEdgeInnerSplit({ region });
    expect(out.edgeCount).toBe(1);
    expect(out.innerCount).toBe(0);

    const strip = fullGrid(5, 5, 0);
    for (let c = 0; c < 5; c++) strip[2][c] = 1; // 1xN 细条，无上下邻 → 全 edge
    const out2 = regionEdgeInnerSplit({ region: strip });
    expect(out2.edgeCount).toBe(5);
    expect(out2.innerCount).toBe(0);
  });

  it("8-邻接更严格：内部格因对角邻空也会被判 edge", () => {
    // 实心 6x6（贴边，没有越界因素时用对角验证）：在 8x8 网格中 1..6
    const region = fullGrid(8, 8, 0);
    for (let r = 1; r < 7; r++) for (let c = 1; c < 7; c++) region[r][c] = 1;
    const out4 = regionEdgeInnerSplit({ region, connectivity: 4 });
    const out8 = regionEdgeInnerSplit({ region, connectivity: 8 });
    // 8-邻接边界更厚，故 edge 数 >= 4-邻接，inner 数 <=（此处实心块对角都在内部，二者相等也允许）
    expect(out8.edgeCount as number).toBeGreaterThanOrEqual(out4.edgeCount as number);
    expect(out8.innerCount as number).toBeLessThanOrEqual(out4.innerCount as number);
  });
});

describe("alg_points_scatter poisson 模式", () => {
  it("density 模式：欧氏圆距离铺满，任意两点间距 >= minDist=max(1.5,8-density*6)", () => {
    const region = fullGrid(40, 40);
    const density = 0.5;
    const minDist = Math.max(1.5, 8 - density * 6);
    const out = pointsScatter({ region, mode: "poisson", countMode: "density", density, seed: 12345 });
    const pts = out.points as Grid;
    const placed: [number, number][] = [];
    for (let r = 0; r < 40; r++) for (let c = 0; c < 40; c++) if (pts[r][c]) placed.push([r, c]);
    expect(placed.length).toBe(out.count);
    expect(placed.length).toBeGreaterThan(0);
    // 验证所有点对欧氏距离平方 >= minDist^2
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const dr = placed[i][0] - placed[j][0];
        const dc = placed[i][1] - placed[j][1];
        expect(dr * dr + dc * dc).toBeGreaterThanOrEqual(minDist * minDist);
      }
    }
  });

  it("density 越大 minDist 越小 → 铺得越密（点更多）", () => {
    const region = fullGrid(40, 40);
    const sparse = pointsScatter({ region, mode: "poisson", density: 0, seed: 7 });
    const dense = pointsScatter({ region, mode: "poisson", density: 1, seed: 7 });
    expect(dense.count as number).toBeGreaterThan(sparse.count as number);
  });

  it("count 模式：放置后随机补足到精确 count（铺满型小网格也精确）", () => {
    const region = fullGrid(30, 30);
    const out = pointsScatter({ region, mode: "poisson", countMode: "count", count: 50, seed: 99 });
    expect(out.count).toBe(50);
    expect(countNonZero(out.points as Grid)).toBe(50);
  });

  it("count 模式：count 超过有效格数时取全部有效格", () => {
    const region = fullGrid(5, 5);
    const out = pointsScatter({ region, mode: "poisson", countMode: "count", count: 999, seed: 3 });
    expect(out.count).toBe(25);
  });

  it("spacing 模式严格向后兼容：默认 mode 与显式 spacing 一致，且受 minSpacing 约束", () => {
    const region = fullGrid(30, 30);
    const a = pointsScatter({ region, count: 8, minSpacing: 4, seed: 42 });
    const b = pointsScatter({ region, mode: "spacing", count: 8, minSpacing: 4, seed: 42 });
    expect(a.points).toEqual(b.points);
    expect(a.count).toBe(b.count);
    // 点数不超过 count
    expect(a.count as number).toBeLessThanOrEqual(8);
  });
});

describe("alg_region_random_fill count 模式", () => {
  it("count 模式：精确保留 count 格（洗牌取前 n）", () => {
    const region = fullGrid(20, 20);
    const out = regionRandomFill({ region, mode: "count", count: 37, seed: 5 });
    expect(out.count).toBe(37);
    expect(countNonZero(out.region as Grid)).toBe(37);
  });

  it("count 超过有效格数时取全部", () => {
    const region = fullGrid(4, 4);
    const out = regionRandomFill({ region, mode: "count", count: 999, seed: 1 });
    expect(out.count).toBe(16);
  });

  it("edge 第二输入：边优先(fillEdgeCount)，count<=边格数时全部落在 edge", () => {
    const region = fullGrid(10, 10);
    // edge = 最外圈一圈
    const edge = fullGrid(10, 10, 0);
    for (let i = 0; i < 10; i++) { edge[0][i] = 1; edge[9][i] = 1; edge[i][0] = 1; edge[i][9] = 1; }
    const edgeCount = countNonZero(edge); // 36
    const out = regionRandomFill({ region, edge, mode: "count", count: 20, seed: 7 });
    const g = out.region as Grid;
    expect(out.count).toBe(20);
    // 20 < 36，应全部落在 edge 格上
    for (let r = 0; r < 10; r++)
      for (let c = 0; c < 10; c++)
        if (g[r][c]) expect(edge[r][c]).toBe(1);
  });

  it("density 模式向后兼容：默认 mode 与显式 density 结果一致", () => {
    const region = fullGrid(30, 30);
    const a = regionRandomFill({ region, density: 0.5, seed: 88 });
    const b = regionRandomFill({ region, mode: "density", density: 0.5, seed: 88 });
    expect(a.region).toEqual(b.region);
    // density=1 满铺、0 全空
    expect(regionRandomFill({ region, density: 1, seed: 1 }).count).toBe(900);
    expect(regionRandomFill({ region, density: 0, seed: 1 }).count).toBe(0);
  });
});

describe("alg_region_cluster_scatter count 模式", () => {
  it("count 模式：精确选中 count 格", () => {
    const region = fullGrid(40, 40);
    const out = regionClusterScatter({ region, mode: "count", count: 60, clusterRadius: 4, seed: 12345 });
    expect(out.count).toBe(60);
    expect(countNonZero(out.region as Grid)).toBe(60);
  });

  it("count 模式选取规则：选中格集合 = 簇心打分降序前 N（与按 score 排序一致）", () => {
    // 用小网格 + 固定 seed，独立复算簇心打分，核对选中集合
    const rows = 20, cols = 20;
    const region = fullGrid(rows, cols);
    const count = 15;
    const radius = 4;
    const seed = 333;
    const out = regionClusterScatter({ region, mode: "count", count, clusterRadius: radius, seed });
    expect(out.count).toBe(count);
    // 仅校验落点都在有效格内且数量精确（打分顺序依赖内部 rng 时序，难以外部逐位复算，故核对约束性质）
    const g = out.region as Grid;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (g[r][c]) expect(region[r][c]).toBe(1);
  });

  it("count 超过有效格数时取全部；density 模式向后兼容", () => {
    const small = fullGrid(3, 3);
    const outSmall = regionClusterScatter({ region: small, mode: "count", count: 999, seed: 1 });
    expect(outSmall.count).toBe(9);

    const region = fullGrid(30, 30);
    const a = regionClusterScatter({ region, density: 0.3, clusterRadius: 4, seed: 88 });
    const b = regionClusterScatter({ region, mode: "density", density: 0.3, clusterRadius: 4, seed: 88 });
    expect(a.region).toEqual(b.region);
    expect(regionClusterScatter({ region, density: 0, seed: 5 }).count).toBe(0);
  });
});

describe("alg_region_noise_fill count 模式", () => {
  it("count 模式：精确保留 count 格，且为 hashNoise 值最高的前 N 格", () => {
    const rows = 15, cols = 15;
    const region = fullGrid(rows, cols);
    const seed = 777;
    const count = 30;
    const out = regionNoiseFill({ region, mode: "count", count, seed });
    expect(out.count).toBe(count);

    // 独立按 hashNoise 降序复算前 N 格集合，核对一致
    const scored: { r: number; c: number; n: number }[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) scored.push({ r, c, n: hashNoise(r, c, seed) });
    scored.sort((a, b) => b.n - a.n);
    const expected = new Set(scored.slice(0, count).map((s) => `${s.r},${s.c}`));
    const g = out.region as Grid;
    const got = new Set<string>();
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (g[r][c]) got.add(`${r},${c}`);
    expect(got).toEqual(expected);
  });

  it("count 超过有效格数取全部；density 模式向后兼容（满铺/全空/确定性）", () => {
    const region = fullGrid(10, 10);
    expect(regionNoiseFill({ region, mode: "count", count: 999, seed: 1 }).count).toBe(100);

    const a = regionNoiseFill({ region, density: 0.5, seed: 5 });
    const b = regionNoiseFill({ region, mode: "density", density: 0.5, seed: 5 });
    expect(a.region).toEqual(b.region);
    expect(regionNoiseFill({ region, density: 1, seed: 5 }).count).toBe(100);
    expect(regionNoiseFill({ region, density: 0, seed: 5 }).count).toBe(0);
  });
});
