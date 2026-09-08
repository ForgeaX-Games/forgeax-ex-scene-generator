/**
 * regionOffset: 对区域做有符号形态学偏移（支持不规则区域）。
 *
 * 输入：region (grid) — 0/1（或多值）区域，非零格视为前景
 *       offset (number) — 偏移距离（格）。>0 外扩（膨胀），<0 内缩（腐蚀），0 仅归一化
 *       connectivity (number, 4 或 8) — 邻接方式，默认 4
 * 输出：region (grid) — 偏移后的 0/1 区域，与输入同形状
 *       ring (grid) — 原区域与偏移结果的对称差（边带 / 缓冲环）
 *
 * 外扩 = 前景 BFS（同 region_dilate）；内缩 = 到背景（含网格外）的距离场阈值。
 * 不规则轮廓按格邻接逐圈推进，不要求矩形。纯 grid 形态学算子，无随机性。
 */

type Grid = number[][];

function neighborsInBounds(
  r: number,
  c: number,
  rows: number,
  cols: number,
  conn8: boolean,
): [number, number][] {
  const out: [number, number][] = [];
  if (r > 0) out.push([r - 1, c]);
  if (r < rows - 1) out.push([r + 1, c]);
  if (c > 0) out.push([r, c - 1]);
  if (c < cols - 1) out.push([r, c + 1]);
  if (conn8) {
    if (r > 0 && c > 0) out.push([r - 1, c - 1]);
    if (r > 0 && c < cols - 1) out.push([r - 1, c + 1]);
    if (r < rows - 1 && c > 0) out.push([r + 1, c - 1]);
    if (r < rows - 1 && c < cols - 1) out.push([r + 1, c + 1]);
  }
  return out;
}

function normalize01(region: Grid): Grid {
  return region.map((row) => row.map((v) => (v !== 0 ? 1 : 0)));
}

/** 前景 BFS 外扩 steps 圈（与 region_dilate 同算法）。 */
function dilateOne(region: Grid, steps: number, conn8: boolean): Grid {
  const rows = region.length;
  const cols = region[0].length;
  const inside = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));

  let frontier: [number, number][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (region[r][c] !== 0) {
        inside[r][c] = true;
        frontier.push([r, c]);
      }
    }
  }

  for (let d = 0; d < steps; d++) {
    if (frontier.length === 0) break;
    const next: [number, number][] = [];
    for (const [r, c] of frontier) {
      for (const [nr, nc] of neighborsInBounds(r, c, rows, cols, conn8)) {
        if (!inside[nr][nc]) {
          inside[nr][nc] = true;
          next.push([nr, nc]);
        }
      }
    }
    frontier = next;
  }

  return inside.map((row) => row.map((v) => (v ? 1 : 0)));
}

/**
 * 腐蚀：扩一圈背景边（网格外 = 背景），对到背景的距离场取阈值。
 * 保留 dist > steps 的前景格；与 dilate 在同一邻接下互为形态学对偶。
 */
function erodeOne(region: Grid, steps: number, conn8: boolean): Grid {
  const rows = region.length;
  const cols = region[0].length;
  // 扩边 1 格全 0，使网格外缘自然成为背景源
  const pr = rows + 2;
  const pc = cols + 2;
  const padded: Grid = Array.from({ length: pr }, () => new Array<number>(pc).fill(0));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      padded[r + 1][c + 1] = region[r][c] !== 0 ? 1 : 0;
    }
  }

  const dist = Array.from({ length: pr }, () => new Array<number>(pc).fill(Infinity));
  const queue: [number, number][] = [];
  for (let r = 0; r < pr; r++) {
    for (let c = 0; c < pc; c++) {
      if (padded[r][c] === 0) {
        dist[r][c] = 0;
        queue.push([r, c]);
      }
    }
  }

  let qi = 0;
  while (qi < queue.length) {
    const [r, c] = queue[qi++]!;
    const base = dist[r][c];
    for (const [nr, nc] of neighborsInBounds(r, c, pr, pc, conn8)) {
      const nd = base + 1;
      if (nd < dist[nr][nc]) {
        dist[nr][nc] = nd;
        queue.push([nr, nc]);
      }
    }
  }

  const out: Grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (region[r][c] !== 0 && dist[r + 1][c + 1] > steps) out[r][c] = 1;
    }
  }
  return out;
}

function xorRing(a: Grid, b: Grid): Grid {
  const rows = a.length;
  const cols = a[0].length;
  const out: Grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const av = a[r][c] !== 0 ? 1 : 0;
      const bv = b[r][c] !== 0 ? 1 : 0;
      out[r][c] = av !== bv ? 1 : 0;
    }
  }
  return out;
}

export function regionOffset(input: Record<string, unknown>): Record<string, unknown> {
  const region = input.region as Grid | undefined;
  if (!region || region.length === 0 || (region[0]?.length ?? 0) === 0) {
    return { error: "region is required" };
  }

  const offsetRaw = typeof input.offset === "number" ? Math.round(input.offset) : 0;
  const steps = Math.abs(offsetRaw);
  const conn8 = typeof input.connectivity === "number" ? Math.round(input.connectivity) === 8 : false;

  const original = normalize01(region);
  let result: Grid;
  if (offsetRaw > 0) {
    result = dilateOne(region, steps, conn8);
  } else if (offsetRaw < 0) {
    result = erodeOne(region, steps, conn8);
  } else {
    result = original;
  }

  return { region: result, ring: xorRing(original, result) };
}
