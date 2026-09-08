/**
 * building_generator: 完整建筑生成管线（DataTree 形式）
 *
 * 每次只处理单张建筑地块掩码 inputGrid，网格列表的 fanout/重组由引擎自动完成。
 *
 * 内联了以下原始电池的全部逻辑（无外部依赖）：
 *   building_carve → mask_outline → building_inner_wall →
 *   mask_subtract (外墙) → batch_max_merge (全墙) →
 *   building_door → building_inner_door → building_window →
 *   mask_subtract (纯墙/室内地面) → grid_split_by_connectivity (按房间拆分)
 *
 * 输出：
 *   outputGrid (grid/item)      — 单张多值网格，固定 id：墙顶=1，外墙体=2，内墙体=3，窗户=4，
 *                                  室内地面从 5 起（mergeOutput=true 合为一张地板=5；false 时每房间一个递增 id）。
 *                                  重叠时按 地板 → 内墙体 → 外墙体 → 窗户 → 墙顶 顺序后写覆盖。
 *   outputNameList (array/item) — [{id, name, type}]；墙体打包条目 id=[3,2,4,1]，仅含实际出现的 id。
 *   doorGrid (grid/item)        — 大门（外门）单张网格，门格=1。
 */

// ─── 类型 ─────────────────────────────────────────────────────────────────────
type Grid = number[][];
interface NameEntry { id: number | number[]; name: string; type?: string; }

// ─── 工具：随机数生成器 ────────────────────────────────────────────────────────
function makeMulberry32(seed: number): () => number {
  let s = (seed === 0 ? Date.now() : seed) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeLCG(seed: number): () => number {
  let s = (seed === 0 ? Date.now() : seed) >>> 0;
  return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 0x100000000; };
}

function shuffle<T>(arr: T[], rand: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ─── 1. building_carve ────────────────────────────────────────────────────────
type Rect = { minR: number; maxR: number; minC: number; maxC: number };

function getBoundingBox(grid: Grid): Rect | null {
  const rows = grid.length, cols = grid[0]?.length ?? 0;
  let minR = rows, maxR = -1, minC = cols, maxC = -1;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (grid[r][c] !== 0) {
        if (r < minR) minR = r; if (r > maxR) maxR = r;
        if (c < minC) minC = c; if (c > maxC) maxC = c;
      }
  return maxR === -1 ? null : { minR, maxR, minC, maxC };
}

function weightedSample(rand: () => number, values: number[], weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < values.length; i++) { r -= weights[i]; if (r <= 0) return values[i]; }
  return values[values.length - 1];
}

function splitSegments(len: number, n: number): Array<[number, number]> {
  const segs: Array<[number, number]> = [];
  const base = Math.floor(len / n), extra = len % n;
  let pos = 0;
  for (let i = 0; i < n; i++) { const sl = base + (i < extra ? 1 : 0); segs.push([pos, pos + sl]); pos += sl; }
  return segs;
}

function applyLayer1(bbox: Rect, rand: () => number) {
  const vals = [1, 2, 3, 4], wts = [90, 70, 25, 15];
  const top = weightedSample(rand, vals, wts), bottom = weightedSample(rand, vals, wts);
  const left = weightedSample(rand, vals, wts), right = weightedSample(rand, vals, wts);
  const h = bbox.maxR - bbox.minR + 1, w = bbox.maxC - bbox.minC + 1;
  const sT = Math.min(top, Math.floor((h - 1) / 2));
  const sB = Math.min(bottom, h - 1 - sT);
  const sL = Math.min(left, Math.floor((w - 1) / 2));
  const sR = Math.min(right, w - 1 - sL);
  return {
    inner: { minR: bbox.minR + sT, maxR: bbox.maxR - sB, minC: bbox.minC + sL, maxC: bbox.maxC - sR },
    setbacks: { top: sT, bottom: sB, left: sL, right: sR },
  };
}

function layer2Probs(sb: number) {
  const t = (sb - 1) / 3;
  return { inwardProb: 0.80 - t * 0.60, outwardProb: 0.10 - t * 0.08 };
}

function applyLayer2(bbox: Rect, inner: Rect, setbacks: { top: number; bottom: number; left: number; right: number }, rand: () => number, rows: number, cols: number): Grid {
  const iW = inner.maxC - inner.minC + 1, iH = inner.maxR - inner.minR + 1;
  const topOff = new Array(iW).fill(0), bottomOff = new Array(iW).fill(0);
  const leftOff = new Array(iH).fill(0), rightOff = new Array(iH).fill(0);
  for (const side of (["top", "bottom", "left", "right"] as const)) {
    const isH = side === "top" || side === "bottom";
    const edgeLen = isH ? iW : iH;
    const edgeSB = setbacks[side];
    const { inwardProb, outwardProb } = layer2Probs(edgeSB);
    const nSeg = Math.min(6, Math.max(1, Math.ceil(edgeLen / 7)));
    const segs = splitSegments(edgeLen, nSeg);
    const offArr = side === "top" ? topOff : side === "bottom" ? bottomOff : side === "left" ? leftOff : rightOff;
    for (const [ss, se] of segs) {
      const rv = rand(); let dir = 0;
      if (rv < inwardProb) dir = 1;
      else if (rv < inwardProb + outwardProb) dir = -1;
      if (dir === 0) continue;
      const rv2 = rand();
      const mag = dir > 0 ? (rv2 < 0.70 ? 1 : 2) : (rv2 < 0.80 || edgeSB < 2 ? 1 : 2);
      const delta = dir * mag;
      for (let i = ss; i < se; i++) offArr[i] = delta < 0 ? Math.max(-edgeSB, offArr[i] + delta) : offArr[i] + delta;
    }
  }
  const topA = topOff.map(o => inner.minR + o), botA = bottomOff.map(o => inner.maxR - o);
  const lefA = leftOff.map(o => inner.minC + o), rigA = rightOff.map(o => inner.maxC - o);
  const output: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let r = bbox.minR; r <= bbox.maxR; r++) {
    for (let c = bbox.minC; c <= bbox.maxC; c++) {
      const ci = c - inner.minC, ri = r - inner.minR;
      const inTB = ci >= 0 && ci < iW && r >= topA[ci] && r <= botA[ci];
      const inLR = ri >= 0 && ri < iH && c >= lefA[ri] && c <= rigA[ri];
      if (inTB && inLR) output[r][c] = 1;
    }
  }
  return output;
}

