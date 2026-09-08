type Grid = number[][];

interface Point { x: number; y: number; }
interface Candidate extends Point {
  nx: number;
  ny: number;
  tx: number;
  ty: number;
  score: number;
}

const DOCK_YARD = 416;
const PIER = 306;
const HARBOR_BASIN = 307;
const DIR4 = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
const DIR8: Array<[number, number]> = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
  [-1, -1], [1, -1], [-1, 1], [1, 1],
];

function isGrid(value: unknown): value is Grid {
  return Array.isArray(value)
    && value.length > 0
    && Array.isArray(value[0])
    && ((value[0] as unknown[]).length === 0 || typeof (value[0] as unknown[])[0] === "number");
}

function makeGrid(rows: number, cols: number, fill = 0): Grid {
  return Array.from({ length: rows }, () => new Array(cols).fill(fill));
}

function num(input: Record<string, unknown>, key: string, fallback: number): number {
  const value = input[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function int(input: Record<string, unknown>, key: string, fallback: number): number {
  return Math.round(num(input, key, fallback));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function resolveSeed(seed: unknown): number {
  const raw = typeof seed === "number" && Number.isFinite(seed) ? seed : 0;
  return raw === 0 ? 123456789 : raw >>> 0;
}

function hash2(x: number, y: number, seed: number): number {
  let h = (seed | 0) ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function isLand(landGrid: Grid, x: number, y: number): boolean {
  return y >= 0 && y < landGrid.length && x >= 0 && x < (landGrid[0]?.length ?? 0) && landGrid[y]?.[x] > 0;
}

function distanceToLand(landGrid: Grid): Grid {
  const rows = landGrid.length;
  const cols = landGrid[0]?.length ?? 0;
  const dist = makeGrid(rows, cols, Infinity);
  const queue: Point[] = [];
  let head = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!landGrid[y]?.[x]) continue;
      dist[y][x] = 0;
      queue.push({ x, y });
    }
  }
  while (head < queue.length) {
    const p = queue[head++];
    for (const [dx, dy] of DIR4) {
      const nx = p.x + dx;
      const ny = p.y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || dist[ny][nx] <= dist[p.y][p.x] + 1) continue;
      dist[ny][nx] = dist[p.y][p.x] + 1;
      queue.push({ x: nx, y: ny });
    }
  }
  return dist;
}

function distanceToFeature(featureGrid: Grid | null): Grid | null {
  if (!featureGrid) return null;
  const rows = featureGrid.length;
  const cols = featureGrid[0]?.length ?? 0;
  const dist = makeGrid(rows, cols, Infinity);
  const queue: Point[] = [];
  let head = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!featureGrid[y]?.[x]) continue;
      dist[y][x] = 0;
      queue.push({ x, y });
    }
  }
  while (head < queue.length) {
    const p = queue[head++];
    for (const [dx, dy] of DIR4) {
      const nx = p.x + dx;
      const ny = p.y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || dist[ny][nx] <= dist[p.y][p.x] + 1) continue;
      dist[ny][nx] = dist[p.y][p.x] + 1;
      queue.push({ x: nx, y: ny });
    }
  }
  return dist;
}

function coastCells(landGrid: Grid): Point[] {
  const rows = landGrid.length;
  const cols = landGrid[0]?.length ?? 0;
  const out: Point[] = [];
  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      if (!landGrid[y]?.[x]) continue;
      if (DIR4.some(([dx, dy]) => !landGrid[y + dy]?.[x + dx])) out.push({ x, y });
    }
  }
  return out;
}

function waterNormal(landGrid: Grid, x: number, y: number): Point | null {
  let sx = 0;
  let sy = 0;
  let count = 0;
  for (const [dx, dy] of DIR8) {
    if (isLand(landGrid, x + dx, y + dy)) continue;
    sx += dx;
    sy += dy;
    count++;
  }
  if (count === 0) return null;
  const len = Math.hypot(sx, sy) || 1;
  return { x: sx / len, y: sy / len };
}

function lineWaterRun(landGrid: Grid, start: Point, nx: number, ny: number, maxLen: number): number {
  let run = 0;
  for (let i = 1; i <= maxLen; i++) {
    const x = Math.round(start.x + nx * i);
    const y = Math.round(start.y + ny * i);
    if (x < 0 || y < 0 || y >= landGrid.length || x >= (landGrid[0]?.length ?? 0)) break;
    if (landGrid[y]?.[x]) break;
    run++;
  }
  return run;
}

