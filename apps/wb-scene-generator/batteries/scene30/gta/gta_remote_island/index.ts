type Grid = number[][];

interface Point { x: number; y: number; }

const BEACH = 3;
const ISLAND_PLAIN = 4;
const ISLAND_FOREST = 5;
const ISLAND_CORE = 417;
const ISLAND_RESIDENTIAL = 418;
const ISLAND_HARBOR = 419;
const MAIN_ROAD = 300;
const LOCAL_ROAD = 301;
const DIR4 = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;

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

const fade = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const xf = x - x0;
  const yf = y - y0;
  const v00 = hash2(x0, y0, seed);
  const v10 = hash2(x0 + 1, y0, seed);
  const v01 = hash2(x0, y0 + 1, seed);
  const v11 = hash2(x0 + 1, y0 + 1, seed);
  return lerp(lerp(v00, v10, fade(xf)), lerp(v01, v11, fade(xf)), fade(yf));
}

function distanceToMask(mask: Grid): Grid {
  const rows = mask.length;
  const cols = mask[0]?.length ?? 0;
  const dist = makeGrid(rows, cols, Infinity);
  const queue: Point[] = [];
  let head = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!mask[y]?.[x]) continue;
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

function combinedMask(landGrid: Grid, avoidMask: Grid | null): Grid {
  const rows = landGrid.length;
  const cols = landGrid[0]?.length ?? 0;
  const out = makeGrid(rows, cols, 0);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (landGrid[y]?.[x] || (avoidMask && avoidMask[y]?.[x])) out[y][x] = 1;
    }
  }
  return out;
}

function pickRemoteOcean(landGrid: Grid, avoidMask: Grid | null, radius: number, seed: number): Point {
  const rows = landGrid.length;
  const cols = landGrid[0]?.length ?? 0;
  const dist = distanceToMask(combinedMask(landGrid, avoidMask));
  const margin = Math.ceil(radius * 1.35);
  let best: Point = { x: Math.round(cols * 0.5), y: Math.round(rows * 0.5) };
  let bestScore = -Infinity;
  const stride = Math.max(4, Math.round(radius / 6));
  for (let y = margin; y < rows - margin; y += stride) {
    for (let x = margin; x < cols - margin; x += stride) {
      if (landGrid[y]?.[x] || (avoidMask && avoidMask[y]?.[x])) continue;
      const d = dist[y]?.[x] ?? 0;
      if (d < radius * 1.25) continue;
      const edgePenalty = Math.max(0, margin * 1.15 - Math.min(x, y, cols - 1 - x, rows - 1 - y));
      const score = d - edgePenalty * 1.8 + hash2(x, y, seed) * radius * 0.35;
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  return best;
}

function islandRadiusAt(angle: number, radius: number, seed: number): number {
  const wave = Math.sin(angle * 3.1 + seed * 0.001) * 0.08 + Math.sin(angle * 5.3 + seed * 0.003) * 0.07;
  const n = valueNoise(Math.cos(angle) * 1.7 + 4, Math.sin(angle) * 1.7 + 4, seed) - 0.5;
  return radius * (0.88 + wave + n * 0.28);
}

function buildIslandLand(rows: number, cols: number, center: Point, radius: number, seed: number): Grid {
  const land = makeGrid(rows, cols, 0);
  const maxR = Math.ceil(radius * 1.35);
  for (let y = Math.max(0, center.y - maxR); y <= Math.min(rows - 1, center.y + maxR); y++) {
    for (let x = Math.max(0, center.x - maxR); x <= Math.min(cols - 1, center.x + maxR); x++) {
      const dx = x - center.x;
      const dy = y - center.y;
      const angle = Math.atan2(dy, dx);
      const d = Math.hypot(dx, dy);
      if (d <= islandRadiusAt(angle, radius, seed)) land[y][x] = 1;
    }
  }
  return land;
}

function distanceFromWater(islandLand: Grid): Grid {
  const rows = islandLand.length;
  const cols = islandLand[0]?.length ?? 0;
  const dist = makeGrid(rows, cols, Infinity);
  const queue: Point[] = [];
  let head = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!islandLand[y]?.[x]) continue;
      let edge = false;
      for (const [dx, dy] of DIR4) if (!islandLand[y + dy]?.[x + dx]) edge = true;
      if (edge) {
        dist[y][x] = 0;
        queue.push({ x, y });
      }
    }
  }
  while (head < queue.length) {
    const p = queue[head++];
    for (const [dx, dy] of DIR4) {
      const nx = p.x + dx;
      const ny = p.y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !islandLand[ny]?.[nx] || dist[ny][nx] <= dist[p.y][p.x] + 1) continue;
      dist[ny][nx] = dist[p.y][p.x] + 1;
      queue.push({ x: nx, y: ny });
    }
  }
  return dist;
}

function buildZones(islandLand: Grid, center: Point, radius: number, districtCount: number, seed: number): Grid {
  const rows = islandLand.length;
  const cols = islandLand[0]?.length ?? 0;
  const zone = makeGrid(rows, cols, 0);
  const coastDist = distanceFromWater(islandLand);
  const anchors: Array<{ x: number; y: number; value: number }> = [
    { x: center.x, y: center.y, value: ISLAND_CORE },
  ];
  for (let i = 0; i < districtCount - 1; i++) {
    const angle = (i / Math.max(1, districtCount - 1)) * Math.PI * 2 + hash2(i, seed, seed) * 0.55;
    const r = radius * (0.28 + hash2(i, seed + 31, seed) * 0.38);
    anchors.push({
      x: center.x + Math.cos(angle) * r,
      y: center.y + Math.sin(angle) * r,
      value: i === 0 ? ISLAND_HARBOR : i % 2 === 0 ? ISLAND_RESIDENTIAL : ISLAND_FOREST,
    });
  }
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!islandLand[y]?.[x]) continue;
      const d = coastDist[y]?.[x] ?? 0;
      if (d <= Math.max(3, radius * 0.12)) {
        zone[y][x] = BEACH;
        continue;
      }
      let best = anchors[0];
      let bestD = Infinity;
      for (const a of anchors) {
        const bias = a.value === ISLAND_HARBOR ? Math.max(0, d - radius * 0.23) * 1.6 : 0;
        const dd = Math.hypot(x - a.x, y - a.y) + bias;
        if (dd < bestD) {
          bestD = dd;
          best = a;
        }
      }
      zone[y][x] = best.value === ISLAND_FOREST ? ISLAND_FOREST : best.value;
    }
  }
  return zone;
}