function scaleToFitBBox(carved: Grid, carvedBBox: Rect, targetBBox: Rect, rows: number, cols: number): Grid {
  const output: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const cH = carvedBBox.maxR - carvedBBox.minR + 1, cW = carvedBBox.maxC - carvedBBox.minC + 1;
  const tH = targetBBox.maxR - targetBBox.minR + 1, tW = targetBBox.maxC - targetBBox.minC + 1;
  if (cH <= 0 || cW <= 0 || tH <= 0 || tW <= 0) return output;
  const scale = Math.min(tH / cH, tW / cW);
  const tCR = (targetBBox.minR + targetBBox.maxR) / 2, tCC = (targetBBox.minC + targetBBox.maxC) / 2;
  const cCR = (carvedBBox.minR + carvedBBox.maxR) / 2, cCC = (carvedBBox.minC + carvedBBox.maxC) / 2;
  const drawMinR = Math.round(tCR - (cH * scale - 1) / 2), drawMaxR = Math.round(tCR + (cH * scale - 1) / 2);
  const drawMinC = Math.round(tCC - (cW * scale - 1) / 2), drawMaxC = Math.round(tCC + (cW * scale - 1) / 2);
  for (let r = drawMinR; r <= drawMaxR; r++) {
    for (let c = drawMinC; c <= drawMaxC; c++) {
      if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
      const srcR = Math.round(cCR + (r - tCR) / scale), srcC = Math.round(cCC + (c - tCC) / scale);
      if (srcR >= 0 && srcR < rows && srcC >= 0 && srcC < cols && carved[srcR][srcC] === 1) output[r][c] = 1;
    }
  }
  return output;
}

function carveOne(inputGrid: Grid, seedRaw: number): Grid {
  const rows = inputGrid.length, cols = inputGrid[0].length;
  const bbox = getBoundingBox(inputGrid);
  if (!bbox) return Array.from({ length: rows }, () => new Array(cols).fill(0));
  const rand = makeMulberry32(seedRaw);
  const { inner, setbacks } = applyLayer1(bbox, rand);
  if (inner.maxR - inner.minR < 2 || inner.maxC - inner.minC < 2) {
    const fb: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
    for (let r = bbox.minR; r <= bbox.maxR; r++) for (let c = bbox.minC; c <= bbox.maxC; c++) fb[r][c] = 1;
    return fb;
  }
  const carved = applyLayer2(bbox, inner, setbacks, rand, rows, cols);
  const cBBox = getBoundingBox(carved);
  if (!cBBox) return Array.from({ length: rows }, () => new Array(cols).fill(0));
  return scaleToFitBBox(carved, cBBox, bbox, rows, cols);
}

// ─── 2. mask_outline (向内, thickness=1) ──────────────────────────────────────
const DIRS8: [number, number][] = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];

function findBorderPixels(mask: boolean[][], rows: number, cols: number): boolean[][] {
  const border: boolean[][] = Array.from({ length: rows }, () => new Array(cols).fill(false));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (!mask[r][c]) continue;
      for (const [dr, dc] of DIRS8) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || !mask[nr][nc]) { border[r][c] = true; break; }
      }
    }
  return border;
}

function outlineOne(inputGrid: Grid, thickness: number): Grid {
  const rows = inputGrid.length, cols = inputGrid[0].length;
  const baseMask = inputGrid.map(row => row.map(v => v !== 0));
  const output: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  if (thickness <= 0) return output;
  let outline = findBorderPixels(baseMask, rows, cols);
  for (let i = 1; i < thickness; i++) {
    const next: boolean[][] = Array.from({ length: rows }, () => new Array(cols).fill(false));
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (!outline[r][c]) continue;
      const nbrs: [number, number][] = [[r,c],[r-1,c],[r+1,c],[r,c-1],[r,c+1]];
      for (const [nr, nc] of nbrs) {
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || !baseMask[nr][nc]) continue;
        next[nr][nc] = true;
      }
    }
    outline = next;
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) output[r][c] = outline[r][c] ? 1 : 0;
  return output;
}

// ─── 3. building_inner_wall (BSP) ─────────────────────────────────────────────
interface Room { r0: number; c0: number; r1: number; c1: number; }

function pickSplit(lo: number, hi: number, rand: () => number): number {
  const minP = lo + 2, maxP = hi - 2;
  if (minP > maxP) return -1;
  const center = (minP + maxP) / 2;
  const half = Math.max(1, Math.floor((maxP - minP) * 0.4));
  const rMin = Math.max(minP, Math.floor(center - half)), rMax = Math.min(maxP, Math.ceil(center + half));
  return rMin + Math.floor(rand() * (rMax - rMin + 1));
}

