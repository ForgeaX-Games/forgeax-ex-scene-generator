type Grid = number[][];

interface NameEntry { id: number; name: string; type?: string; }
interface Point { x: number; y: number; }
interface Tail { cells: Point[]; tip: Point; endedJunction: boolean; }

// gta_zones v3 分区 ID
const COMMERCIAL = 421;
const RESIDENTIAL = 422;
const INDUSTRIAL = 423;
const PARK = 424;
const SUBURB = 427;
const TRIM_ROAD = 301;
const CITY_ZONES = new Set([COMMERCIAL, RESIDENTIAL, INDUSTRIAL, SUBURB]);

const N8: Array<[number, number]> = [
  [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1],
];

function isGrid(value: unknown): value is Grid {
  return Array.isArray(value) && value.length > 0 && Array.isArray(value[0])
    && ((value[0] as unknown[]).length === 0 || typeof (value[0] as unknown[])[0] === "number");
}
function makeGrid(rows: number, cols: number, fill = 0): Grid {
  return Array.from({ length: rows }, () => new Array(cols).fill(fill));
}
function num(input: Record<string, unknown>, key: string, fallback: number): number {
  const v = input[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function int(input: Record<string, unknown>, key: string, fallback: number): number {
  return Math.round(num(input, key, fallback));
}
function bool(input: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v = input[key];
  return typeof v === "boolean" ? v : fallback;
}
function clamp(v: number, min: number, max: number): number { return Math.max(min, Math.min(max, v)); }
function binarize(grid: Grid): Grid { return grid.map(row => row.map(v => (v ? 1 : 0))); }

// Zhang-Suen 细化：把任意宽度的输入路网收成 1px 骨架。
// 上游 connected_roads 等道路常为 2px+ 宽，导致基于"度数"的出头/死胡同修剪
// （collectTails 找度=1 端点）完全失效；必须先细化成单像素再修剪。
function thin(input: Grid): Grid {
  const rows = input.length, cols = input[0]?.length ?? 0;
  const img = input.map(r => r.map(v => (v ? 1 : 0)));
  const at = (y: number, x: number): number => (y >= 0 && x >= 0 && y < rows && x < cols ? img[y][x] : 0);
  let changed = true; let guard = 0;
  while (changed && ++guard < 200) {
    changed = false;
    for (const step of [0, 1]) {
      const toClear: number[] = [];
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        if (!img[y][x]) continue;
        const p2 = at(y - 1, x), p3 = at(y - 1, x + 1), p4 = at(y, x + 1), p5 = at(y + 1, x + 1),
              p6 = at(y + 1, x), p7 = at(y + 1, x - 1), p8 = at(y, x - 1), p9 = at(y - 1, x - 1);
        const nb = [p2, p3, p4, p5, p6, p7, p8, p9];
        let B = 0; for (const v of nb) B += v;
        if (B < 2 || B > 6) continue;
        let A = 0; for (let i = 0; i < 8; i++) if (nb[i] === 0 && nb[(i + 1) % 8] === 1) A++;
        if (A !== 1) continue;
        if (step === 0) { if (p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0) continue; }
        else { if (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) continue; }
        toClear.push(y * cols + x);
      }
      if (toClear.length) { changed = true; for (const id of toClear) img[(id / cols) | 0][id % cols] = 0; }
    }
  }
  return img;
}

function dilateClipped(mask: Grid, radius: number, land: Grid): Grid {
  const rows = mask.length, cols = mask[0]?.length ?? 0;
  if (radius <= 0) return mask.map(r => r.slice());
  const out = makeGrid(rows, cols, 0);
  const r2 = radius * radius;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (!mask[y][x]) continue;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && land[ny]?.[nx]) out[ny][nx] = 1;
    }
  }
  return out;
}
function dilate(mask: Grid, radius: number): Grid {
  const rows = mask.length, cols = mask[0]?.length ?? 0;
  if (radius <= 0) return mask.map(r => r.slice());
  const out = makeGrid(rows, cols, 0);
  const r2 = radius * radius;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (!mask[y][x]) continue;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < cols && ny < rows) out[ny][nx] = 1;
    }
  }
  return out;
}
function componentCells(grid: Grid): Point[][] {
  const rows = grid.length, cols = grid[0]?.length ?? 0;
  const seen = new Uint8Array(rows * cols);
  const out: Point[][] = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const start = y * cols + x;
    if (seen[start] || !grid[y]?.[x]) continue;
    const queue = [start]; const cells: Point[] = []; seen[start] = 1;
    for (let head = 0; head < queue.length; head++) {
      const idx = queue[head]; const cx = idx % cols, cy = Math.floor(idx / cols);
      cells.push({ x: cx, y: cy });
      for (const [dx, dy] of N8) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const ni = ny * cols + nx;
        if (seen[ni] || !grid[ny]?.[nx]) continue;
        seen[ni] = 1; queue.push(ni);
      }
    }
    out.push(cells);
  }
  return out.sort((a, b) => b.length - a.length);
}
function filterIslands(land: Grid, minArea: number): Grid {
  const rows = land.length, cols = land[0]?.length ?? 0;
  const comps = componentCells(land);
  const out = makeGrid(rows, cols, 0);
  for (let i = 0; i < comps.length; i++) {
    if (i === 0 || comps[i].length >= minArea) for (const p of comps[i]) out[p.y][p.x] = 1;
  }
  return out;
}
function boundaryDist(land: Grid): Grid {
  const rows = land.length, cols = land[0]?.length ?? 0;
  const dist = makeGrid(rows, cols, 999999);
  const queue: Point[] = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (!land[y][x]) continue;
    let edge = x === 0 || y === 0 || x === cols - 1 || y === rows - 1;
    for (const [dx, dy] of N8) if (!land[y + dy]?.[x + dx]) { edge = true; break; }
    if (edge) { dist[y][x] = 0; queue.push({ x, y }); }
  }
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    for (const [dx, dy] of N8) {
      const nx = p.x + dx, ny = p.y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !land[ny]?.[nx]) continue;
      if (dist[p.y][p.x] + 1 >= dist[ny][nx]) continue;
      dist[ny][nx] = dist[p.y][p.x] + 1; queue.push({ x: nx, y: ny });
    }
  }
  return dist;
}
function skelDegree(skel: Grid, x: number, y: number): number {
  const rows = skel.length, cols = skel[0]?.length ?? 0;
  let n = 0;
  for (const [dx, dy] of N8) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && skel[ny][nx]) n++;
  }
  return n;
}
function isAnchor(anchor: Grid, x: number, y: number): boolean {
  return !!anchor[y]?.[x];
}
// 从每个度=1 自由端点沿骨架走到第一个交叉点或主路锚点，得到一条"出头"。
// endedJunction 表示远端连到交叉点（内部悬挂分支），否则连到主路锚点 / 自成孤立线。
function collectTails(skel: Grid, anchor: Grid): Tail[] {
  const rows = skel.length, cols = skel[0]?.length ?? 0;
  const tails: Tail[] = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (!skel[y][x] || skelDegree(skel, x, y) !== 1) continue;
    const tip = { x, y };
    const cells: Point[] = [{ x, y }];
    let endedJunction = false;
    let cur = { x, y }; let prev: Point | null = null; let guard = 0;
    if (isAnchor(anchor, x, y)) { tails.push({ cells, tip, endedJunction }); continue; }
    for (;;) {
      if (++guard > 100000) break;
      const fwd: Point[] = [];
      for (const [dx, dy] of N8) {
        const nx = cur.x + dx, ny = cur.y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !skel[ny][nx]) continue;
        if (prev && nx === prev.x && ny === prev.y) continue;
        fwd.push({ x: nx, y: ny });
      }
      if (fwd.length !== 1) { if (fwd.length > 1) endedJunction = true; break; }
      prev = cur; cur = fwd[0]; cells.push(cur);
      if (isAnchor(anchor, cur.x, cur.y)) break; // 触达主路锚点
    }
    tails.push({ cells, tip, endedJunction });
  }
  return tails;
}
// 修剪出头：删掉"直戳海岸 / 落在非城区 / 内部短悬挂"的死胡同分支。
// 关键：不再因为分支远端连主路就跳过——海岸→主路的死胡同正是要删的；
// 而主路↔主路的贯通弦（无度=1 端点）不会被 collectTails 收集，天然保留。
function trimSpurs(
  skel: Grid, anchor: Grid, zoneGrid: Grid | null, bdist: Grid,
  coastBand: number, minBranchLen: number, passes: number,
): void {
  for (let pass = 0; pass < passes; pass++) {
    const tails = collectTails(skel, anchor);
    let removed = false;
    for (const tail of tails) {
      const tip = tail.tip;
      const tipAtCoast = (bdist[tip.y]?.[tip.x] ?? 999) <= coastBand;
      const z = zoneGrid ? (zoneGrid[tip.y]?.[tip.x] ?? 0) : COMMERCIAL;
      const tipNonCity = zoneGrid ? (!CITY_ZONES.has(z) && z !== PARK) : false;
      // 短内部悬挂分支（远端是交叉点而非主路锚点）：当作多余小路剔除
      const shortDangling = tail.endedJunction && tail.cells.length < minBranchLen;
      if (!(tipAtCoast || tipNonCity || shortDangling)) continue;
      // 远端为交叉点时保留该交叉点像素，避免割裂贯通路
      const rm = tail.endedJunction ? tail.cells.slice(0, -1) : tail.cells;
      if (rm.length === 0) continue;
      for (const c of rm) skel[c.y][c.x] = 0;
      removed = true;
    }
    if (!removed) break;
  }
}

