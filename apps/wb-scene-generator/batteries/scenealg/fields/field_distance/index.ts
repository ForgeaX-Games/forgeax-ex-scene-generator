/**
 * fieldDistance: 多源 BFS 距离变换 —— 对输入 region 的有效格，计算每个有效格到「源」的最短网格
 * 距离场（field/标量场，每格一个距离标量），只在 region 有效格内传播（不穿越无效格）。
 *
 * 输入：region (grid)  — 0/1（或多值）约束区，非零格为有效格；BFS 只在有效格内扩散
 *       source (grid, 可选) — 源格掩码：
 *                            · 接了 source：以 source 的非零格（且落在 region 有效格内）为 BFS 多源源点
 *                            · 没接 source：默认以 region 的「边界有效格」为源（有效格但至少一个 4-邻接
 *                              方向越界或是无效格），即输出每格到区域边界的距离
 *       connectivity (number, default 4) — 4=上下左右，8=含对角
 *       normalize (bool, default false) — true 时把有效格距离线性归一化到 [0,1]（除以最大距离）
 * 输出：field (grid) — 距离场（number[][]）：源格=0，逐层 +1；region 外的无效格 = 0；region 内
 *                      但 BFS 不可达的有效格 = -1（用 -1 区分"无效格"与"可达距离 0 的源格"）。
 *                      normalize=true 时可达有效格归一化到 [0,1]，无效格仍 0，不可达仍 -1。
 *
 * field 是 scenealg 体系里区别于 region（0/1 掩码）的基本类型：grid 上每格输出一个标量数值。
 * BFS 写法沿用 region_dilate 的逐层 frontier 外扩。单 region 输入由 autoIterate fanout。
 */

type Grid = number[][];

function neighbors(r: number, c: number, rows: number, cols: number, conn8: boolean): [number, number][] {
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

/** 有效格但至少一个 4-邻接方向越界或落在无效格上，即为区域边界格。 */
function isBoundary(region: Grid, r: number, c: number, rows: number, cols: number): boolean {
  if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) return true;
  if ((region[r - 1][c] ?? 0) === 0) return true;
  if ((region[r + 1][c] ?? 0) === 0) return true;
  if ((region[r][c - 1] ?? 0) === 0) return true;
  if ((region[r][c + 1] ?? 0) === 0) return true;
  return false;
}

export function fieldDistance(input: Record<string, unknown>): Record<string, unknown> {
  const region = input.region as Grid | undefined;
  if (!region || region.length === 0 || (region[0]?.length ?? 0) === 0) {
    return { error: "region is required" };
  }

  const rows = region.length;
  const cols = region[0].length;
  const conn8 = typeof input.connectivity === "number" ? Math.round(input.connectivity) === 8 : false;
  const normalize = input.normalize === true;
  const source = input.source as Grid | undefined;

  const valid = (r: number, c: number): boolean => (region[r]?.[c] ?? 0) !== 0;

  // -1 表示"未访问/不可达"，无效格也先填 -1，最后无效格统一改为 0。
  const dist: Grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(-1));

  let frontier: [number, number][] = [];
  const hasSource = !!source && source.length === rows && (source[0]?.length ?? 0) === cols;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!valid(r, c)) continue;
      const isSrc = hasSource
        ? (source![r]?.[c] ?? 0) !== 0
        : isBoundary(region, r, c, rows, cols);
      if (isSrc) {
        dist[r][c] = 0;
        frontier.push([r, c]);
      }
    }
  }

  let d = 0;
  while (frontier.length > 0) {
    d++;
    const next: [number, number][] = [];
    for (const [r, c] of frontier) {
      for (const [nr, nc] of neighbors(r, c, rows, cols, conn8)) {
        if (!valid(nr, nc)) continue;
        if (dist[nr][nc] !== -1) continue;
        dist[nr][nc] = d;
        next.push([nr, nc]);
      }
    }
    frontier = next;
  }

  if (normalize) {
    let maxD = 0;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) if (dist[r][c] > maxD) maxD = dist[r][c];
    if (maxD > 0) {
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          if (dist[r][c] > 0) dist[r][c] = dist[r][c] / maxD;
        }
    }
  }

  // 无效格（region 外）输出 0；region 内不可达的有效格保持 -1。
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (!valid(r, c)) dist[r][c] = 0;
    }

  return { field: dist };
}
