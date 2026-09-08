type Grid = number[][];

interface NameEntry { id: number; name: string; type?: string; }
interface Point { x: number; y: number; }
interface BSPRect { uMin: number; uMax: number; vMin: number; vMax: number; }

const COMMERCIAL = 421;
const RESIDENTIAL = 422;
const INDUSTRIAL = 423;
const SUBURB = 427;
const CITY_ROAD = 303;
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
  const v = input[key]; return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function int(input: Record<string, unknown>, key: string, fallback: number): number {
  return Math.round(num(input, key, fallback));
}
function clamp(v: number, min: number, max: number): number { return Math.max(min, Math.min(max, v)); }
function resolveSeed(seed: unknown): number {
  const raw = typeof seed === "number" && Number.isFinite(seed) ? seed : 0;
  return raw === 0 ? 123456789 : raw >>> 0;
}
function hash2(x: number, y: number, seed: number): number {
  let h = (seed | 0) ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function binarize(grid: Grid): Grid { return grid.map(row => row.map(v => (v ? 1 : 0))); }

const fade = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x); const y0 = Math.floor(y);
  const xf = x - x0; const yf = y - y0;
  return lerp(
    lerp(hash2(x0, y0, seed), hash2(x0 + 1, y0, seed), fade(xf)),
    lerp(hash2(x0, y0 + 1, seed), hash2(x0 + 1, y0 + 1, seed), fade(xf)),
    fade(yf),
  );
}

function dilateClipped(mask: Grid, radius: number, land: Grid): Grid {
  const rows = mask.length, cols = mask[0]?.length ?? 0;
  if (radius <= 0) return mask.map(r => r.slice());
  const out = makeGrid(rows, cols, 0); const r2 = radius * radius;
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
  const out = makeGrid(rows, cols, 0); const r2 = radius * radius;
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
  const seen = new Uint8Array(rows * cols); const out: Point[][] = [];
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
  const comps = componentCells(land); const out = makeGrid(rows, cols, 0);
  for (let i = 0; i < comps.length; i++) {
    if (i === 0 || comps[i].length >= minArea) for (const p of comps[i]) out[p.y][p.x] = 1;
  }
  return out;
}
function boundaryDist(land: Grid): Grid {
  const rows = land.length, cols = land[0]?.length ?? 0;
  const dist = makeGrid(rows, cols, 999999); const queue: Point[] = [];
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
function centerOf(cells: Point[]): Point {
  let sx = 0, sy = 0; for (const p of cells) { sx += p.x; sy += p.y; }
  return { x: sx / Math.max(1, cells.length), y: sy / Math.max(1, cells.length) };
}
function orientation(cells: Point[]): number {
  const c = centerOf(cells); let xx = 0, yy = 0, xy = 0;
  for (const p of cells) { const dx = p.x - c.x, dy = p.y - c.y; xx += dx * dx; yy += dy * dy; xy += dx * dy; }
  return 0.5 * Math.atan2(2 * xy, xx - yy);
}
function dominantZone(cells: Point[], zoneGrid: Grid): number {
  const counts = new Map<number, number>();
  for (const p of cells) { const v = zoneGrid[p.y]?.[p.x] ?? 0; if (v > 0) counts.set(v, (counts.get(v) ?? 0) + 1); }
  let zone = 0, best = 0;
  for (const [v, c] of counts) if (c > best) { best = c; zone = v; }
  return zone;
}
function mainDirectionNear(center: Point, radius: number, mainCells: Point[]): number | null {
  const near: Point[] = [];
  for (const p of mainCells) if (Math.abs(p.x - center.x) <= radius && Math.abs(p.y - center.y) <= radius) near.push(p);
  if (near.length < 8) return null;
  return orientation(near);
}
function stampLine(skel: Grid, land: Grid, a: Point, b: Point): void {
  const rows = skel.length, cols = skel[0]?.length ?? 0;
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 1.5));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = Math.round(a.x + (b.x - a.x) * t);
    const y = Math.round(a.y + (b.y - a.y) * t);
    if (x >= 0 && y >= 0 && y < rows && x < cols && land[y][x]) skel[y][x] = 1;
  }
}

// ─── BSP zone-adaptive parameters ───────────────────────────────────────────

function zoneDepthLimit(zone: number): number {
  if (zone === COMMERCIAL) return 5;
  if (zone === RESIDENTIAL) return 4;
  if (zone === INDUSTRIAL) return 3;
  if (zone === SUBURB) return 2;
  return 3;
}