const NAMES: NameEntry[] = [{ id: TRIM_ROAD, name: "裁剪路网", type: "tile" }];

export function roadTrim(input: Record<string, unknown>): Record<string, unknown> {
  if (!isGrid(input.inputGrid)) return { error: "inputGrid is required" };
  const inputGrid = input.inputGrid as Grid;
  const cutterGrid = isGrid(input.cutterGrid) ? input.cutterGrid as Grid : null;
  const zoneGrid = isGrid(input.zoneGrid) ? input.zoneGrid as Grid : null;
  const rows = inputGrid.length, cols = inputGrid[0]?.length ?? 0;

  const cityOnly = bool(input, "cityOnly", false);
  const cutWidth = clamp(int(input, "cutWidth", 1), 0, 6);
  const coastBand = clamp(int(input, "coastBand", 14), 0, 40);
  const minBranchLen = clamp(int(input, "minBranchLen", 14), 0, 80);
  const passes = clamp(int(input, "passes", 6), 1, 12);
  const minIslandArea = clamp(int(input, "minIslandArea", 1200), 0, 20000);
  const minKeep = clamp(int(input, "minKeep", 12), 1, 120);
  const roadWidth = clamp(int(input, "roadWidth", 1), 1, 5);
  const drawRadius = Math.floor((roadWidth - 1) / 2);

  const rawLand = isGrid(input.landGrid) ? binarize(input.landGrid as Grid) : makeGrid(rows, cols, 1);
  const land = filterIslands(rawLand, minIslandArea);

  const mainBin = cutterGrid ? binarize(cutterGrid) : makeGrid(rows, cols, 0);
  const mainBuffer = cutWidth > 0 ? dilate(mainBin, cutWidth) : mainBin;
  // 锚点：切割缓冲外再扩 1px，标记"贴近主路"的骨架像素，作为修剪/保留的依据
  const anchor = dilate(mainBin, cutWidth + 1);
  const bdist = boundaryDist(land);

  // 1px 骨架：输入细化后 ∩ 陆地，可选仅城区
  const skel = makeGrid(rows, cols, 0);
  const inThin = thin(binarize(inputGrid));
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (!inThin[y][x] || !land[y][x]) continue;
    if (cityOnly && zoneGrid && !CITY_ZONES.has(zoneGrid[y]?.[x] ?? 0)) continue;
    skel[y][x] = 1;
  }

  // 切割：移除与主路缓冲重叠的像素，把贯通路在主路处断开
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (mainBuffer[y][x]) skel[y][x] = 0;

  // 修剪：删掉直戳海岸 / 非城区 / 内部短悬挂的死胡同出头
  trimSpurs(skel, anchor, zoneGrid, bdist, coastBand, minBranchLen, passes);

  // 只保留贴近主路（锚点）且足够大的连通块：去掉点状碎块与漂浮残段
  for (const cells of componentCells(skel)) {
    const touchesMain = cells.some(p => anchor[p.y]?.[p.x]);
    if (!touchesMain || cells.length < minKeep) for (const p of cells) skel[p.y][p.x] = 0;
  }

  const wide = drawRadius > 0 ? dilateClipped(skel, drawRadius, land) : skel;
  const roadGrid = wide.map((row, y) => row.map((v, x) => (v && !mainBin[y]?.[x] ? TRIM_ROAD : 0)));
  return { roadGrid, outputGrid: roadGrid, outputNameList: NAMES };
}