function bspSplit(room: Room, depth: number, maxDepth: number, rand: () => number, walls: Set<number>, cols: number, grid: Grid): void {
  if (depth >= maxDepth) return;
  const h = room.r1 - room.r0 + 1, w = room.c1 - room.c0 + 1;
  const canH = h >= 5, canV = w >= 5;
  if (!canH && !canV) return;
  let splitH: boolean;
  if (canH && !canV) splitH = true;
  else if (canV && !canH) splitH = false;
  else { const ratio = h / w; splitH = ratio > 1.2 ? true : ratio < 0.83 ? false : rand() < 0.5; }
  if (splitH) {
    const p = pickSplit(room.r0, room.r1, rand); if (p === -1) return;
    for (let c = room.c0 - 1; c <= room.c1 + 1; c++) if (grid[p] && grid[p][c] !== 0) walls.add(p * cols + c);
    bspSplit({ r0: room.r0, c0: room.c0, r1: p - 1, c1: room.c1 }, depth+1, maxDepth, rand, walls, cols, grid);
    bspSplit({ r0: p + 1, c0: room.c0, r1: room.r1, c1: room.c1 }, depth+1, maxDepth, rand, walls, cols, grid);
  } else {
    const p = pickSplit(room.c0, room.c1, rand); if (p === -1) return;
    for (let r = room.r0 - 1; r <= room.r1 + 1; r++) if (grid[r] && grid[r][p] !== 0) walls.add(r * cols + p);
    bspSplit({ r0: room.r0, c0: room.c0, r1: room.r1, c1: p - 1 }, depth+1, maxDepth, rand, walls, cols, grid);
    bspSplit({ r0: room.r0, c0: p + 1, r1: room.r1, c1: room.c1 }, depth+1, maxDepth, rand, walls, cols, grid);
  }
}

function innerWallOne(inputGrid: Grid, density: number, seedRaw: number): Grid {
  const rows = inputGrid.length, cols = inputGrid[0].length;
  const rand = makeLCG(seedRaw);
  const output: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  let minR = rows, maxR = -1, minC = cols, maxC = -1;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++)
    if (inputGrid[r][c] !== 0) { minR = Math.min(minR, r); maxR = Math.max(maxR, r); minC = Math.min(minC, c); maxC = Math.max(maxC, c); }
  if (maxR === -1) return output;
  const r0 = minR + 1, r1 = maxR - 1, c0 = minC + 1, c1 = maxC - 1;
  if (r0 > r1 || c0 > c1) return output;
  const maxDepth = Math.round(Math.max(0, Math.min(1, density)) * 6);
  if (maxDepth === 0) return output;
  const walls = new Set<number>();
  bspSplit({ r0, r1, c0, c1 }, 0, maxDepth, rand, walls, cols, inputGrid);
  for (const key of walls) { const r = Math.floor(key / cols), c = key % cols; if (inputGrid[r][c] !== 0) output[r][c] = 1; }
  return output;
}

// ─── 4. 网格操作（差集/合并） ──────────────────────────────────────────────────
function subtractGrids(g1: Grid, g2: Grid): Grid {
  const rows = g1.length, cols = g1[0].length;
  return Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (__, c) => g1[r][c] !== 0 && g2[r][c] === 0 ? 1 : 0));
}

function maxMergeGrids(grids: Grid[]): Grid {
  const valid = grids.filter(g => g.length > 0 && g[0] && g[0].length > 0);
  if (valid.length === 0) return [];
  const rows = valid[0].length, cols = valid[0][0].length;
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (__, c) => valid.reduce((mx, g) => Math.max(mx, r < g.length && c < (g[r]?.length ?? 0) ? g[r][c] : 0), 0))
  );
}

// ─── 5. building_door ─────────────────────────────────────────────────────────
interface DoorCand { r: number; c: number; dir: "H" | "V"; width: number; }

function doorCandCells(d: DoorCand, cols: number): number[] {
  if (d.dir === "H") return Array.from({ length: d.width }, (_, i) => d.r * cols + d.c + i);
  return Array.from({ length: d.width }, (_, i) => (d.r + i) * cols + d.c);
}

function collectDoorPriority(grid: Grid, rows: number, cols: number, dw: number): DoorCand[] {
  const SEG = 6, cands: DoorCand[] = [];
  for (let r = 0; r < rows; r++) {
    let s = -1;
    for (let c = 0; c <= cols; c++) {
      const isW = c < cols && grid[r][c] !== 0;
      if (isW && s === -1) s = c;
      else if (!isW && s !== -1) {
        const e = c - 1, len = e - s + 1;
        if (len >= SEG) {
          const ds = Math.floor((s + e - dw + 1) / 2), de = ds + dw - 1;
          if (ds >= s && de <= e && (r > 0 && grid[r-1][ds] === 0 || r < rows-1 && grid[r+1][ds] === 0))
            cands.push({ r, c: ds, dir: "H", width: dw });
        }
        s = -1;
      }
    }
  }
  for (let c = 0; c < cols; c++) {
    let s = -1;
    for (let r = 0; r <= rows; r++) {
      const isW = r < rows && grid[r][c] !== 0;
      if (isW && s === -1) s = r;
      else if (!isW && s !== -1) {
        const e = r - 1, len = e - s + 1;
        if (len >= SEG) {
          const ds = Math.floor((s + e - dw + 1) / 2), de = ds + dw - 1;
          if (ds >= s && de <= e && (c > 0 && grid[ds][c-1] === 0 || c < cols-1 && grid[ds][c+1] === 0))
            cands.push({ r: ds, c, dir: "V", width: dw });
        }
        s = -1;
      }
    }
  }
  return cands;
}