function landBackRun(landGrid: Grid, start: Point, nx: number, ny: number, maxLen: number): number {
  let run = 0;
  for (let i = 1; i <= maxLen; i++) {
    const x = Math.round(start.x - nx * i);
    const y = Math.round(start.y - ny * i);
    if (!isLand(landGrid, x, y)) break;
    run++;
  }
  return run;
}

function sideEnclosure(landGrid: Grid, p: Point, nx: number, ny: number, width: number, depth: number): number {
  const tx = -ny;
  const ty = nx;
  let sideHits = 0;
  let samples = 0;
  for (const sign of [-1, 1]) {
    for (let u = width * 0.35; u <= width * 0.55; u += Math.max(4, width * 0.1)) {
      samples++;
      let hit = false;
      for (let v = 6; v <= depth; v += 4) {
        const x = Math.round(p.x + tx * u * sign + nx * v);
        const y = Math.round(p.y + ty * u * sign + ny * v);
        if (isLand(landGrid, x, y)) {
          hit = true;
          break;
        }
      }
      if (hit) sideHits++;
    }
  }
  return samples > 0 ? sideHits / samples : 0;
}

function flatLandScore(landGrid: Grid, heightMap: Grid | null, p: Point, nx: number, ny: number, width: number, depth: number): number {
  let total = 0;
  let score = 0;
  const tx = -ny;
  const ty = nx;
  for (let v = 2; v <= depth; v += 4) {
    for (let u = -width / 2; u <= width / 2; u += 5) {
      const x = Math.round(p.x - nx * v + tx * u);
      const y = Math.round(p.y - ny * v + ty * u);
      if (!isLand(landGrid, x, y)) continue;
      total++;
      const h = heightMap ? (heightMap[y]?.[x] ?? 0.55) : 0.55;
      let slope = 0;
      if (heightMap) {
        for (const [dx, dy] of DIR8) {
          if (!isLand(landGrid, x + dx, y + dy)) continue;
          slope = Math.max(slope, Math.abs(h - (heightMap[y + dy]?.[x + dx] ?? h)));
        }
      }
      score += clamp(1 - slope / 0.14, 0, 1) * clamp(1 - Math.max(0, h - 0.76) / 0.2, 0, 1);
    }
  }
  return total > 0 ? score / total : 0;
}

function scoreCandidate(
  landGrid: Grid,
  heightMap: Grid | null,
  roadDist: Grid | null,
  buildingDist: Grid | null,
  avoidMask: Grid | null,
  p: Point,
  width: number,
  pierLength: number,
  yardDepth: number,
  seed: number,
): Candidate | null {
  const n = waterNormal(landGrid, p.x, p.y);
  if (!n) return null;
  const water = lineWaterRun(landGrid, p, n.x, n.y, Math.max(24, pierLength));
  const land = landBackRun(landGrid, p, n.x, n.y, Math.max(12, yardDepth));
  if (water < Math.max(12, pierLength * 0.42) || land < Math.max(6, yardDepth * 0.35)) return null;
  if (avoidMask && avoidMask[p.y]?.[p.x]) return null;

  const enclosed = sideEnclosure(landGrid, p, n.x, n.y, width, pierLength * 0.72);
  const flat = flatLandScore(landGrid, heightMap, p, n.x, n.y, width, yardDepth);
  const city = roadDist ? clamp(1 - (roadDist[p.y]?.[p.x] ?? 9999) / 95, 0, 1) : 0.45;
  const built = buildingDist ? clamp(1 - (buildingDist[p.y]?.[p.x] ?? 9999) / 85, 0, 1) : 0.35;
  const jitter = hash2(p.x, p.y, seed) * 0.08;
  const score = clamp(water / pierLength, 0, 1.35) * 0.85
    + enclosed * 1.2
    + flat * 0.95
    + city * 0.45
    + built * 0.25
    + jitter;
  return { x: p.x, y: p.y, nx: n.x, ny: n.y, tx: -n.y, ty: n.x, score };
}

function pickHarbor(
  landGrid: Grid,
  heightMap: Grid | null,
  roadGrid: Grid | null,
  buildingGrid: Grid | null,
  avoidMask: Grid | null,
  width: number,
  pierLength: number,
  yardDepth: number,
  seed: number,
): Candidate {
  const roadDist = distanceToFeature(roadGrid);
  const buildingDist = distanceToFeature(buildingGrid);
  const candidates = coastCells(landGrid);
  const stride = Math.max(1, Math.floor(candidates.length / 1800));
  let best: Candidate | null = null;
  for (let i = 0; i < candidates.length; i += stride) {
    const c = scoreCandidate(landGrid, heightMap, roadDist, buildingDist, avoidMask, candidates[i], width, pierLength, yardDepth, seed);
    if (c && (!best || c.score > best.score)) best = c;
  }
  if (best) return best;
  const fallback = candidates[Math.floor(hash2(seed, candidates.length, seed) * Math.max(1, candidates.length))] ?? {
    x: Math.round((landGrid[0]?.length ?? 1) * 0.5),
    y: Math.round(landGrid.length * 0.5),
  };
  const n = waterNormal(landGrid, fallback.x, fallback.y) ?? { x: 1, y: 0 };
  return { ...fallback, nx: n.x, ny: n.y, tx: -n.y, ty: n.x, score: 0 };
}

