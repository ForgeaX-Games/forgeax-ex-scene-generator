/**
 * riverBridge（河流架桥）
 * straight：垂直局部流向的投影直线桥
 * zigzag  ：连连看折线桥（≤2次H/V转弯），连接两侧河岸端点，路宽膨胀
 *
 * DataTree 数据格式：输入 inputGrid 与输出 outputGrid 均为 grid/access:item——
 * 本算子每次只处理单张网格，网格列表由引擎按 DataTree 自动逐张 fanout / 重组。
 */

type NameEntry = { id: number; name: string; type?: string };

// ── PCA ──────────────────────────────────────────────────────────────────────

interface PCAResult { dr: number; dc: number; mr: number; mc: number }

function computePCA(cells: [number, number][]): PCAResult {
  const n = cells.length;
  const mr = cells.reduce((s, [r]) => s + r, 0) / n;
  const mc = cells.reduce((s, [, c]) => s + c, 0) / n;
  if (n < 2) return { dr: 1, dc: 0, mr, mc };
  let vr = 0, vc = 0, cov = 0;
  for (const [r, c] of cells) {
    const dr = r - mr, dc = c - mc;
    vr += dr * dr; vc += dc * dc; cov += dr * dc;
  }
  vr /= n; vc /= n; cov /= n;
  if (Math.abs(cov) < 1e-10) return vr >= vc ? { dr: 1, dc: 0, mr, mc } : { dr: 0, dc: 1, mr, mc };
  const mid = (vr + vc) / 2;
  const disc = Math.sqrt(((vr - vc) / 2) ** 2 + cov * cov);
  const λ = mid + disc;
  const er = cov, ec = λ - vr;
  const len = Math.hypot(er, ec);
  return { dr: er / len, dc: ec / len, mr, mc };
}

function arrMin(a: number[]): number { let m = a[0]; for (let i = 1; i < a.length; i++) if (a[i] < m) m = a[i]; return m; }
function arrMax(a: number[]): number { let m = a[0]; for (let i = 1; i < a.length; i++) if (a[i] > m) m = a[i]; return m; }

// ── 连连看寻路（复用 road_connect_link 算法）─────────────────────────────────

type Grid = number[][];

function isLineClear(r1: number, c1: number, r2: number, c2: number, obs: Grid, rows: number, cols: number): boolean {
  if (r1 === r2) {
    const lo = Math.min(c1, c2), hi = Math.max(c1, c2);
    for (let c = lo + 1; c < hi; c++) { if (c < 0 || c >= cols || obs[r1][c] !== 0) return false; }
    return true;
  }
  if (c1 === c2) {
    const lo = Math.min(r1, r2), hi = Math.max(r1, r2);
    for (let r = lo + 1; r < hi; r++) { if (r < 0 || r >= rows || obs[r][c1] !== 0) return false; }
    return true;
  }
  return false;
}

function isRowSeg(row: number, lo: number, hi: number, obs: Grid, cols: number): boolean {
  if (row < 0 || row >= obs.length) return false;
  for (let c = lo; c <= hi; c++) { if (c < 0 || c >= cols || obs[row][c] !== 0) return false; }
  return true;
}
function isColSeg(col: number, lo: number, hi: number, obs: Grid, rows: number): boolean {
  if (col < 0 || col >= (obs[0]?.length ?? 0)) return false;
  for (let r = lo; r <= hi; r++) { if (r < 0 || r >= rows || obs[r][col] !== 0) return false; }
  return true;
}

function lineCells(r1: number, c1: number, r2: number, c2: number): [number, number][] {
  const out: [number, number][] = [];
  if (r1 === r2) { const s = c1 <= c2 ? 1 : -1; for (let c = c1; c !== c2 + s; c += s) out.push([r1, c]); }
  else if (c1 === c2) { const s = r1 <= r2 ? 1 : -1; for (let r = r1; r !== r2 + s; r += s) out.push([r, c1]); }
  return out;
}

