/**
 * generator.ts — 路段分节抖动（Jitter Road Segments）
 *
 * 算法流程：
 *   ① 按 mainSpacing / subSpacing 建立规则交叉点网格
 *   ② 对每个交叉点用哈希函数独立生成 (dR, dC) 偏移
 *      - 边界行交叉点 dR=0，边界列交叉点 dC=0
 *      - H 线和 V 线通过同一张交叉点表获取端点，天然对齐不会断裂
 *   ③ 在每对相邻交叉点间生成抖动中间节点，Bresenham 逐段连线
 *      - 每个节点处补正方形防拐角缺口
 *   ④ 辅路减去主路重叠
 *   ⑤ Flood fill 划分地块
 *
 * 边缘覆盖：allRowPx / allColPx 末尾追加 maxR / maxC 确保路线延伸到掩码边界。
 */

export interface NameEntry {
  id: number;
  name: string;
}

export interface ChessRoadResult {
  mainRoad: number[][];
  subRoad:  number[][];
  parcels:  number[][];
  nameList: NameEntry[];
}

export interface JitterRoadOptions {
  mainSpacing:   number;
  subSpacing:    number;
  mainRoadWidth: number;
  subRoadWidth:  number;
  jitterAmp:     number;
  segmentCount:  number;
  seed:          number;
}

// ---------- Hash-based deterministic per-point RNG ----------

function hashRand(a: number, b: number, c: number, seed: number): number {
  let h = (seed * 2654435761 + a * 40503 + b * 6542287 + c * 1234567) | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b);
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b);
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}

function makeRng(seed: number): () => number {
  let s = (seed === 0 ? Date.now() : seed) >>> 0;
  return () => {
    s = Math.imul(s, 1664525) + 1013904223;
    return (s >>> 0) / 0x100000000;
  };
}

// ---------- Drawing ----------

function paintSegment(
  grid: number[][],
  mask: boolean[][],
  rows: number, cols: number,
  r0: number, c0: number,
  r1: number, c1: number,
  halfW: number,
) {
  const dx = Math.abs(c1 - c0), sx = c0 < c1 ? 1 : -1;
  const dy = -Math.abs(r1 - r0), sy = r0 < r1 ? 1 : -1;
  let err = dx + dy;
  let cc = c0, cr = r0;

  while (true) {
    // Paint a box (not just a strip) at every step to avoid thin-line gaps
    for (let dr = -halfW; dr <= halfW; dr++) {
      for (let dc = -halfW; dc <= halfW; dc++) {
        const pr = cr + dr, pc = cc + dc;
        if (pr >= 0 && pr < rows && pc >= 0 && pc < cols && mask[pr][pc]) grid[pr][pc] = 1;
      }
    }
    if (cc === c1 && cr === r1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { if (cc === c1) break; err += dy; cc += sx; }
    if (e2 <= dx) { if (cr === r1) break; err += dx; cr += sy; }
  }
}

function paintThickBox(
  grid: number[][],
  mask: boolean[][],
  rows: number, cols: number,
  r: number, c: number,
  halfW: number,
) {
  for (let dr = -halfW; dr <= halfW; dr++) {
    for (let dc = -halfW; dc <= halfW; dc++) {
      const pr = r + dr, pc = c + dc;
      if (pr >= 0 && pr < rows && pc >= 0 && pc < cols && mask[pr][pc]) grid[pr][pc] = 1;
    }
  }
}

function paintPolyline(
  grid: number[][],
  mask: boolean[][],
  rows: number, cols: number,
  waypoints: [number, number][],
  halfW: number,
) {
  for (let i = 0; i < waypoints.length - 1; i++) {
    const [r0, c0] = waypoints[i];
    const [r1, c1] = waypoints[i + 1];
    paintSegment(grid, mask, rows, cols, r0, c0, r1, c1, halfW);
  }
  for (const [r, c] of waypoints) {
    paintThickBox(grid, mask, rows, cols, r, c, halfW);
  }
}

// ---------- Flood fill ----------

function floodFillParcels(
  mask: boolean[][],
  mainRoad: number[][],
  subRoad:  number[][],
  rows: number, cols: number,
): { parcels: number[][]; nameList: NameEntry[] } {
  const parcels: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const visited: boolean[][] = Array.from({ length: rows }, () => new Array(cols).fill(false));
  const nameList: NameEntry[] = [];
  let parcelId = 1;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!mask[r][c] || mainRoad[r][c] || subRoad[r][c] || visited[r][c]) continue;
      const queue: [number, number][] = [[r, c]];
      visited[r][c] = true;
      let hasCells = false;
      while (queue.length > 0) {
        const [cr, cc] = queue.shift()!;
        parcels[cr][cc] = parcelId;
        hasCells = true;
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nr = cr + dr, nc = cc + dc;
          if (
            nr >= 0 && nr < rows && nc >= 0 && nc < cols &&
            mask[nr][nc] && !mainRoad[nr][nc] && !subRoad[nr][nc] && !visited[nr][nc]
          ) {
            visited[nr][nc] = true;
            queue.push([nr, nc]);
          }
        }
      }
      if (hasCells) nameList.push({ id: parcelId, name: `地块 ${parcelId}` });
      parcelId++;
    }
  }

  return { parcels, nameList };
}

