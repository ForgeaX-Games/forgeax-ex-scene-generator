/**
 * alg_region_border_is_rect 回归测试：外接矩形四边是否被有效格完全填满。
 */
import { describe, it, expect } from "vitest";

import { regionBorderIsRect } from "../Utils/region_border_is_rect/index.ts";

type Grid = number[][];

function fullGrid(rows: number, cols: number, v = 1): Grid {
  return Array.from({ length: rows }, () => new Array<number>(cols).fill(v));
}

describe("alg_region_border_is_rect", () => {
  it("整片矩形铺满 → isRect=true（被裁切的开放海域场景）", () => {
    const region = fullGrid(10, 10);
    expect(regionBorderIsRect({ region }).isRect).toBe(true);
  });

  it("矩形铺满但中间挖洞（岛屿）不影响外缘判定 → isRect 仍为 true", () => {
    const region = fullGrid(10, 10);
    region[4][4] = 0;
    region[4][5] = 0;
    region[5][4] = 0;
    region[5][5] = 0;
    expect(regionBorderIsRect({ region }).isRect).toBe(true);
  });

  it("外接矩形边上出现空缺 → isRect=false（天然海岸线/有机轮廓）", () => {
    const region = fullGrid(10, 10);
    region[0][0] = 0; // 挖掉一角，边上出现空缺
    expect(regionBorderIsRect({ region }).isRect).toBe(false);
  });

  it("圆形/有机形状的紧贴外接矩形四角必然缺格 → isRect=false", () => {
    const size = 11;
    const region: Grid = Array.from({ length: size }, () => new Array<number>(size).fill(0));
    const cx = 5, cy = 5, r = 5;
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) region[y][x] = 1;
      }
    expect(regionBorderIsRect({ region }).isRect).toBe(false);
  });

  it("无有效格 → isRect=false", () => {
    const region = fullGrid(5, 5, 0);
    expect(regionBorderIsRect({ region }).isRect).toBe(false);
  });

  it("缺少 region 返回 error", () => {
    expect(regionBorderIsRect({}).error).toBeTruthy();
  });
});