function drawDisk(grid: Grid, mask: Grid | null, cx: number, cy: number, radius: number, value: number): void {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const r = Math.max(0, Math.round(radius));
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const x = Math.round(cx) + dx;
      const y = Math.round(cy) + dy;
      if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
      if (mask && !mask[y]?.[x]) continue;
      grid[y][x] = value;
    }
  }
}

function drawLine(grid: Grid, mask: Grid | null, a: Point, b: Point, radius: number, value: number): void {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    drawDisk(grid, mask, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, radius, value);
  }
}

function drawPierFinger(
  grid: Grid,
  mask: Grid | null,
  base: Point,
  tx: number,
  ty: number,
  nx: number,
  ny: number,
  length: number,
  width: number,
): void {
  const center = { x: base.x + nx * length * 0.5, y: base.y + ny * length * 0.5 };
  drawRectByAxes(grid, mask, center, tx, ty, nx, ny, width, length, PIER);
  drawDisk(grid, mask, base.x + nx * length, base.y + ny * length, Math.max(2, width * 0.55), PIER);
}

function drawRectByAxes(grid: Grid, mask: Grid | null, center: Point, tx: number, ty: number, nx: number, ny: number, width: number, depth: number, value: number): void {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const r = Math.ceil(Math.hypot(width / 2, depth / 2));
  for (let y = Math.max(0, Math.floor(center.y - r)); y <= Math.min(rows - 1, Math.ceil(center.y + r)); y++) {
    for (let x = Math.max(0, Math.floor(center.x - r)); x <= Math.min(cols - 1, Math.ceil(center.x + r)); x++) {
      if (mask && !mask[y]?.[x]) continue;
      const dx = x - center.x;
      const dy = y - center.y;
      const u = dx * tx + dy * ty;
      const v = dx * nx + dy * ny;
      if (Math.abs(u) <= width / 2 && Math.abs(v) <= depth / 2) grid[y][x] = value;
    }
  }
}

function waterMask(landGrid: Grid, avoidMask: Grid | null): Grid {
  const rows = landGrid.length;
  const cols = landGrid[0]?.length ?? 0;
  const out = makeGrid(rows, cols, 0);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!landGrid[y]?.[x] && !(avoidMask && avoidMask[y]?.[x])) out[y][x] = 1;
    }
  }
  return out;
}

function landMaskWithoutAvoid(landGrid: Grid, avoidMask: Grid | null): Grid {
  const rows = landGrid.length;
  const cols = landGrid[0]?.length ?? 0;
  const out = makeGrid(rows, cols, 0);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (landGrid[y]?.[x] && !(avoidMask && avoidMask[y]?.[x])) out[y][x] = 1;
    }
  }
  return out;
}

function overlay(base: Grid, layer: Grid): void {
  for (let y = 0; y < base.length; y++) {
    for (let x = 0; x < (base[0]?.length ?? 0); x++) {
      const v = layer[y]?.[x] ?? 0;
      if (v) base[y][x] = v;
    }
  }
}