function collectDoorFallback(grid: Grid, rows: number, cols: number, dw: number): DoorCand[] {
  const cands: DoorCand[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c <= cols - dw; c++)
      if (Array.from({ length: dw }, (_, i) => grid[r][c+i]).every(v => v !== 0) &&
          (r > 0 && grid[r-1][c] === 0 || r < rows-1 && grid[r+1][c] === 0))
        cands.push({ r, c, dir: "H", width: dw });
  for (let c = 0; c < cols; c++)
    for (let r = 0; r <= rows - dw; r++)
      if (Array.from({ length: dw }, (_, i) => grid[r+i][c]).every(v => v !== 0) &&
          (c > 0 && grid[r][c-1] === 0 || c < cols-1 && grid[r][c+1] === 0))
        cands.push({ r, c, dir: "V", width: dw });
  return cands;
}

function placeDoors(cands: DoorCand[], need: number, opened: Set<number>, outG: Grid, doorG: Grid, cols: number): number {
  let placed = 0;
  for (const cand of cands) {
    if (placed >= need) break;
    const keys = doorCandCells(cand, cols);
    if (keys.some(k => opened.has(k))) continue;
    for (const k of keys) { opened.add(k); outG[Math.floor(k/cols)][k%cols] = 0; doorG[Math.floor(k/cols)][k%cols] = 1; }
    placed++;
  }
  return placed;
}

function doorOne(wallGrid: Grid, doorCount: number, doorWidth: number, seedRaw: number): { outputGrid: Grid; doorGrid: Grid } {
  const rows = wallGrid.length, cols = wallGrid[0].length;
  const rand = makeLCG(seedRaw);
  const outputGrid = wallGrid.map(row => [...row]);
  const doorGrid: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  if (doorCount === 0) return { outputGrid, doorGrid };
  const priority = collectDoorPriority(wallGrid, rows, cols, doorWidth);
  shuffle(priority, rand);
  const opened = new Set<number>();
  const placed = placeDoors(priority, doorCount, opened, outputGrid, doorGrid, cols);
  if (placed < doorCount) {
    const fb = collectDoorFallback(wallGrid, rows, cols, doorWidth).filter(c => !doorCandCells(c, cols).some(k => opened.has(k)));
    shuffle(fb, rand);
    placeDoors(fb, doorCount - placed, opened, outputGrid, doorGrid, cols);
  }
  return { outputGrid, doorGrid };
}

// ─── 6. building_inner_door ───────────────────────────────────────────────────
class UnionFind {
  private parent: number[]; private rank: number[];
  constructor(n: number) { this.parent = Array.from({ length: n }, (_, i) => i); this.rank = new Array(n).fill(0); }
  find(x: number): number { return this.parent[x] === x ? x : (this.parent[x] = this.find(this.parent[x])); }
  union(x: number, y: number): boolean {
    const px = this.find(x), py = this.find(y); if (px === py) return false;
    if (this.rank[px] < this.rank[py]) this.parent[px] = py;
    else if (this.rank[px] > this.rank[py]) this.parent[py] = px;
    else { this.parent[py] = px; this.rank[px]++; } return true;
  }
  connected(x: number, y: number): boolean { return this.find(x) === this.find(y); }
}