function linkPath(r1: number, c1: number, r2: number, c2: number, obs: Grid, rows: number, cols: number): [number, number][] | null {
  // 0转弯：直线
  if ((r1 === r2 || c1 === c2) && isLineClear(r1, c1, r2, c2, obs, rows, cols))
    return lineCells(r1, c1, r2, c2);

  // 1转弯：L形
  for (const [mr, mc] of [[r1, c2], [r2, c1]] as [number, number][]) {
    if (mr < 0 || mr >= rows || mc < 0 || mc >= cols) continue;
    if (obs[mr][mc] !== 0) continue;
    if (isLineClear(r1, c1, mr, mc, obs, rows, cols) && isLineClear(mr, mc, r2, c2, obs, rows, cols))
      return [...lineCells(r1, c1, mr, mc), ...lineCells(mr, mc, r2, c2).slice(1)];
  }

  // 2转弯：扫描中继行/列，取最短路径
  let best: [number, number][] | null = null;

  for (let mr = 0; mr < rows; mr++) {
    if (
      isColSeg(c1, Math.min(r1, mr), Math.max(r1, mr), obs, rows) &&
      isRowSeg(mr, Math.min(c1, c2), Math.max(c1, c2), obs, cols) &&
      isColSeg(c2, Math.min(mr, r2), Math.max(mr, r2), obs, rows)
    ) {
      const path = [...lineCells(r1, c1, mr, c1), ...lineCells(mr, c1, mr, c2).slice(1), ...lineCells(mr, c2, r2, c2).slice(1)];
      if (!best || path.length < best.length) best = path;
    }
  }
  for (let mc = 0; mc < cols; mc++) {
    if (
      isRowSeg(r1, Math.min(c1, mc), Math.max(c1, mc), obs, cols) &&
      isColSeg(mc, Math.min(r1, r2), Math.max(r1, r2), obs, rows) &&
      isRowSeg(r2, Math.min(mc, c2), Math.max(mc, c2), obs, cols)
    ) {
      const path = [...lineCells(r1, c1, r1, mc), ...lineCells(r1, mc, r2, mc).slice(1), ...lineCells(r2, mc, r2, c2).slice(1)];
      if (!best || path.length < best.length) best = path;
    }
  }

  return best;
}

// ── 获取河岸出口方向（从边缘格子向河外延伸的主方向）────────────────────────

/**
 * 计算 pt 处河岸的出口方向（指向非 v 区域），
 * 统计所有非 v 四邻居的方向向量之和，取主轴方向（H 或 V），
 * 用于将桥延伸到河岸外的陆地。
 */
function getExitDir(pt: [number, number], grid: Grid, v: number, H: number, W: number): [number, number] {
  const [r, c] = pt;
  let sumDr = 0, sumDc = 0;
  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as [number, number][]) {
    const nr = r + dr, nc = c + dc;
    if (nr >= 0 && nr < H && nc >= 0 && nc < W && grid[nr][nc] !== v) {
      sumDr += dr; sumDc += dc;
    }
  }
  if (sumDr === 0 && sumDc === 0) return [0, 0];
  // 取主轴方向（避免对角延伸）
  if (Math.abs(sumDr) >= Math.abs(sumDc)) return [Math.sign(sumDr) as -1 | 0 | 1, 0];
  return [0, Math.sign(sumDc) as -1 | 0 | 1];
}

// ── Bresenham 直线 ──────────────────────────────────────────────────────────

function bresenhamLine(a: [number, number], b: [number, number]): [number, number][] {
  const out: [number, number][] = [];
  let [r0, c0] = a;
  const [r1, c1] = b;
  const dr = Math.abs(r1 - r0), dc = Math.abs(c1 - c0);
  const sr = r0 < r1 ? 1 : -1, sc = c0 < c1 ? 1 : -1;
  let err = dr - dc;
  for (;;) {
    out.push([r0, c0]);
    if (r0 === r1 && c0 === c1) break;
    const e2 = 2 * err;
    if (e2 > -dc) { err -= dc; r0 += sr; }
    if (e2 < dr) { err += dr; c0 += sc; }
  }
  return out;
}

// ── 对角补点（将角接关系修复为四连通）──────────────────────────────────────

/**
 * 遍历 out 中值为 v 的格子，若两个桥格子只有角接关系（对角相邻但无公共四邻居桥格），
 * 则在两者共享的角点位置补一个格子，优先选在河流内部的那个角点。
 * 迭代直到稳定，确保多步阶梯也被完整修复。
 */