export function gtaHarborArea(input: Record<string, unknown>): Record<string, unknown> {
  if (!isGrid(input.landGrid)) return { error: "landGrid is required" };
  const landGrid = input.landGrid as Grid;
  const heightMap = isGrid(input.heightMap) ? input.heightMap as Grid : null;
  const cityRoadGrid = isGrid(input.cityRoadGrid) ? input.cityRoadGrid as Grid : null;
  const buildingGrid = isGrid(input.buildingGrid) ? input.buildingGrid as Grid : null;
  const avoidMask = isGrid(input.avoidMask) ? input.avoidMask as Grid : null;
  const rows = landGrid.length;
  const cols = landGrid[0]?.length ?? 0;
  const seed = resolveSeed(input.seed);
  const pierCount = clamp(int(input, "pierCount", 5), 2, 12);
  const pierLength = clamp(int(input, "pierLength", 42), 12, 110);
  const harborWidth = clamp(int(input, "harborWidth", 72), 28, 150);
  const yardDepth = clamp(int(input, "yardDepth", 22), 8, 70);
  const site = pickHarbor(landGrid, heightMap, cityRoadGrid, buildingGrid, avoidMask, harborWidth, pierLength, yardDepth, seed);
  const water = waterMask(landGrid, avoidMask);
  const land = landMaskWithoutAvoid(landGrid, avoidMask);
  const basinGrid = makeGrid(rows, cols, 0);
  const pierGrid = makeGrid(rows, cols, 0);
  const yardGrid = makeGrid(rows, cols, 0);

  const basinCenter = { x: site.x + site.nx * pierLength * 0.42, y: site.y + site.ny * pierLength * 0.42 };
  drawRectByAxes(basinGrid, water, basinCenter, site.tx, site.ty, site.nx, site.ny, harborWidth * 0.78, pierLength * 0.58, HARBOR_BASIN);
  const outerBasin = { x: site.x + site.nx * pierLength * 0.78, y: site.y + site.ny * pierLength * 0.78 };
  drawRectByAxes(basinGrid, water, outerBasin, site.tx, site.ty, site.nx, site.ny, harborWidth * 0.52, pierLength * 0.16, HARBOR_BASIN);

  const yardCenter = { x: site.x - site.nx * yardDepth * 0.45, y: site.y - site.ny * yardDepth * 0.45 };
  drawRectByAxes(yardGrid, land, yardCenter, site.tx, site.ty, site.nx, site.ny, harborWidth * 0.86, yardDepth, DOCK_YARD);
  const backYard = { x: site.x - site.nx * yardDepth * 1.08, y: site.y - site.ny * yardDepth * 1.08 };
  drawRectByAxes(yardGrid, land, backYard, site.tx, site.ty, site.nx, site.ny, harborWidth * 0.58, yardDepth * 0.38, DOCK_YARD);

  // The reference GTA docks are not tiny piers: they have a continuous quay along
  // the shoreline, then several long rectangular fingers extending into the basin.
  drawRectByAxes(
    pierGrid,
    null,
    { x: site.x + site.nx * 2, y: site.y + site.ny * 2 },
    site.tx,
    site.ty,
    site.nx,
    site.ny,
    harborWidth * 0.92,
    5,
    PIER,
  );

  const spacing = harborWidth / Math.max(1, pierCount);
  const start = -(spacing * (pierCount - 1)) / 2;
  for (let i = 0; i < pierCount; i++) {
    const offset = start + spacing * i;
    const base = { x: site.x + site.tx * offset, y: site.y + site.ty * offset };
    const length = pierLength * (0.48 + hash2(i, site.x, seed) * 0.18);
    const thickness = clamp(spacing * 0.18, 3, 7);
    drawPierFinger(pierGrid, water, base, site.tx, site.ty, site.nx, site.ny, length, thickness);
    if (i % 2 === 0) {
      const sideBase = {
        x: base.x + site.nx * length * 0.62,
        y: base.y + site.ny * length * 0.62,
      };
      const sideSign = i % 4 === 0 ? 1 : -1;
      drawLine(
        pierGrid,
        water,
        sideBase,
        { x: sideBase.x + site.tx * spacing * 0.34 * sideSign, y: sideBase.y + site.ty * spacing * 0.34 * sideSign },
        Math.max(2, thickness * 0.35),
        PIER,
      );
    }
  }

  const breakwaterCenter = { x: site.x + site.nx * pierLength * 0.84, y: site.y + site.ny * pierLength * 0.84 };
  drawRectByAxes(pierGrid, water, breakwaterCenter, site.tx, site.ty, site.nx, site.ny, harborWidth * 0.42, 4, PIER);

  const harborGrid = makeGrid(rows, cols, 0);
  overlay(harborGrid, basinGrid);
  overlay(harborGrid, yardGrid);
  overlay(harborGrid, pierGrid);

  return {
    harborGrid,
    pierGrid,
    basinGrid,
    yardGrid,
    harborSite: {
      centerX: site.x,
      centerY: site.y,
      normalX: site.nx,
      normalY: site.ny,
      tangentX: site.tx,
      tangentY: site.ty,
      score: site.score,
      pierCount,
      pierLength,
      harborWidth,
      yardDepth,
    },
    outputGrid: harborGrid,
    outputNameList: [
      { id: DOCK_YARD, name: "码头陆地区", type: "tile" },
      { id: PIER, name: "码头栈桥", type: "tile" },
      { id: HARBOR_BASIN, name: "港池泊位", type: "tile" },
    ],
  };
}