function zoneMinBlockSize(zone: number, gridSpacing: number): number {
  if (zone === COMMERCIAL) return gridSpacing * 0.7;
  if (zone === RESIDENTIAL) return gridSpacing * 1.2;
  if (zone === INDUSTRIAL) return gridSpacing * 2.5;
  if (zone === SUBURB) return gridSpacing * 4.0;
  return gridSpacing * 1.2;
}

function zoneStopChance(zone: number, depth: number, maxDepth: number): number {
  const base = zone === COMMERCIAL ? 0.05 : zone === RESIDENTIAL ? 0.12 : zone === INDUSTRIAL ? 0.20 : 0.30;
  return base + (depth / Math.max(1, maxDepth)) * 0.20;
}

function zonePerturbAmp(zone: number): number {
  if (zone === COMMERCIAL) return 0;
  if (zone === RESIDENTIAL) return 1.5;
  if (zone === INDUSTRIAL) return 0.8;
  if (zone === SUBURB) return 3.0;
  return 1.0;
}

// ─── BSP core ───────────────────────────────────────────────────────────────

function sampleZoneAt(
  zoneGrid: Grid, center: Point, ca: number, sa: number, u: number, v: number,
): number {
  const wx = Math.round(center.x + u * ca - v * sa);
  const wy = Math.round(center.y + u * sa + v * ca);
  const rows = zoneGrid.length, cols = zoneGrid[0]?.length ?? 0;
  if (wx >= 0 && wy >= 0 && wy < rows && wx < cols) return zoneGrid[wy]?.[wx] ?? 0;
  return 0;
}

function drawBSPLine(
  skel: Grid, drawMask: Grid,
  center: Point, ca: number, sa: number,
  fixedCoord: number, rangeMin: number, rangeMax: number,
  isU: boolean, perturbAmp: number, perturbSeed: number,
): void {
  const rows = skel.length, cols = skel[0]?.length ?? 0;
  for (let t = rangeMin; t <= rangeMax; t += 0.5) {
    const offset = perturbAmp > 0
      ? (valueNoise(t * 0.06, fixedCoord * 0.08, perturbSeed) - 0.5) * 2 * perturbAmp
      : 0;
    const u = isU ? (fixedCoord + offset) : t;
    const v = isU ? t : (fixedCoord + offset);
    const wx = Math.round(center.x + u * ca - v * sa);
    const wy = Math.round(center.y + u * sa + v * ca);
    if (wx >= 0 && wy >= 0 && wy < rows && wx < cols && drawMask[wy][wx]) {
      skel[wy][wx] = 1;
    }
  }
}