function fixDiagonalConnections(out: Grid, grid: Grid, v: number, H: number, W: number): void {
  const DIAG: [number, number][] = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  let changed = true;
  while (changed) {
    changed = false;
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        if (out[r][c] !== v) continue;
        for (const [dr, dc] of DIAG) {
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nr >= H || nc < 0 || nc >= W) continue;
          if (out[nr][nc] !== v) continue;
          // 两个候选角点
          const c1r = nr, c1c = c;   // (nr, c)
          const c2r = r,  c2c = nc;  // (r,  nc)
          const c1Bridge = out[c1r][c1c] === v;
          const c2Bridge = out[c2r][c2c] === v;
          if (c1Bridge || c2Bridge) continue; // 已经四连通
          // 优先选在河流内的角点；两个都在河流内就选距中点更近的
          const c1River = grid[c1r][c1c] === v;
          const c2River = grid[c2r][c2c] === v;
          if (c1River) { out[c1r][c1c] = v; changed = true; }
          else if (c2River) { out[c2r][c2c] = v; changed = true; }
        }
      }
    }
  }
}

// ── 路宽膨胀（只在河流内部扩展）─────────────────────────────────────────────

function dilateInRiver(pathCells: [number, number][], grid: Grid, v: number, width: number, H: number, W: number): [number, number][] {
  if (width <= 1) return pathCells;
  const radius = Math.floor(width / 2);
  const set = new Set(pathCells.map(([r, c]) => r * W + c));
  const extra: [number, number][] = [];
  for (const [r, c] of pathCells) {
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= H || nc < 0 || nc >= W) continue;
        if (grid[nr][nc] !== v) continue; // 只扩到河流内部
        const key = nr * W + nc;
        if (!set.has(key)) { set.add(key); extra.push([nr, nc]); }
      }
    }
  }
  return [...pathCells, ...extra];
}

// ── 找两侧河岸最近端点对（两个算法共用）────────────────────────────────────

interface BridgeEndpoints {
  ptA: [number, number];
  ptB: [number, number];
}

/**
 * 用 flood-fill 对"岸外格子"做连通性分析来区分真正的两侧河岸，
 * 然后从最大两组边缘格子中找欧式距离最近的一对。
 *
 * 河岸边缘 = 至少有一个非 v 的 4-邻居的河流格子。
 * 岸外格子 = 边缘格子向非河流方向延伸的非 v 邻居。
 * 属于同一连通区域的岸外格子 → 对应同一侧河岸。
 */
