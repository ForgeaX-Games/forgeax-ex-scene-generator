/**
 * fields 分类两个原子电池的核心算法回归测试：
 *   - alg_field_noise    : 有效格值域 [0,1]、同 seed 确定、无效格为 0、scale 影响
 *   - alg_field_distance : 源格为 0、距离逐层递增、4/8 邻接、normalize 行为、不可达/无效格处理
 */
import { describe, it, expect } from "vitest";

import { fieldNoise } from "../fields/field_noise/index.ts";
import { fieldDistance } from "../fields/field_distance/index.ts";

type Grid = number[][];

function fullGrid(rows: number, cols: number, v = 1): Grid {
  return Array.from({ length: rows }, () => new Array<number>(cols).fill(v));
}

describe("alg_field_noise", () => {
  it("有效格值域落在 [0,1]，无效格为 0", () => {
    const region = fullGrid(20, 20);
    // 挖掉一块设为无效格
    region[0][0] = 0;
    region[5][7] = 0;
    const out = fieldNoise({ region, seed: 123 }).field as Grid;
    expect(out.length).toBe(20);
    expect(out[0].length).toBe(20);
    for (let r = 0; r < 20; r++)
      for (let c = 0; c < 20; c++) {
        if (region[r][c] === 0) {
          expect(out[r][c]).toBe(0);
        } else {
          expect(out[r][c]).toBeGreaterThanOrEqual(0);
          expect(out[r][c]).toBeLessThanOrEqual(1);
        }
      }
  });

  it("相同 seed 结果确定可复现", () => {
    const a = fieldNoise({ region: fullGrid(16, 16), seed: 999 }).field as Grid;
    const b = fieldNoise({ region: fullGrid(16, 16), seed: 999 }).field as Grid;
    expect(a).toEqual(b);
  });

  it("不同 seed 产生不同的场", () => {
    const a = fieldNoise({ region: fullGrid(16, 16), seed: 1 }).field as Grid;
    const b = fieldNoise({ region: fullGrid(16, 16), seed: 2 }).field as Grid;
    expect(a).not.toEqual(b);
  });

  it("scale 影响噪声场（缩放坐标后采样结果不同）", () => {
    const region = fullGrid(20, 20);
    const s1 = fieldNoise({ region, seed: 42, scale: 1 }).field as Grid;
    const s2 = fieldNoise({ region, seed: 42, scale: 3 }).field as Grid;
    expect(s1).not.toEqual(s2);
  });

  it("scale=0 或缺省回退到 1（默认行为）", () => {
    const region = fullGrid(12, 12);
    const def = fieldNoise({ region, seed: 7 }).field as Grid;
    const one = fieldNoise({ region, seed: 7, scale: 1 }).field as Grid;
    const zero = fieldNoise({ region, seed: 7, scale: 0 }).field as Grid;
    expect(def).toEqual(one);
    expect(zero).toEqual(one);
  });

  it("缺少 region 返回 error", () => {
    expect(fieldNoise({}).error).toBeTruthy();
  });
});

describe("alg_field_distance", () => {
  it("接 source：源格为 0，距离按 4-邻接逐层递增（曼哈顿距离）", () => {
    const region = fullGrid(11, 11);
    const source = fullGrid(11, 11, 0);
    source[5][5] = 1;
    const out = fieldDistance({ region, source, connectivity: 4 }).field as Grid;
    expect(out[5][5]).toBe(0);
    for (let r = 0; r < 11; r++)
      for (let c = 0; c < 11; c++) {
        // 满格区域、单源、4 邻接 => 距离 == 曼哈顿距离
        expect(out[r][c]).toBe(Math.abs(r - 5) + Math.abs(c - 5));
      }
  });

  it("8-邻接：距离 == 切比雪夫距离（对角更近）", () => {
    const region = fullGrid(11, 11);
    const source = fullGrid(11, 11, 0);
    source[5][5] = 1;
    const out = fieldDistance({ region, source, connectivity: 8 }).field as Grid;
    expect(out[5][5]).toBe(0);
    for (let r = 0; r < 11; r++)
      for (let c = 0; c < 11; c++) {
        expect(out[r][c]).toBe(Math.max(Math.abs(r - 5), Math.abs(c - 5)));
      }
    // 对角格在 8 邻接下比 4 邻接更近
    expect(out[8][8]).toBe(3);
  });

  it("多源 BFS：取到最近源的距离", () => {
    const region = fullGrid(1, 11);
    const source = fullGrid(1, 11, 0);
    source[0][0] = 1;
    source[0][10] = 1;
    const out = fieldDistance({ region, source, connectivity: 4 }).field as Grid;
    for (let c = 0; c < 11; c++) {
      expect(out[0][c]).toBe(Math.min(c, 10 - c));
    }
  });

  it("BFS 只在 region 有效格内传播，不穿越无效格", () => {
    // 一行被中间无效格切成两段，源在左段，右段不可达 => -1
    const region: Grid = [[1, 1, 0, 1, 1]];
    const source: Grid = [[1, 0, 0, 0, 0]];
    const out = fieldDistance({ region, source, connectivity: 4 }).field as Grid;
    expect(out[0][0]).toBe(0);
    expect(out[0][1]).toBe(1);
    expect(out[0][2]).toBe(0); // 无效格 => 0
    expect(out[0][3]).toBe(-1); // 有效但不可达 => -1
    expect(out[0][4]).toBe(-1);
  });

  it("默认无 source：以区域边界格为源（到边界的距离）", () => {
    const region = fullGrid(7, 7);
    const out = fieldDistance({ region, connectivity: 4 }).field as Grid;
    // 边界一圈距离 0
    for (let c = 0; c < 7; c++) {
      expect(out[0][c]).toBe(0);
      expect(out[6][c]).toBe(0);
    }
    for (let r = 0; r < 7; r++) {
      expect(out[r][0]).toBe(0);
      expect(out[r][6]).toBe(0);
    }
    // 内圈、中心逐层递增
    expect(out[1][1]).toBe(1);
    expect(out[3][3]).toBe(3);
  });

  it("normalize=true 把可达距离归一化到 [0,1]，最大距离处为 1", () => {
    const region = fullGrid(11, 11);
    const source = fullGrid(11, 11, 0);
    source[0][0] = 1;
    const raw = fieldDistance({ region, source, connectivity: 4 }).field as Grid;
    const norm = fieldDistance({ region, source, connectivity: 4, normalize: true }).field as Grid;
    let maxD = 0;
    for (let r = 0; r < 11; r++)
      for (let c = 0; c < 11; c++) if (raw[r][c] > maxD) maxD = raw[r][c];
    expect(maxD).toBe(20); // 角到角曼哈顿距离
    for (let r = 0; r < 11; r++)
      for (let c = 0; c < 11; c++) {
        expect(norm[r][c]).toBeCloseTo(raw[r][c] / maxD, 10);
        expect(norm[r][c]).toBeGreaterThanOrEqual(0);
        expect(norm[r][c]).toBeLessThanOrEqual(1);
      }
    expect(norm[10][10]).toBeCloseTo(1, 10);
    expect(norm[0][0]).toBe(0);
  });

  it("缺少 region 返回 error", () => {
    expect(fieldDistance({}).error).toBeTruthy();
  });
});