function labelRegions(grid: Grid, rows: number, cols: number): { labels: Int32Array; roomCount: number; exteriorIds: Set<number> } {
  const labels = new Int32Array(rows * cols).fill(-1); let roomCount = 0;
  const dx = [0,0,1,-1], dy = [1,-1,0,0];
  function bfs(sk: number, label: number) {
    labels[sk] = label; const q = [sk]; let head = 0;
    while (head < q.length) {
      const key = q[head++]; const cr = Math.floor(key/cols), cc = key%cols;
      for (let d = 0; d < 4; d++) {
        const nr = cr+dx[d], nc = cc+dy[d];
        if (nr<0||nr>=rows||nc<0||nc>=cols) continue;
        const nk = nr*cols+nc;
        if (grid[nr][nc]===0 && labels[nk]===-1) { labels[nk]=label; q.push(nk); }
      }
    }
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (grid[r][c]===0 && labels[r*cols+c]===-1) bfs(r*cols+c, roomCount++);
  const ext = new Set<number>();
  for (let c = 0; c < cols; c++) { const t=labels[c],b=labels[(rows-1)*cols+c]; if(t!==-1)ext.add(t); if(b!==-1)ext.add(b); }
  for (let r = 0; r < rows; r++) { const l=labels[r*cols],rr=labels[r*cols+cols-1]; if(l!==-1)ext.add(l); if(rr!==-1)ext.add(rr); }
  return { labels, roomCount, exteriorIds: ext };
}

interface WallSeg { wallCells: number[]; roomA: number; roomB: number; }

function collectWallSegs(grid: Grid, labels: Int32Array, rows: number, cols: number, ext: Set<number>): WallSeg[] {
  const segs: WallSeg[] = [];
  const indoor = (id: number) => id !== -1 && !ext.has(id);
  for (let r = 0; r < rows; r++) {
    let s=-1, rA=-1, rB=-1;
    for (let c = 0; c <= cols; c++) {
      let inner=false, a=-1, b=-1;
      if (c<cols && grid[r][c]!==0) {
        const top = r>0&&grid[r-1][c]===0?labels[(r-1)*cols+c]:-1;
        const bot = r<rows-1&&grid[r+1][c]===0?labels[(r+1)*cols+c]:-1;
        if (indoor(top)&&indoor(bot)&&top!==bot) { inner=true; a=Math.min(top,bot); b=Math.max(top,bot); }
      }
      if (s!==-1 && (!inner||a!==rA||b!==rB)) {
        const cells: number[] = [];
        for (let wc=s; wc<c; wc++) cells.push(r*cols+wc);
        if (cells.length>=2) segs.push({ wallCells:cells, roomA:rA, roomB:rB });
        s=-1;
      }
      if (inner && s===-1) { s=c; rA=a; rB=b; }
    }
  }
  for (let c = 0; c < cols; c++) {
    let s=-1, rA=-1, rB=-1;
    for (let r = 0; r <= rows; r++) {
      let inner=false, a=-1, b=-1;
      if (r<rows && grid[r][c]!==0) {
        const left = c>0&&grid[r][c-1]===0?labels[r*cols+c-1]:-1;
        const right = c<cols-1&&grid[r][c+1]===0?labels[r*cols+c+1]:-1;
        if (indoor(left)&&indoor(right)&&left!==right) { inner=true; a=Math.min(left,right); b=Math.max(left,right); }
      }
      if (s!==-1 && (!inner||a!==rA||b!==rB)) {
        const cells: number[] = [];
        for (let wr=s; wr<r; wr++) cells.push(wr*cols+c);
        if (cells.length>=2) segs.push({ wallCells:cells, roomA:rA, roomB:rB });
        s=-1;
      }
      if (inner && s===-1) { s=r; rA=a; rB=b; }
    }
  }
  return segs;
}

function openInnerDoor(seg: WallSeg, outG: Grid, doorG: Grid, cols: number, rand: () => number): void {
  const cells = seg.wallCells, len = cells.length;
  const minW = 2, maxW = 4, maxA = Math.min(maxW, len-2);
  let start: number, width: number;
  if (maxA < minW) { width=Math.min(minW,len); start=Math.floor((len-width)/2); }
  else { width=minW+Math.floor(rand()*(maxA-minW+1)); start=1+Math.floor(rand()*(len-width-1)); }
  for (let i=start; i<start+width; i++) {
    const k=cells[i]; outG[Math.floor(k/cols)][k%cols]=0; doorG[Math.floor(k/cols)][k%cols]=1;
  }
}

function innerDoorOne(inputGrid: Grid, seedRaw: number): { outputGrid: Grid; doorGrid: Grid } {
  const rows=inputGrid.length, cols=inputGrid[0].length;
  const rand=makeLCG(seedRaw);
  const outputGrid = inputGrid.map(row=>[...row]);
  const doorGrid: Grid = Array.from({ length:rows }, ()=>new Array(cols).fill(0));
  const { labels, roomCount, exteriorIds } = labelRegions(inputGrid, rows, cols);
  const indoor: number[] = [];
  for (let i=0; i<roomCount; i++) if (!exteriorIds.has(i)) indoor.push(i);
  if (indoor.length<=1) return { outputGrid, doorGrid };
  const segs = collectWallSegs(inputGrid, labels, rows, cols, exteriorIds);
  if (segs.length===0) return { outputGrid, doorGrid };
  const idxMap = new Map<number,number>(); indoor.forEach((id,i)=>idxMap.set(id,i));
  const uf = new UnionFind(indoor.length);
  shuffle(segs, rand);
  const chosen: WallSeg[] = [];
  for (const seg of segs) {
    const ia=idxMap.get(seg.roomA), ib=idxMap.get(seg.roomB);
    if (ia===undefined||ib===undefined) continue;
    if (!uf.connected(ia,ib)) { uf.union(ia,ib); chosen.push(seg); }
  }
  for (const seg of chosen) openInnerDoor(seg, outputGrid, doorGrid, cols, rand);
  return { outputGrid, doorGrid };
}

// ─── 7. building_window ───────────────────────────────────────────────────────
interface WinCand { r: number; c: number; dir: "H" | "V"; width: number; }

/**
 * 横向窗判定：(r, c)..(r, c+w-1) 这 W 格加两端各一格，共 W+2 格必须全是非零墙格
 * 即 grid[r][c-1..c+w] 全非零（两端超出边界时视为满足条件）。
 * 同时整个 W 格宽度的上方一行和下方一行都必须是空格（确保是"对外"的外墙面）。
 */
function isValidHWindow(grid: Grid, rows: number, cols: number, r: number, c: number, w: number): boolean {
  // W+2 格全非零检查（两端各一格）
  const lo = c - 1, hi = c + w;
  if (lo >= 0 && grid[r][lo] === 0) return false;
  if (hi < cols && grid[r][hi] === 0) return false;
  // 整个 W 格宽度：上下两侧都必须是空格
  for (let i = 0; i < w; i++) {
    if (r <= 0 || grid[r - 1][c + i] !== 0) return false;
    if (r >= rows - 1 || grid[r + 1][c + i] !== 0) return false;
  }
  return true;
}

/**
 * 竖向窗判定：(r, c)..(r+w-1, c) 这 W 格加两端各一格，共 W+2 格必须全是非零墙格
 * 即 grid[r-1..r+w][c] 全非零（两端超出边界时视为满足条件）。
 * 同时整个 W 格高度的左侧一列和右侧一列都必须是空格（确保是"对外"的外墙面）。
 */
function isValidVWindow(grid: Grid, rows: number, cols: number, r: number, c: number, w: number): boolean {
  // W+2 格全非零检查（两端各一格）
  const lo = r - 1, hi = r + w;
  if (lo >= 0 && grid[lo][c] === 0) return false;
  if (hi < rows && grid[hi][c] === 0) return false;
  // 整个 W 格高度：左右两侧都必须是空格
  for (let i = 0; i < w; i++) {
    if (c <= 0 || grid[r + i][c - 1] !== 0) return false;
    if (c >= cols - 1 || grid[r + i][c + 1] !== 0) return false;
  }
  return true;
}

function collectWinCands(grid: Grid, rows: number, cols: number, w: number): WinCand[] {
  const cands: WinCand[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c <= cols - w; c++)
      if (Array.from({length: w}, (_, i) => grid[r][c + i]).every(v => v !== 0) &&
          isValidHWindow(grid, rows, cols, r, c, w))
        cands.push({r, c, dir: "H", width: w});
  for (let c = 0; c < cols; c++)
    for (let r = 0; r <= rows - w; r++)
      if (Array.from({length: w}, (_, i) => grid[r + i][c]).every(v => v !== 0) &&
          isValidVWindow(grid, rows, cols, r, c, w))
        cands.push({r, c, dir: "V", width: w});
  return cands;
}

function winCells(cand: WinCand, cols: number): number[] {
  if (cand.dir==="H") return Array.from({length:cand.width},(_,i)=>cand.r*cols+cand.c+i);
  return Array.from({length:cand.width},(_,i)=>(cand.r+i)*cols+cand.c);
}

function winExclusion(cand: WinCand, cols: number): number[] {
  const cs = winCells(cand, cols);
  if (cand.dir==="H") { if(cand.c-1>=0) cs.push(cand.r*cols+(cand.c-1)); cs.push(cand.r*cols+(cand.c+cand.width)); }
  else { if(cand.r-1>=0) cs.push((cand.r-1)*cols+cand.c); cs.push((cand.r+cand.width)*cols+cand.c); }
  return cs;
}

function pickWindows(cands: WinCand[], count: number, cols: number): WinCand[] {
  const occ=new Set<number>(), result: WinCand[]=[];
  for (const c of cands) {
    if (result.length>=count) break;
    const cs=winCells(c,cols); if(cs.some(k=>occ.has(k))) continue;
    winExclusion(c,cols).forEach(k=>occ.add(k)); result.push(c);
  }
  return result;
}

function uniformPick<T>(arr: T[], count: number): T[] {
  if (count<=0||arr.length===0) return [];
  if (count>=arr.length) return [...arr];
  const step=arr.length/count;
  return Array.from({length:count},(_,i)=>arr[Math.floor(i*step+step/2)]);
}

function windowOne(wallGrid: Grid, windowCount: number, windowWidth: number, randomEnable: boolean, seedRaw: number): { outputGrid: Grid; windowGrid: Grid } {
  const rows=wallGrid.length, cols=wallGrid[0].length;
  const outputGrid = wallGrid.map(row=>[...row]);
  const windowGrid: Grid = Array.from({length:rows},()=>new Array(cols).fill(0));
  if (windowCount===0) return {outputGrid,windowGrid};
  const cands=collectWinCands(wallGrid,rows,cols,windowWidth);
  if (cands.length===0) return {outputGrid,windowGrid};
  let ordered: WinCand[];
  if (randomEnable) { const rand=makeLCG(seedRaw); const sh=[...cands]; shuffle(sh,rand); ordered=sh; }
  else { ordered=uniformPick([...cands].sort((a,b)=>a.dir.localeCompare(b.dir)||a.r-b.r||a.c-b.c), windowCount); }
  const chosen=pickWindows(ordered,windowCount,cols);
  for (const w of chosen) for (const k of winCells(w,cols)) { const r=Math.floor(k/cols),c=k%cols; outputGrid[r][c]=0; windowGrid[r][c]=1; }
  return {outputGrid,windowGrid};
}

// ─── 8. 室内地面按连通分量拆分 ────────────────────────────────────────────────
function splitByConnectivity(grid: Grid): Grid[] {
  const rows = grid.length, cols = grid[0].length;
  const visited = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));
  const dirs: [number, number][] = [[-1,0],[1,0],[0,-1],[0,1]];
  const components: [number, number][][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] === 0 || visited[r][c]) continue;
      const comp: [number, number][] = [];
      const q: [number, number][] = [[r, c]];
      visited[r][c] = true;
      while (q.length > 0) {
        const [cr, cc] = q.shift()!;
        comp.push([cr, cc]);
        for (const [dr, dc] of dirs) {
          const nr = cr + dr, nc = cc + dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !visited[nr][nc] && grid[nr][nc] !== 0) {
            visited[nr][nc] = true; q.push([nr, nc]);
          }
        }
      }
      components.push(comp);
    }
  }
  return components.map(comp => {
    const out: Grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
    for (const [r, c] of comp) out[r][c] = grid[r][c];
    return out;
  });
}