// ---------- Main ----------

export function generateJitterRoad(
  grid: number[][],
  opts: JitterRoadOptions,
): ChessRoadResult {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const empty = (): number[][] =>
    Array.from({ length: rows }, () => new Array(cols).fill(0));

  if (rows === 0 || cols === 0) {
    return { mainRoad: empty(), subRoad: empty(), parcels: empty(), nameList: [] };
  }

  const mask: boolean[][] = Array.from({ length: rows }, () => new Array(cols).fill(false));
  let minC = cols, minR = rows, maxC = -1, maxR = -1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== 0) {
        mask[r][c] = true;
        if (c < minC) minC = c; if (c > maxC) maxC = c;
        if (r < minR) minR = r; if (r > maxR) maxR = r;
      }
    }
  }
  if (maxC < 0) return { mainRoad: empty(), subRoad: empty(), parcels: empty(), nameList: [] };

  const { mainSpacing, subSpacing, mainRoadWidth, subRoadWidth, jitterAmp, segmentCount, seed } = opts;
  const baseSeed = seed === 0 ? (Date.now() & 0x7fffffff) : (seed | 0);
  const rng = makeRng(baseSeed + 77777);

  const mainHalfW = Math.max(0, Math.floor((mainRoadWidth - 1) / 2));
  const subHalfW  = Math.max(0, Math.floor((subRoadWidth  - 1) / 2));
  const segCount  = Math.max(2, segmentCount);
  const amp       = Math.max(0, jitterAmp);

  // ① Enumerate grid-line positions
  const mainRowPx: number[] = [];
  const subRowPx:  number[] = [];
  for (let r = minR; r <= maxR; r++) {
    const off = r - minR;
    if (off % mainSpacing === 0)                       mainRowPx.push(r);
    else if (subSpacing > 0 && off % subSpacing === 0) subRowPx.push(r);
  }
  const mainColPx: number[] = [];
  const subColPx:  number[] = [];
  for (let c = minC; c <= maxC; c++) {
    const off = c - minC;
    if (off % mainSpacing === 0)                       mainColPx.push(c);
    else if (subSpacing > 0 && off % subSpacing === 0) subColPx.push(c);
  }

  // Merge all positions + add edge boundaries for full coverage
  const allRowPx = [...new Set([...mainRowPx, ...subRowPx])].sort((a, b) => a - b);
  const allColPx = [...new Set([...mainColPx, ...subColPx])].sort((a, b) => a - b);
  if (allRowPx[allRowPx.length - 1] < maxR) allRowPx.push(maxR);
  if (allColPx[allColPx.length - 1] < maxC) allColPx.push(maxC);

  const NR = allRowPx.length;
  const NC = allColPx.length;
  if (NR < 2 || NC < 2) return { mainRoad: empty(), subRoad: empty(), parcels: empty(), nameList: [] };

  // ② Per-intersection INDEPENDENT jitter via hash
  //    H-line at (ri,ci)→(ri,ci+1) and V-line at (ri,ci)→(ri+1,ci)
  //    both read from the same table — endpoint alignment guaranteed.
  const ptR: number[][] = Array.from({ length: NR }, () => new Array(NC).fill(0));
  const ptC: number[][] = Array.from({ length: NR }, () => new Array(NC).fill(0));

  for (let ri = 0; ri < NR; ri++) {
    for (let ci = 0; ci < NC; ci++) {
      const isEdgeRow = ri === 0 || ri === NR - 1;
      const isEdgeCol = ci === 0 || ci === NC - 1;
      const dR = isEdgeRow ? 0 : Math.round((hashRand(ri, ci, 0, baseSeed) * 2 - 1) * amp);
      const dC = isEdgeCol ? 0 : Math.round((hashRand(ri, ci, 1, baseSeed) * 2 - 1) * amp);
      ptR[ri][ci] = allRowPx[ri] + dR;
      ptC[ri][ci] = allColPx[ci] + dC;
    }
  }

  // Index lookups
  const rowIdxOf = new Map<number, number>();
  allRowPx.forEach((r, i) => rowIdxOf.set(r, i));
  const colIdxOf = new Map<number, number>();
  allColPx.forEach((c, i) => colIdxOf.set(c, i));

  const mainRoad = empty();
  const subRoad  = empty();

  // ③ Draw roads — H-lines connect adjacent intersections in a row,
  //                 V-lines connect adjacent intersections in a column.

  const drawHLine = (ri: number, halfW: number, target: number[][]) => {
    for (let ci = 0; ci < NC - 1; ci++) {
      const r0 = ptR[ri][ci],   c0 = ptC[ri][ci];
      const r1 = ptR[ri][ci+1], c1 = ptC[ri][ci+1];
      const waypoints: [number, number][] = [[r0, c0]];
      for (let s = 1; s < segCount; s++) {
        const t = s / segCount;
        const mr = r0 + (r1 - r0) * t;
        const mc = c0 + (c1 - c0) * t;
        const jitter = (rng() * 2 - 1) * amp;
        waypoints.push([Math.round(mr + jitter), Math.round(mc)]);
      }
      waypoints.push([r1, c1]);
      paintPolyline(target, mask, rows, cols, waypoints, halfW);
    }
  };

  const drawVLine = (ci: number, halfW: number, target: number[][]) => {
    for (let ri = 0; ri < NR - 1; ri++) {
      const r0 = ptR[ri][ci],   c0 = ptC[ri][ci];
      const r1 = ptR[ri+1][ci], c1 = ptC[ri+1][ci];
      const waypoints: [number, number][] = [[r0, c0]];
      for (let s = 1; s < segCount; s++) {
        const t = s / segCount;
        const mr = r0 + (r1 - r0) * t;
        const mc = c0 + (c1 - c0) * t;
        const jitter = (rng() * 2 - 1) * amp;
        waypoints.push([Math.round(mr), Math.round(mc + jitter)]);
      }
      waypoints.push([r1, c1]);
      paintPolyline(target, mask, rows, cols, waypoints, halfW);
    }
  };

  // Main roads
  for (const rPx of mainRowPx) { const ri = rowIdxOf.get(rPx); if (ri !== undefined) drawHLine(ri, mainHalfW, mainRoad); }
  for (const cPx of mainColPx) { const ci = colIdxOf.get(cPx); if (ci !== undefined) drawVLine(ci, mainHalfW, mainRoad); }
  // Sub roads
  for (const rPx of subRowPx) { const ri = rowIdxOf.get(rPx); if (ri !== undefined) drawHLine(ri, subHalfW, subRoad); }
  for (const cPx of subColPx) { const ci = colIdxOf.get(cPx); if (ci !== undefined) drawVLine(ci, subHalfW, subRoad); }

  // ④ 4-连通补桥：对角相邻但缺少上下左右桥的道路像素，补一个桥像素
  const bridge4 = (roadGrid: number[][]) => {
    const diags: [number, number][] = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    let changed = true;
    while (changed) {
      changed = false;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (!roadGrid[r][c]) continue;
          for (const [dr, dc] of diags) {
            const nr = r + dr, nc = c + dc;
            if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
            if (!roadGrid[nr][nc]) continue;
            // (r,c) and (nr,nc) are diagonal neighbors and both are road
            // Check if they already share a 4-connected bridge
            if (roadGrid[r + dr][c] || roadGrid[r][c + dc]) continue;
            // No bridge — add one at (r+dr, c) if inside mask, else (r, c+dc)
            if (mask[r + dr][c]) {
              roadGrid[r + dr][c] = 1;
            } else if (mask[r][c + dc]) {
              roadGrid[r][c + dc] = 1;
            }
            changed = true;
          }
        }
      }
    }
  };
  bridge4(mainRoad);
  bridge4(subRoad);

  // ⑤ subRoad -= mainRoad
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (subRoad[r][c] && mainRoad[r][c]) subRoad[r][c] = 0;
    }
  }

  // ⑥ Flood fill
  const { parcels, nameList } = floodFillParcels(mask, mainRoad, subRoad, rows, cols);
  return { mainRoad, subRoad, parcels, nameList };
}
