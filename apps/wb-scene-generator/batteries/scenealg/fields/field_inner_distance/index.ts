/**
 * fieldInnerDistance: 到「内部 0 区域边界」的多源 BFS 距离场。
 *
 * 与 field_distance 的关键区别：先用 border flood-fill 把 0 格分成「外部背景」（与网格边界
 * 连通的 0 格）与「内部洞」（被有效区域包围的 0 格，如海洋里的岛屿）。距离源默认只取
 * 「有效格中 4-邻接到内部洞的格」（= 内部 0 边界）；includeOuterBoundary 为真时，再并入
 * 「外缘格」（位于网格边缘、或 4-邻接到外部背景 0 格的有效格）作为源（= 区域外缘/海岸线）。
 *
 * 典型用法：
 *   · 海洋区域（水=有效格，内部岛屿=0 内部洞）：includeOuterBoundary=false → 到岛屿岸线的距离，
 *     近=浅海、远=深海（开阔海域距任何岛都远）。
 *   · 岛屿/实心陆地（陆地=有效格，四周海=外部背景）：includeOuterBoundary=true → 到外缘海岸线
 *     的距离，近=海岸线、远=内陆。岛屿无内部洞，必须开 includeOuterBoundary 才有源。
 *
 * 输入：region (grid) 0/1（或多值）区，非零格为有效格；BFS 只在有效格内传播
 *       includeOuterBoundary (bool/number, default false) — 是否把区域外缘并入源
 *       connectivity (number, default 4) — BFS 邻接：4=上下左右，8=含对角
 *       normalize (bool, default false) — 是否把可达距离线性归一化到 [0,1]
 * 输出：field (grid) — 源格=0，逐层+1；区域外无效格=0；区域内但 BFS 不可达的有效格=-1。
 */

type Grid = number[][];

function truthy(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v !== '' && v !== 'false' && v !== '0';
  return false;
}

function neighbors4(r: number, c: number, rows: number, cols: number): [number, number][] {
  const out: [number, number][] = [];
  if (r > 0) out.push([r - 1, c]);
  if (r < rows - 1) out.push([r + 1, c]);
  if (c > 0) out.push([r, c - 1]);
  if (c < cols - 1) out.push([r, c + 1]);
  return out;
}

function neighbors(r: number, c: number, rows: number, cols: number, conn8: boolean): [number, number][] {
  const out = neighbors4(r, c, rows, cols);
  if (conn8) {
    if (r > 0 && c > 0) out.push([r - 1, c - 1]);
    if (r > 0 && c < cols - 1) out.push([r - 1, c + 1]);
    if (r < rows - 1 && c > 0) out.push([r + 1, c - 1]);
    if (r < rows - 1 && c < cols - 1) out.push([r + 1, c + 1]);
  }
  return out;
}

/**
 * 标记「外部背景」0 格：从网格四边的 0 格出发 4-连通 flood-fill。
 * 返回 outerZero[r][c]=true 表示该 0 格与网格边界连通（外部背景）；其余 0 格为内部洞。
 */
function markOuterZeros(region: Grid, rows: number, cols: number): boolean[][] {
  const outer: boolean[][] = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));
  const stack: [number, number][] = [];
  const isZero = (r: number, c: number): boolean => (region[r]?.[c] ?? 0) === 0;

  const seedBorder = (r: number, c: number): void => {
    if (isZero(r, c) && !outer[r][c]) {
      outer[r][c] = true;
      stack.push([r, c]);
    }
  };
  for (let c = 0; c < cols; c++) { seedBorder(0, c); seedBorder(rows - 1, c); }
  for (let r = 0; r < rows; r++) { seedBorder(r, 0); seedBorder(r, cols - 1); }

  while (stack.length > 0) {
    const [r, c] = stack.pop()!;
    for (const [nr, nc] of neighbors4(r, c, rows, cols)) {
      if (isZero(nr, nc) && !outer[nr][nc]) {
        outer[nr][nc] = true;
        stack.push([nr, nc]);
      }
    }
  }
  return outer;
}

export function fieldInnerDistance(input: Record<string, unknown>): Record<string, unknown> {
  const region = input.region as Grid | undefined;
  if (!region || region.length === 0 || (region[0]?.length ?? 0) === 0) {
    return { error: 'region is required' };
  }

  const rows = region.length;
  const cols = region[0].length;
  const conn8 = typeof input.connectivity === 'number' ? Math.round(input.connectivity) === 8 : false;
  const normalize = truthy(input.normalize);
  const includeOuter = truthy(input.includeOuterBoundary);

  const valid = (r: number, c: number): boolean => (region[r]?.[c] ?? 0) !== 0;
  const outerZero = markOuterZeros(region, rows, cols);

  // dist: -1 = 未访问/不可达；无效格最后统一改 0。
  const dist: Grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(-1));
  let frontier: [number, number][] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!valid(r, c)) continue;
      let isSource = false;
      // 4-邻接判定：越界=外缘接触；0 格按 outer/inner 分类。
      for (const [nr, nc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]] as const) {
        const oob = nr < 0 || nr >= rows || nc < 0 || nc >= cols;
        if (oob) {
          if (includeOuter) { isSource = true; break; }
          continue;
        }
        if ((region[nr]?.[nc] ?? 0) === 0) {
          if (outerZero[nr][nc]) {
            if (includeOuter) { isSource = true; break; }
          } else {
            // 内部洞边界：始终是源
            isSource = true;
            break;
          }
        }
      }
      if (isSource) {
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
