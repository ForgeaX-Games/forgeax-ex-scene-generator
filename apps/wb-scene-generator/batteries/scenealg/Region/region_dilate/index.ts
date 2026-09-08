/**
 * regionDilate: 对区域做 N 步形态学膨胀（BFS 外扩），输出膨胀后的 0/1 区域。
 *
 * 输入：region (grid) — 0/1（或多值）区域，非零格视为前景
 *       steps (number) — 膨胀步数 / 半径
 *       connectivity (number, 4 或 8) — 邻接方式，默认 4
 * 输出：region (grid) — 膨胀后的 0/1 区域，与输入同形状
 *
 * 这是 lake_gen 里 buildForbiddenZone（对湖泊格 BFS 外扩成间距禁区）的通用化：独立后可被任何
 * 「外扩 / 禁区 / 缓冲带 / 加粗」场景复用。纯 grid 形态学算子，无随机性。单 region 输入由
 * autoIterate fanout。
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
      for (const [nr, nc] of neighbors(r, c, rows, cols, conn8)) {
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

export function regionDilate(input: Record<string, unknown>): Record<string, unknown> {
  const region = input.region as Grid | undefined;
  if (!region || region.length === 0 || (region[0]?.length ?? 0) === 0) {
    return { error: "region is required" };
  }
  const steps = typeof input.steps === "number" ? Math.max(0, Math.round(input.steps)) : 1;
  const conn8 = typeof input.connectivity === "number" ? Math.round(input.connectivity) === 8 : false;
  return { region: dilateOne(region, steps, conn8) };
}