function bspSubdivide(
  skel: Grid, drawMask: Grid, zoneGrid: Grid,
  center: Point, ca: number, sa: number,
  rect: BSPRect, depth: number, fallbackZone: number,
  gridSpacing: number, seed: number,
): void {
  const uLen = rect.uMax - rect.uMin;
  const vLen = rect.vMax - rect.vMin;

  const uMid = (rect.uMin + rect.uMax) / 2;
  const vMid = (rect.vMin + rect.vMax) / 2;
  const localZone = sampleZoneAt(zoneGrid, center, ca, sa, uMid, vMid);
  const zone = CITY_ZONES.has(localZone) ? localZone : fallbackZone;

  const maxDepth = zoneDepthLimit(zone);
  const minBlock = zoneMinBlockSize(zone, gridSpacing);

  if (depth >= maxDepth) return;
  if (uLen < minBlock * 1.6 && vLen < minBlock * 1.6) return;

  if (depth >= 2) {
    const stop = zoneStopChance(zone, depth, maxDepth);
    if (hash2(Math.floor(rect.uMin * 10 + rect.vMax), depth * 31 + 7, seed) < stop) return;
  }

  let splitU: boolean;
  if (uLen > vLen * 1.25) splitU = true;
  else if (vLen > uLen * 1.25) splitU = false;
  else splitU = hash2(Math.floor(rect.uMin * 37), Math.floor(rect.vMin * 53), seed + depth * 113) > 0.5;

  const dim = splitU ? uLen : vLen;
  if (dim < minBlock * 1.6) {
    const otherDim = splitU ? vLen : uLen;
    if (otherDim >= minBlock * 1.6) splitU = !splitU;
    else return;
  }

  const ratio = 0.30 + hash2(
    Math.floor((rect.uMin + rect.uMax) * 37),
    Math.floor((rect.vMin + rect.vMax) * 53),
    seed + depth * 997,
  ) * 0.40;

  const perturb = zonePerturbAmp(zone);
  const childSeed = (seed * 2654435761) >>> 0;

  if (splitU) {
    const splitPos = rect.uMin + uLen * ratio;
    drawBSPLine(skel, drawMask, center, ca, sa,
      splitPos, rect.vMin, rect.vMax, true, perturb, seed + depth * 313);
    bspSubdivide(skel, drawMask, zoneGrid, center, ca, sa,
      { uMin: rect.uMin, uMax: splitPos, vMin: rect.vMin, vMax: rect.vMax },
      depth + 1, zone, gridSpacing, childSeed + 1);
    bspSubdivide(skel, drawMask, zoneGrid, center, ca, sa,
      { uMin: splitPos, uMax: rect.uMax, vMin: rect.vMin, vMax: rect.vMax },
      depth + 1, zone, gridSpacing, childSeed + 2);
  } else {
    const splitPos = rect.vMin + vLen * ratio;
    drawBSPLine(skel, drawMask, center, ca, sa,
      splitPos, rect.uMin, rect.uMax, false, perturb, seed + depth * 313);
    bspSubdivide(skel, drawMask, zoneGrid, center, ca, sa,
      { uMin: rect.uMin, uMax: rect.uMax, vMin: rect.vMin, vMax: splitPos },
      depth + 1, zone, gridSpacing, childSeed + 3);
    bspSubdivide(skel, drawMask, zoneGrid, center, ca, sa,
      { uMin: rect.uMin, uMax: rect.uMax, vMin: splitPos, vMax: rect.vMax },
      depth + 1, zone, gridSpacing, childSeed + 4);
  }
}

// ─── Connectivity: extend isolated segments to road network, remove orphans ─

function ensureConnectivity(
  skel: Grid, combinedRoad: Grid, land: Grid, maxExtend: number,
): void {
  const rows = skel.length, cols = skel[0]?.length ?? 0;
  const touchZone = dilate(combinedRoad, 2);

  for (const cells of componentCells(skel)) {
    if (cells.length < 3) { for (const p of cells) skel[p.y][p.x] = 0; continue; }
    if (cells.some(p => touchZone[p.y]?.[p.x])) continue;

    let bestDist = Infinity;
    let bestCell: Point | null = null;
    let bestRoad: Point | null = null;
    const stride = Math.max(1, Math.floor(cells.length / 40));

    for (let i = 0; i < cells.length; i += stride) {
      const p = cells[i];
      for (let r = 1; r <= maxExtend; r++) {
        let found = false;
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
            const nx = p.x + dx, ny = p.y + dy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !combinedRoad[ny][nx]) continue;
            const d = Math.hypot(dx, dy);
            if (d < bestDist) { bestDist = d; bestCell = p; bestRoad = { x: nx, y: ny }; found = true; }
          }
        }
        if (found) break;
      }
      if (bestDist <= 3) break;
    }

    if (bestCell && bestRoad && bestDist <= maxExtend) {
      stampLine(skel, land, bestCell, bestRoad);
    } else {
      for (const p of cells) skel[p.y][p.x] = 0;
    }
  }
}

// ─── Per-superblock BSP driver ──────────────────────────────────────────────

const ANGLE_OFFSETS = [0, 0, 0, 0, Math.PI * 0.05, -Math.PI * 0.05, Math.PI * 0.10, -Math.PI * 0.10, Math.PI * 0.18];

function drawCityGridBSP(
  skel: Grid, regionCells: Point[], drawMask: Grid, zoneGrid: Grid,
  roadCells: Point[], gridSpacing: number, dirRadius: number, seed: number,
): void {
  if (regionCells.length < 20) return;
  const c = centerOf(regionCells);

  const baseAngle = mainDirectionNear(c, dirRadius, roadCells) ?? 0;
  const offsetIdx = Math.floor(hash2(Math.floor(c.x), Math.floor(c.y), seed + 777) * ANGLE_OFFSETS.length);
  const angle = baseAngle + ANGLE_OFFSETS[offsetIdx % ANGLE_OFFSETS.length];

  const ca = Math.cos(angle), sa = Math.sin(angle);
  const zone = dominantZone(regionCells, zoneGrid);

  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (const p of regionCells) {
    const dx = p.x - c.x, dy = p.y - c.y;
    const u = dx * ca + dy * sa, v = -dx * sa + dy * ca;
    if (u < uMin) uMin = u; if (u > uMax) uMax = u;
    if (v < vMin) vMin = v; if (v > vMax) vMax = v;
  }

  const pad = gridSpacing * 0.3;
  uMin -= pad; uMax += pad; vMin -= pad; vMax += pad;

  bspSubdivide(skel, drawMask, zoneGrid, c, ca, sa,
    { uMin, uMax, vMin, vMax }, 0, zone, gridSpacing, seed);
}

