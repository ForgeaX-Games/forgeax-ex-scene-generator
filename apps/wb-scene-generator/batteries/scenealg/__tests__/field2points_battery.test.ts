/**
 * alg_field2points 核心算法回归测试：
 *   - 只有「值 > threshold」（严格大于）的格被采样，每张输出网格恰好一个 1 且位置正确
 *   - 输出列表长度 == 超阈值格数
 *   - 行优先顺序（r 外层、c 内层）
 *   - 无超阈值 => 空列表
 *   - 边界：等于 threshold 的格不被选（严格 >）
 *   - 非法输入 => error
 */
import { describe, it, expect } from "vitest";

import { field2points } from "../points/field2points/index.ts";

type Grid = number[][];

/** 找出一张单点 0/1 网格里唯一为 1 的坐标，并断言其余均为 0、尺寸匹配。 */
function singlePoint(g: Grid, rows: number, cols: number): [number, number] {
  expect(g.length).toBe(rows);
  let found: [number, number] | null = null;
  let ones = 0;
  for (let r = 0; r < rows; r++) {
    expect(g[r].length).toBe(cols);
    for (let c = 0; c < cols; c++) {
      if (g[r][c] === 1) {
        ones++;
        found = [r, c];
      } else {
        expect(g[r][c]).toBe(0);
      }
    }
  }
  expect(ones).toBe(1);
  return found as [number, number];
}

describe("alg_field2points", () => {
  it("只有 >threshold 的格被选中，每张输出恰好一个 1 且位置正确", () => {
    const field: Grid = [
      [0.1, 0.9, 0.2],
      [0.8, 0.0, 0.95],
    ];
    const out = field2points({ field, threshold: 0.5 }).points as Grid[];
    // 超阈值格：(0,1)=0.9, (1,0)=0.8, (1,2)=0.95
    const coords = out.map((g) => singlePoint(g, 2, 3));
    expect(coords).toEqual([
      [0, 1],
      [1, 0],
      [1, 2],
    ]);
  });

  it("输出列表长度 == 超阈值格数", () => {
    const field: Grid = [
      [1, 2, 3],
      [4, 5, 6],
    ];
    // threshold=3 => 严格大于的格：4,5,6 共 3 个
    const out = field2points({ field, threshold: 3 }).points as Grid[];
    expect(out.length).toBe(3);
  });

  it("行优先顺序（r 外层、c 内层）", () => {
    const field: Grid = [
      [9, 0, 9],
      [0, 9, 0],
      [9, 0, 9],
    ];
    const out = field2points({ field, threshold: 0 }).points as Grid[];
    const coords = out.map((g) => singlePoint(g, 3, 3));
    expect(coords).toEqual([
      [0, 0],
      [0, 2],
      [1, 1],
      [2, 0],
      [2, 2],
    ]);
  });

  it("无超阈值 => 空列表", () => {
    const field: Grid = [
      [0.1, 0.2],
      [0.3, 0.4],
    ];
    const out = field2points({ field, threshold: 1 }).points as Grid[];
    expect(out).toEqual([]);
    expect(out.length).toBe(0);
  });

  it("边界：等于 threshold 的格不被选（严格 >）", () => {
    const field: Grid = [
      [0.5, 0.5],
      [0.5, 0.51],
    ];
    const out = field2points({ field, threshold: 0.5 }).points as Grid[];
    // 只有 (1,1)=0.51 严格大于 0.5
    expect(out.length).toBe(1);
    expect(singlePoint(out[0], 2, 2)).toEqual([1, 1]);
  });

  it("默认 threshold=0：选出所有正值格", () => {
    const field: Grid = [
      [-1, 0, 2],
      [0, 3, -5],
    ];
    const out = field2points({ field }).points as Grid[];
    const coords = out.map((g) => singlePoint(g, 2, 3));
    expect(coords).toEqual([
      [0, 2],
      [1, 1],
    ]);
  });

  it("count 输出 == 超阈值格数（= points 列表长度）", () => {
    const field: Grid = [
      [1, 2, 3],
      [4, 5, 6],
    ];
    const res = field2points({ field, threshold: 3 });
    expect(res.count).toBe(3);
    expect(res.count).toBe((res.points as Grid[]).length);

    const none = field2points({ field, threshold: 100 });
    expect(none.count).toBe(0);
  });

  it("非法输入返回 error", () => {
    expect(field2points({}).error).toBeTruthy();
    expect(field2points({ field: [] }).error).toBeTruthy();
    expect(field2points({ field: [[]] }).error).toBeTruthy();
  });
});