function drawDisk(grid: Grid, mask: Grid, cx: number, cy: number, radius: number, value: number): void {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const r = Math.max(0, Math.round(radius));
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const x = Math.round(cx) + dx;
      const y = Math.round(cy) + dy;
      if (x < 0 || y < 0 || x >= cols || y >= rows || !mask[y]?.[x]) continue;
      grid[y][x] = value;
    }
  }
}

function drawLine(grid: Grid, mask: Grid, a: Point, b: Point, radius: number, value: number): void {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    drawDisk(grid, mask, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, radius, value);
  }
}

function boundaryPoint(islandLand: Grid, center: Point, angle: number): Point {
  const rows = islandLand.length;
  const cols = islandLand[0]?.length ?? 0;
  let last = center;
  for (let r = 1; r < Math.max(rows, cols); r++) {
    const x = Math.round(center.x + Math.cos(angle) * r);
    const y = Math.round(center.y + Math.sin(angle) * r);
    if (x < 0 || y < 0 || x >= cols || y >= rows || !islandLand[y]?.[x]) break;
    last = { x, y };
  }
  return last;
}

function buildRoads(islandLand: Grid, center: Point, radius: number, roadWidth: number, districtCount: number): Grid {
  const road = makeGrid(islandLand.length, islandLand[0]?.length ?? 0);
  const ringPoints: Point[] = [];
  const ringCount = 48;
  for (let i = 0; i <= ringCount; i++) {
    const angle = (i / ringCount) * Math.PI * 2;
    const p = {
      x: center.x + Math.cos(angle) * radius * 0.48,
      y: center.y + Math.sin(angle) * radius * 0.48,
    };
    ringPoints.push(p);
  }
  for (let i = 1; i < ringPoints.length; i++) drawLine(road, islandLand, ringPoints[i - 1], ringPoints[i], roadWidth, MAIN_ROAD);
  for (let i = 0; i < districtCount; i++) {
    const angle = (i / districtCount) * Math.PI * 2;
    const outer = boundaryPoint(islandLand, center, angle);
    const inner = {
      x: center.x + Math.cos(angle) * radius * 0.35,
      y: center.y + Math.sin(angle) * radius * 0.35,
    };
    drawLine(road, islandLand, inner, outer, Math.max(0, roadWidth - 1), i % 2 === 0 ? MAIN_ROAD : LOCAL_ROAD);
  }
  return road;
}

function overlay(base: Grid, layer: Grid): void {
  for (let y = 0; y < base.length; y++) {
    for (let x = 0; x < (base[0]?.length ?? 0); x++) {
      const v = layer[y]?.[x] ?? 0;
      if (v) base[y][x] = v;
    }
  }
}

export function gtaRemoteIsland(input: Record<string, unknown>): Record<string, unknown> {
  if (!isGrid(input.landGrid)) return { error: "landGrid is required" };
  const landGrid = input.landGrid as Grid;
  const avoidMask = isGrid(input.avoidMask) ? input.avoidMask as Grid : null;
  const rows = landGrid.length;
  const cols = landGrid[0]?.length ?? 0;
  const seed = resolveSeed(input.seed);
  const radius = clamp(int(input, "radius", 58), 18, 140);
  const roadWidth = clamp(int(input, "roadWidth", 1), 1, 5);
  const districtCount = clamp(int(input, "districtCount", 5), 3, 9);
  const center = pickRemoteOcean(landGrid, avoidMask, radius, seed);
  const islandLandGrid = buildIslandLand(rows, cols, center, radius, seed);
  const islandZoneGrid = buildZones(islandLandGrid, center, radius, districtCount, seed + 101);
  const islandRoadGrid = buildRoads(islandLandGrid, center, radius, roadWidth, districtCount);
  const islandGrid = islandZoneGrid.map(row => row.slice());
  overlay(islandGrid, islandRoadGrid);

  const used = new Set(islandGrid.flat().filter(v => v > 0));
  const names = [
    { id: BEACH, name: "海岛沙滩", type: "tile" },
    { id: ISLAND_PLAIN, name: "海岛平原", type: "tile" },
    { id: ISLAND_FOREST, name: "海岛树林", type: "tile" },
    { id: ISLAND_CORE, name: "海岛中心区", type: "tile" },
    { id: ISLAND_RESIDENTIAL, name: "海岛住宅区", type: "tile" },
    { id: ISLAND_HARBOR, name: "海岛小港区", type: "tile" },
    { id: MAIN_ROAD, name: "海岛主路", type: "tile" },
    { id: LOCAL_ROAD, name: "海岛小路", type: "tile" },
  ].filter(n => used.has(n.id));

  return {
    islandGrid,
    islandLandGrid,
    islandZoneGrid,
    islandRoadGrid,
    islandSite: { centerX: center.x, centerY: center.y, radius, districtCount },
    outputGrid: islandGrid,
    outputNameList: names,
  };
}