// ─── Export ─────────────────────────────────────────────────────────────────

const NAMES: NameEntry[] = [{ id: CITY_ROAD, name: "城区街道", type: "tile" }];

export function cityGrid(input: Record<string, unknown>): Record<string, unknown> {
  if (!isGrid(input.zoneGrid)) return { error: "zoneGrid is required" };
  const zoneGrid = input.zoneGrid as Grid;
  const buildableMask = isGrid(input.buildableMask) ? binarize(input.buildableMask as Grid) : null;
  const mainRoadGrid = isGrid(input.mainRoadGrid) ? input.mainRoadGrid as Grid : null;
  const existingRoadGrid = isGrid(input.existingRoadGrid) ? input.existingRoadGrid as Grid : null;
  const rows = zoneGrid.length, cols = zoneGrid[0]?.length ?? 0;

  const seed = resolveSeed(input.seed);
  const gridSpacing = clamp(int(input, "gridSpacing", 20), 4, 80);
  const coastInset = clamp(int(input, "coastInset", 6), 0, 30);
  const dirRadius = clamp(int(input, "dirRadius", 60), 8, 200);
  const minRegionArea = clamp(int(input, "minRegionArea", 200), 20, 4000);
  const minIslandArea = clamp(int(input, "minIslandArea", 1200), 0, 20000);
  const roadWidth = clamp(int(input, "roadWidth", 1), 1, 5);
  const drawRadius = Math.floor((roadWidth - 1) / 2);

  const rawLand = isGrid(input.landGrid)
    ? binarize(input.landGrid as Grid)
    : zoneGrid.map(row => row.map(v => (v > 0 ? 1 : 0)));
  const land = filterIslands(rawLand, minIslandArea);
  const bdist = boundaryDist(land);

  const mainBin = mainRoadGrid ? binarize(mainRoadGrid) : makeGrid(rows, cols, 0);
  const existingBin = existingRoadGrid ? binarize(existingRoadGrid) : makeGrid(rows, cols, 0);

  const combinedRoad = makeGrid(rows, cols, 0);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (mainBin[y][x] || existingBin[y][x]) combinedRoad[y][x] = 1;
  }
  const roadCells = componentCells(combinedRoad).flat();

  const drawMask = makeGrid(rows, cols, 0);
  const superBlockMask = makeGrid(rows, cols, 0);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (!land[y][x] || !CITY_ZONES.has(zoneGrid[y]?.[x] ?? 0)) continue;
    if (buildableMask && !buildableMask[y][x]) continue;
    if ((bdist[y][x] ?? 0) <= coastInset) continue;
    drawMask[y][x] = 1;
    if (!combinedRoad[y][x]) superBlockMask[y][x] = 1;
  }

  const skel = makeGrid(rows, cols, 0);
  let ri = 0;
  for (const region of componentCells(superBlockMask)) {
    if (region.length < minRegionArea) continue;
    drawCityGridBSP(skel, region, drawMask, zoneGrid, roadCells, gridSpacing, dirRadius, seed + ri * 1009);
    ri++;
  }

  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (combinedRoad[y][x]) skel[y][x] = 0;
  }

  ensureConnectivity(skel, combinedRoad, land, Math.round(gridSpacing * 1.5));

  const minKeep = Math.max(4, Math.round(gridSpacing * 0.4));
  for (const cells of componentCells(skel)) {
    if (cells.length < minKeep) for (const p of cells) skel[p.y][p.x] = 0;
  }

  const wide = drawRadius > 0 ? dilateClipped(skel, drawRadius, land) : skel;
  const roadGrid = wide.map((row, y) => row.map((v, x) => (v && !combinedRoad[y]?.[x] ? CITY_ROAD : 0)));
  return { roadGrid, outputGrid: roadGrid, outputNameList: NAMES };
}