function findBridgeEndpoints(
  cells: [number, number][],
  lFlowProjs: number[],
  bridgePL: number, halfW: number, localWindow: number,
  grid: Grid, v: number, H: number, W: number
): BridgeEndpoints | null {

  const windows = Array.from(
    new Set([halfW, halfW * 2, halfW * 4, localWindow, localWindow * 2])
  ).sort((a, b) => a - b);

  const DIR4: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  for (const sw of windows) {
    // 1. 收集窗口内的河岸边缘格子及其岸外邻居
    const edgeCells: [number, number][] = [];
    const outerNeighbors = new Map<number, number[]>(); // edgeIdx → [outerKey, ...]

    for (let i = 0; i < cells.length; i++) {
      if (Math.abs(lFlowProjs[i] - bridgePL) > sw) continue;
      const [r, c] = cells[i];
      const outers: number[] = [];
      for (const [dr, dc] of DIR4) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < H && nc >= 0 && nc < W && grid[nr][nc] !== v) {
          outers.push(nr * W + nc);
        }
      }
      if (outers.length > 0) {
        outerNeighbors.set(edgeCells.length, outers);
        edgeCells.push([r, c]);
      }
    }

    if (edgeCells.length < 2) continue;

    // 2. 对所有岸外格子做 flood-fill 连通性分析（4-连通，在非 v 区域扩展）
    const outerLabel = new Map<number, number>(); // outerKey → componentId
    let nextLabel = 0;

    const allOuterKeys = new Set<number>();
    for (const outers of outerNeighbors.values())
      for (const k of outers) allOuterKeys.add(k);

    for (const startKey of allOuterKeys) {
      if (outerLabel.has(startKey)) continue;
      const label = nextLabel++;
      const queue = [startKey];
      outerLabel.set(startKey, label);
      while (queue.length > 0) {
        const key = queue.pop()!;
        const kr = Math.floor(key / W), kc = key % W;
        for (const [dr, dc] of DIR4) {
          const nr = kr + dr, nc = kc + dc;
          if (nr < 0 || nr >= H || nc < 0 || nc >= W) continue;
          if (grid[nr][nc] === v) continue;
          const nk = nr * W + nc;
          if (!allOuterKeys.has(nk)) continue;
          if (outerLabel.has(nk)) continue;
          outerLabel.set(nk, label);
          queue.push(nk);
        }
      }
    }

    // 3. 每个边缘格子的"岸标签"取其岸外邻居中最常见的 componentId
    const edgeBankLabel: number[] = [];
    for (let ei = 0; ei < edgeCells.length; ei++) {
      const outers = outerNeighbors.get(ei)!;
      const counts = new Map<number, number>();
      for (const ok of outers) {
        const lb = outerLabel.get(ok);
        if (lb !== undefined) counts.set(lb, (counts.get(lb) ?? 0) + 1);
      }
      let bestLabel = -1, bestCount = 0;
      for (const [lb, cnt] of counts) {
        if (cnt > bestCount) { bestCount = cnt; bestLabel = lb; }
      }
      edgeBankLabel.push(bestLabel);
    }

    // 4. 按 componentId 分组，取最大两组
    const bankGroups = new Map<number, number[]>(); // componentId → [edgeIdx, ...]
    for (let ei = 0; ei < edgeCells.length; ei++) {
      const lb = edgeBankLabel[ei];
      if (lb < 0) continue;
      if (!bankGroups.has(lb)) bankGroups.set(lb, []);
      bankGroups.get(lb)!.push(ei);
    }

    const sortedGroups = [...bankGroups.values()].sort((a, b) => b.length - a.length);
    if (sortedGroups.length < 2) continue;

    const bankA = sortedGroups[0];
    const bankB = sortedGroups[1];

    // 5. 从两组中找欧式距离最近的一对
    let best: BridgeEndpoints | null = null;
    let minDist = Infinity;
    for (const ai of bankA) {
      for (const bi of bankB) {
        const [ar, ac] = edgeCells[ai];
        const [br, bc] = edgeCells[bi];
        const d = Math.hypot(ar - br, ac - bc);
        if (d < minDist) {
          minDist = d;
          best = { ptA: edgeCells[ai], ptB: edgeCells[bi] };
        }
      }
    }
    if (best) return best;
  }

  return null;
}

// ── 主函数 ───────────────────────────────────────────────────────────────────