// ─── 9. 主入口 ────────────────────────────────────────────────────────────────
export function buildingGenerator(input: Record<string, unknown>): Record<string, unknown> {
  // ── 参数解析（DataTree：单张 inputGrid） ──
  const rawGrid = input.inputGrid;
  const wallThickness      = typeof input.wallThickness      === "number" ? Math.max(1, Math.round(input.wallThickness))    : 1;
  const externalInnerWallDensity = typeof input.innerWallDensity === "number" ? Math.max(0, Math.min(1, input.innerWallDensity)) : undefined;
  const doorCount          = typeof input.doorCount          === "number" ? Math.max(0, Math.round(input.doorCount))          : 1;
  const doorWidth          = typeof input.doorWidth          === "number" ? Math.max(1, Math.round(input.doorWidth))          : 2;
  const externalWindowCount = typeof input.windowCount === "number" ? Math.max(0, Math.round(input.windowCount)) : undefined;
  const windowWidth        = typeof input.windowWidth        === "number" ? Math.max(1, Math.round(input.windowWidth))        : 2;
  const windowRandom       = input.windowRandom !== false && input.windowRandom !== "false";
  const buildingHeight     = typeof input.buildingHeight     === "number" ? Math.max(0, Math.round(input.buildingHeight))     : 1;
  const mergeOutput        = input.mergeOutput !== false && input.mergeOutput !== "false";
  const seed               = typeof input.seed               === "number" ? Math.floor(input.seed)                            : 0;

  // ── 输入校验（单张网格，列表 fanout 交给引擎） ──
  if (!Array.isArray(rawGrid) || rawGrid.length === 0 || !Array.isArray(rawGrid[0]) ||
      typeof (rawGrid as Grid)[0]?.[0] !== "number" || (rawGrid as Grid)[0].length === 0) {
    return { error: "inputGrid is required" };
  }
  const inputBldg = rawGrid as Grid;

  const bldgSeed = seed === 0 ? Date.now() : seed;

  // 输出网格在原始尺寸基础上顶部扩展 buildingHeight 行，让墙顶不被截断。
  const H = buildingHeight;

  // ── 固定 ID 分配 ──
  const WALL_ID = { roofTop: 1, outerBody: 2, innerBody: 3, window: 4 } as const;
  const FLOOR_ID_START = 5;

  // Step 1: building_carve（始终执行两层退线雕刻）
  const carved = carveOne(inputBldg, bldgSeed);
  if (!carved || carved.length === 0) return { outputGrid: [], outputNameList: [], doorGrid: [] };

  const rows = carved.length, cols = carved[0].length;
  const outRows = rows + H;   // 扩展后的总行数

  // Step 2: mask_outline → 外轮廓 (=外墙形状)
  const outline = outlineOne(carved, wallThickness);

  // Step 3: building_inner_wall → 内墙
  // 外部未传入时按网格宽度自动推算密度：width≤20→0.25，width=50→0.6，width≥50→0.6（线性插值）
  const autoInnerWallDensity = (() => {
    if (externalInnerWallDensity !== undefined) return externalInnerWallDensity;
    const w = cols;
    if (w <= 20) return 0.25;
    if (w >= 50) return 0.6;
    return 0.25 + (w - 20) / (50 - 20) * (0.6 - 0.25);
  })();
  const innerWalls = innerWallOne(carved, autoInnerWallDensity, bldgSeed + 1);

  // Step 4: 外轮廓 - 内墙 → 纯外墙
  const outerWallOnly = subtractGrids(outline, innerWalls);

  // Step 5: 外轮廓 + 内墙 → 全墙
  const allWalls = maxMergeGrids([outline, innerWalls]);

  // Step 6: building_door（在外墙上开外门）
  const doorResult = doorOne(outerWallOnly, doorCount, doorWidth, bldgSeed + 2);
  const outerWallAfterDoor = doorResult.outputGrid;  // 外墙去掉门洞
  const outerDoorGrid = doorResult.doorGrid;          // 大门位置

  // Step 7: building_inner_door（在全墙上开内门，确保所有室内连通）
  const innerDoorResult = innerDoorOne(allWalls, bldgSeed + 3);
  const innerDoorGrid = innerDoorResult.doorGrid;     // 内门位置

  // Step 8: 全门格 = 外门 + 内门
  const allDoors = maxMergeGrids([outerDoorGrid, innerDoorGrid]);

  // Step 9: 全墙 - 全门 → 纯墙（无门洞）
  const wallNoDoors = subtractGrids(allWalls, allDoors);

  // Step 12/13: 室内地面拆分（提前到开窗前，便于自动窗数按房间数推算）
  // 用完整墙体（含内门洞）做减法，保持房间间不连通，确保 splitByConnectivity 能正确分出独立房间
  const indoorFloorBase = subtractGrids(carved, allWalls);  // 不含门洞
  const roomComponents = splitByConnectivity(indoorFloorBase);

  // 将门洞格（外门 + 内门）加回各房间：与门洞格 4-邻接的房间分量获得对应门洞格
  const dirs4: [number, number][] = [[-1,0],[1,0],[0,-1],[0,1]];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (outerDoorGrid[r][c] === 0 && innerDoorGrid[r][c] === 0) continue;
      for (const [dr, dc] of dirs4) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        for (const roomGrid of roomComponents) {
          if (roomGrid[nr][nc] !== 0) { roomGrid[r][c] = roomGrid[nr][nc]; break; }
        }
        if (roomComponents.some(g => g[r][c] !== 0)) break;
      }
    }
  }

  // Step 10: building_window（在外墙（减去内墙后再减门洞的）上开窗）
  // 外部未传入时，窗户数量 = 房间数 / 2（向下取整，最少0）
  const autoWindowCount = externalWindowCount !== undefined
    ? externalWindowCount
    : Math.max(0, Math.floor(roomComponents.length / 2));
  const windowResult = windowOne(outerWallAfterDoor, autoWindowCount, windowWidth, windowRandom, bldgSeed + 4);
  const windowGrid = windowResult.windowGrid;         // 窗户位置

  // Step 11: 纯墙 - 窗户 → 最终外墙
  const finalWall = subtractGrids(wallNoDoors, windowGrid);

  // ── 生成"墙顶"：外墙面（finalWall ∪ windowGrid）向上平移 H 行 ──
  // 原格 (r, c) → 扩展后 (r + H, c)；向上平移 H 后落在 [0, rows) 区间。
  let roofTopGrid: Grid | null = null;
  if (H > 0) {
    const roofTop: Grid = Array.from({ length: outRows }, () => new Array<number>(cols).fill(0));
    let hasAny = false;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        if (finalWall[r][c] !== 0 || windowGrid[r][c] !== 0) {
          roofTop[r][c] = 1;
          hasAny = true;
        }
    if (hasAny) roofTopGrid = roofTop;
  }

  // ── 生成墙体（外墙体 + 内墙体），仅当 buildingHeight > 0 时 ──
  let outerWallBodyGrid: Grid | null = null;
  let innerWallBodyGrid: Grid | null = null;

  if (H > 0 && roofTopGrid) {
    // Step A: BFS 标记外部（carved 为障碍）
    const isExterior: boolean[][] = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));
    const q: Array<[number, number]> = [];
    const enqueue = (r: number, c: number) => {
      if (r >= 0 && r < rows && c >= 0 && c < cols && !isExterior[r][c] && carved[r][c] === 0) {
        isExterior[r][c] = true; q.push([r, c]);
      }
    };
    for (let r = 0; r < rows; r++) { enqueue(r, 0); enqueue(r, cols - 1); }
    for (let c = 0; c < cols; c++) { enqueue(0, c); enqueue(rows - 1, c); }
    const bfsDirs = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
    let qi = 0;
    while (qi < q.length) {
      const [r, c] = q[qi++];
      for (const [dr, dc] of bfsDirs) enqueue(r + dr, c + dc);
    }

    // Step B: 构建完整墙体（roofTopGrid 每格向下 H 格）
    const wallBody: Grid = Array.from({ length: outRows }, () => new Array<number>(cols).fill(0));
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        if (roofTopGrid[r][c] !== 0)
          for (let k = 1; k <= H; k++)
            wallBody[r + k][c] = 1;

    // Step C: 找外墙顶点并收集外墙体
    const outerWallSet = new Set<number>();
    const outerBody: Grid = Array.from({ length: outRows }, () => new Array<number>(cols).fill(0));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (roofTopGrid[r][c] === 0) continue;
        const southIsExterior = (r + 1 >= rows) || isExterior[r + 1][c];
        if (!southIsExterior) continue;
        for (let k = 1; k <= H; k++) {
          const nr = r + k;
          if (nr < outRows && wallBody[nr][c] !== 0) {
            outerBody[nr][c] = 1;
            outerWallSet.add(nr * cols + c);
          }
        }
      }
    }

    // Step D: 内墙体 = 墙体 − 外墙体
    const innerBody: Grid = Array.from({ length: outRows }, () => new Array<number>(cols).fill(0));
    for (let r = 0; r < outRows; r++)
      for (let c = 0; c < cols; c++)
        if (wallBody[r][c] !== 0 && !outerWallSet.has(r * cols + c))
          innerBody[r][c] = 1;

    // Step E: 减去墙顶（避免与 roofTopGrid 重叠）
    for (let r = 0; r < outRows; r++)
      for (let c = 0; c < cols; c++)
        if (roofTopGrid[r][c] !== 0) { outerBody[r][c] = 0; innerBody[r][c] = 0; }

    if (outerBody.some(row => row.some(v => v !== 0))) outerWallBodyGrid = outerBody;
    if (innerBody.some(row => row.some(v => v !== 0))) innerWallBodyGrid = innerBody;
  }

  // ── 窗户输出位置处理 ──
  const winExpOffset = H > 1 ? H - 1 : H;
  const windowOutputGrid: Grid = Array.from({ length: outRows }, () => new Array<number>(cols).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (windowGrid[r][c] === 0) continue;
      const er = r + winExpOffset;
      if (er >= outRows) continue;
      if (roofTopGrid && roofTopGrid[er][c] !== 0) continue;  // 被墙顶遮住，跳过
      windowOutputGrid[er][c] = 1;
    }

  // ── 组装单张多值 outputGrid（扩展坐标系 outRows×cols） ──
  const outputGrid: Grid = Array.from({ length: outRows }, () => new Array<number>(cols).fill(0));
  const present = new Set<number>();
  const outputNameList: NameEntry[] = [];

  // 地板层（先写，作为最底层）。室内房间（原坐标偏移 +H 写入扩展网格）
  const validRooms = roomComponents.filter(g => g.some(row => row.some(v => v !== 0)));
  if (mergeOutput) {
    if (validRooms.length > 0) {
      const floorId = FLOOR_ID_START;
      for (const roomGrid of validRooms)
        for (let r = 0; r < rows; r++)
          for (let c = 0; c < cols; c++)
            if (roomGrid[r][c] !== 0) outputGrid[r + H][c] = floorId;
      present.add(floorId);
      outputNameList.push({ id: floorId, name: "地板", type: "tile" });
    }
  } else {
    let fid = FLOOR_ID_START;
    validRooms.forEach((roomGrid, i) => {
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
          if (roomGrid[r][c] !== 0) outputGrid[r + H][c] = fid;
      present.add(fid);
      outputNameList.push({ id: fid, name: `地板${i + 1}`, type: "tile" });
      fid++;
    });
  }

  // 墙体层（覆盖顺序：内墙体 → 外墙体 → 窗户 → 墙顶，后写覆盖；与原墙体包 [3,2,4,1] 一致）
  const writeLayer = (grid: Grid | null, id: number) => {
    if (!grid) return;
    let any = false;
    for (let r = 0; r < outRows; r++)
      for (let c = 0; c < cols; c++)
        if (grid[r][c] !== 0) { outputGrid[r][c] = id; any = true; }
    if (any) present.add(id);
  };
  writeLayer(innerWallBodyGrid, WALL_ID.innerBody);  // 3
  writeLayer(outerWallBodyGrid, WALL_ID.outerBody);  // 2
  writeLayer(windowOutputGrid,  WALL_ID.window);     // 4
  writeLayer(roofTopGrid,       WALL_ID.roofTop);    // 1

  // 墙体打包名称条目（id=[3,2,4,1]，仅含实际出现的层）
  const wallIds = [3, 2, 4, 1].filter(id => present.has(id));
  if (wallIds.length > 0) outputNameList.push({ id: wallIds, name: "墙体", type: "tile" });

  // ── 大门网格（外门，扩展坐标系偏移 +H） ──
  const doorGrid: Grid = Array.from({ length: outRows }, () => new Array<number>(cols).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (outerDoorGrid[r][c] !== 0) doorGrid[r + H][c] = 1;

  return { outputGrid, outputNameList, doorGrid };
}