function buildBridgeMask(grid: Grid, width: number, position: number, algorithm: string, landExt: number): Grid {
  const H = grid.length, W = H > 0 ? grid[0].length : 0;
  const out: Grid = Array.from({ length: H }, () => new Array(W).fill(0));

  const regionCells = new Map<number, [number, number][]>();
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++) {
      const v = grid[r][c];
      if (v !== 0) {
        if (!regionCells.has(v)) regionCells.set(v, []);
        regionCells.get(v)!.push([r, c]);
      }
    }

  for (const [v, cells] of regionCells) {
    if (cells.length < 2) continue;

    // ── 全局 PCA 定位桥在河流上的大致位置 ──
    const g = computePCA(cells);
    const gProjs = cells.map(([r, c]) => (r - g.mr) * g.dr + (c - g.mc) * g.dc);
    const gMin = arrMin(gProjs), gMax = arrMax(gProjs);
    const targetProj = gMin + position * (gMax - gMin);

    // ── 局部 PCA：取附近 20% 窗口的格子 ──
    const localWindow = Math.max(5, (gMax - gMin) * 0.2);
    const localIdx = gProjs.map((_, i) => i).filter(i => Math.abs(gProjs[i] - targetProj) <= localWindow);
    const localCells = localIdx.map(i => cells[i]);
    const l = computePCA(localCells.length >= 3 ? localCells : cells);

    // ── 局部流向投影 ──
    const lFlowProjs = cells.map(([r, c]) => (r - l.mr) * l.dr + (c - l.mc) * l.dc);
    const localFlowPs = localIdx.map(i => lFlowProjs[i]);
    const bridgePL = (arrMin(localFlowPs) + arrMax(localFlowPs)) / 2;
    const halfW = width / 2;

    // ── 找两侧河岸最近端点对（两种算法共用）──
    const endpoints = findBridgeEndpoints(
      cells, lFlowProjs,
      bridgePL, halfW, localWindow,
      grid, v, H, W
    );

    if (!endpoints) {
      // 极端 fallback：纯投影直线桥
      for (let i = 0; i < cells.length; i++) {
        if (Math.abs(lFlowProjs[i] - bridgePL) < halfW)
          out[cells[i][0]][cells[i][1]] = v;
      }
      continue;
    }

    const { ptA, ptB } = endpoints;

    if (algorithm === "straight") {
      const straightPath = bresenhamLine(ptA, ptB);
      const expanded = dilateInRiver(straightPath, grid, v, width, H, W);
      for (const [r, c] of expanded) out[r][c] = v;
    } else {
      // ── 连连看折线桥 ──
      const riverObs: Grid = grid.map(row => row.map(cv => cv !== v ? 1 : 0));
      const path = linkPath(ptA[0], ptA[1], ptB[0], ptB[1], riverObs, H, W);

      if (path && path.length > 0) {
        const expanded = dilateInRiver(path as [number, number][], grid, v, width, H, W);
        for (const [r, c] of expanded) out[r][c] = v;
      } else {
        // linkPath 失败：降级用 Bresenham 直线
        const straightPath = bresenhamLine(ptA, ptB);
        const expanded = dilateInRiver(straightPath, grid, v, width, H, W);
        for (const [r, c] of expanded) out[r][c] = v;
      }
    }

    // ── 河岸延伸（桥落点延伸到河外陆地）──
    if (landExt > 0) {
      for (const pt of [ptA, ptB] as [number, number][]) {
        const [dr, dc] = getExitDir(pt, grid, v, H, W);
        if (dr === 0 && dc === 0) continue;
        for (let i = 1; i <= landExt; i++) {
          const er = pt[0] + i * dr, ec = pt[1] + i * dc;
          if (er < 0 || er >= H || ec < 0 || ec >= W) break;
          out[er][ec] = v;
        }
      }
    }
  }

  // ── 后处理：修复对角角接 → 四连通 ──
  for (const v of regionCells.keys()) {
    fixDiagonalConnections(out, grid, v, H, W);
  }

  return out;
}

/** 解析单张二维网格（number[][]）；非法返回 null。
 * DataTree 模型下引擎按 access:item 对网格列表自动 fanout，本算子每次只收到一张网格。 */
function parseGrid(raw: unknown): Grid | null {
  if (!raw || !Array.isArray(raw) || raw.length === 0) return null;
  if (Array.isArray(raw[0]) && typeof (raw[0] as unknown[])[0] === "number") {
    return raw as Grid;
  }
  return null;
}

export function riverBridge(input: Record<string, unknown>): Record<string, unknown> {
  const grid = parseGrid(input.inputGrid);
  if (!grid) return { error: "inputGrid is required" };
  if (grid.length === 0 || grid[0].length === 0) return { error: "inputGrid is empty" };

  const width = typeof input.width === "number" ? Math.max(1, Math.trunc(input.width)) : 1;
  const position = typeof input.position === "number" ? Math.min(1, Math.max(0, input.position)) : 0.5;
  const algorithm = typeof input.algorithm === "string" && input.algorithm === "zigzag" ? "zigzag" : "straight";
  const extendToLand = typeof input.extendToLand === "boolean" ? input.extendToLand : true;
  const landExt = extendToLand ? 1 : 0;

  const BRIDGE_ID = 1;

  const raw = buildBridgeMask(grid, width, position, algorithm, landExt);
  // 将桥格统一改写为 BRIDGE_ID，与名称清单对应
  const outputGrid = raw.map(row => row.map(v => (v !== 0 ? BRIDGE_ID : 0)));

  const outputNameList: NameEntry[] = [{ id: BRIDGE_ID, name: "桥", type: "tile" }];

  return { outputGrid, outputNameList };
}
