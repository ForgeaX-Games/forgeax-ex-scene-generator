type Grid = number[][];

interface Point { x: number; y: number; }
interface Candidate extends Point {
  angle: number;
  score: number;
  length: number;
  width: number;
}

const AIRPORT_ZONE = 415;
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

function edgeDistance(mask: Grid): Grid {
  const rows = mask.length;
  const cols = mask[0]?.length ?? 0;
  const dist = makeGrid(rows, cols, Infinity);
  const queue: Point[] = [];
  let head = 0;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < rows && mask[y]?.[x] > 0;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!inside(x, y)) continue;
      let edge = x === 0 || y === 0 || x === cols - 1 || y === rows - 1;
      for (const [dx, dy] of DIR4) if (!inside(x + dx, y + dy)) edge = true;
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
      if (!inside(nx, ny) || dist[ny][nx] <= dist[p.y][p.x] + 1) continue;
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
  for (const [dx, dy] of DIR8) {
    if (landGrid[y + dy]?.[x + dx]) continue;
    sx += dx;
    sy += dy;
  }
  const len = Math.hypot(sx, sy);
  return len > 0 ? { x: sx / len, y: sy / len } : null;
}

function slopeAt(heightMap: Grid | null, landGrid: Grid, x: number, y: number): number {
  if (!heightMap) return 0;
  const rows = landGrid.length;
  const cols = landGrid[0]?.length ?? 0;
  const h = heightMap[y]?.[x] ?? 0.55;
  let maxSlope = 0;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !landGrid[ny]?.[nx]) continue;
    maxSlope = Math.max(maxSlope, Math.abs(h - (heightMap[ny]?.[nx] ?? h)));
  }
  return maxSlope;
}

function eachRotatedRectCell(
  rows: number,
  cols: number,
  center: Point,
  length: number,
  width: number,
  angle: number,
  visit: (x: number, y: number, u: number, v: number) => void,
): void {
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const halfL = length / 2;
  const halfW = width / 2;
  const r = Math.ceil(Math.hypot(halfL, halfW));
  const minX = Math.max(0, Math.floor(center.x - r));
  const maxX = Math.min(cols - 1, Math.ceil(center.x + r));
  const minY = Math.max(0, Math.floor(center.y - r));
  const maxY = Math.min(rows - 1, Math.ceil(center.y + r));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x - center.x;
      const dy = y - center.y;
      const u = dx * ca + dy * sa;
      const v = -dx * sa + dy * ca;
      if (Math.abs(u) <= halfL && Math.abs(v) <= halfW) visit(x, y, u, v);
    }
  }
}

function scoreCandidate(
  landGrid: Grid,
  heightMap: Grid | null,
  dist: Grid,
  center: Point,
  angle: number,
  length: number,
  width: number,
  edgeInset: number,
  seed: number,
): number {
  const rows = landGrid.length;
  const cols = landGrid[0]?.length ?? 0;
  let total = 0;
  let land = 0;
  let flat = 0;
  let edgeBand = 0;
  eachRotatedRectCell(rows, cols, center, length, width, angle, (x, y) => {
    total++;
    if (!landGrid[y]?.[x]) return;
    const h = heightMap ? (heightMap[y]?.[x] ?? 0.55) : 0.55;
    const slope = slopeAt(heightMap, landGrid, x, y);
    const d = dist[y]?.[x] ?? 9999;
    land++;
    flat += clamp(1 - slope / 0.12, 0, 1) * clamp(1 - Math.max(0, h - 0.72) / 0.25, 0, 1);
    edgeBand += 1 - clamp(Math.abs(d - edgeInset * 1.8) / Math.max(24, edgeInset * 2.5), 0, 1);
  });
  if (total === 0) return -Infinity;
  const coverage = land / total;
  if (coverage < 0.82) return -Infinity;
  const noise = hash2(Math.round(center.x), Math.round(center.y), seed) * 0.08;
  return coverage * 1.7 + (flat / Math.max(1, land)) * 1.2 + (edgeBand / Math.max(1, land)) * 0.9 + noise;
}

function pickCandidate(landGrid: Grid, heightMap: Grid | null, length: number, width: number, edgeInset: number, seed: number): Candidate | null {
  const rows = landGrid.length;
  const cols = landGrid[0]?.length ?? 0;
  const dist = edgeDistance(landGrid);
  const stride = Math.max(6, Math.round(Math.min(length, width) / 8));
  const angles = [0, Math.PI / 2, Math.PI * 0.1, -Math.PI * 0.1, Math.PI * 0.22, -Math.PI * 0.22];
  let best: Candidate | null = null;

  for (let y = Math.floor(stride / 2); y < rows; y += stride) {
    for (let x = Math.floor(stride / 2); x < cols; x += stride) {
      if (!landGrid[y]?.[x]) continue;
      const d = dist[y]?.[x] ?? 9999;
      if (d < edgeInset * 0.6 || d > edgeInset + Math.max(length, width) * 0.65) continue;
      for (const angle of angles) {
        const score = scoreCandidate(landGrid, heightMap, dist, { x, y }, angle, length, width, edgeInset, seed);
        if (!best || score > best.score) best = { x, y, angle, score, length, width };
      }
    }
  }
  return best;
}

function scoreCoastalSite(
  landGrid: Grid,
  heightMap: Grid | null,
  coast: Point,
  normal: Point,
  length: number,
  width: number,
  seed: number,
): Candidate | null {
  const rows = landGrid.length;
  const cols = landGrid[0]?.length ?? 0;
  const angle = Math.atan2(-normal.x, normal.y);
  const center = {
    x: coast.x + normal.x * width * 0.22,
    y: coast.y + normal.y * width * 0.22,
  };
  let total = 0;
  let land = 0;
  let flat = 0;
  let waterEdge = 0;
  eachRotatedRectCell(rows, cols, center, length, width, angle, (x, y) => {
    total++;
    const onLand = landGrid[y]?.[x] > 0;
    if (onLand) {
      land++;
      const h = heightMap ? (heightMap[y]?.[x] ?? 0.55) : 0.55;
      const slope = slopeAt(heightMap, landGrid, x, y);
      flat += clamp(1 - slope / 0.12, 0, 1) * clamp(1 - Math.max(0, h - 0.72) / 0.22, 0, 1);
    }
    const side = (x - coast.x) * normal.x + (y - coast.y) * normal.y;
    if (!onLand && side > -width * 0.2) waterEdge++;
  });
  if (total === 0) return null;
  const landRatio = land / total;
  const waterRatio = waterEdge / total;
  // A GTA-style airport should attach to the map outline/coast, not sit as a giant inland patch.
  if (landRatio < 0.22 || landRatio > 0.72 || waterRatio < 0.18) return null;
  const score = (1 - Math.abs(landRatio - 0.46)) * 1.2
    + waterRatio * 0.7
    + (flat / Math.max(1, land)) * 0.8
    + hash2(coast.x, coast.y, seed) * 0.08;
  return { ...center, angle, score, length, width };
}

function pickCoastalCandidate(landGrid: Grid, heightMap: Grid | null, length: number, width: number, seed: number): Candidate | null {
  const cells = coastCells(landGrid);
  const stride = Math.max(1, Math.floor(cells.length / 1400));
  let best: Candidate | null = null;
  for (let i = 0; i < cells.length; i += stride) {
    const coast = cells[i];
    const normal = waterNormal(landGrid, coast.x, coast.y);
    if (!normal) continue;
    const candidate = scoreCoastalSite(landGrid, heightMap, coast, normal, length, width, seed);
    if (candidate && (!best || candidate.score > best.score)) best = candidate;
  }
  return best;
}

function makeAirportGrids(rows: number, cols: number, site: Candidate): { mask: Grid; outline: Grid; zone: Grid } {
  const mask = makeGrid(rows, cols, 0);
  const zone = makeGrid(rows, cols, 0);
  eachRotatedRectCell(rows, cols, site, site.length, site.width, site.angle, (x, y, u, v) => {
    const feather = Math.min(site.length, site.width) * 0.08;
    const rounded = Math.abs(u) <= site.length / 2 - feather || Math.abs(v) <= site.width / 2 - feather;
    if (!rounded) {
      const du = Math.max(0, Math.abs(u) - (site.length / 2 - feather));
      const dv = Math.max(0, Math.abs(v) - (site.width / 2 - feather));
      if (du * du + dv * dv > feather * feather) return;
    }
    mask[y][x] = 1;
    zone[y][x] = AIRPORT_ZONE;
  });

  const outline = makeGrid(rows, cols, 0);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!mask[y][x]) continue;
      for (const [dx, dy] of DIR8) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !mask[ny]?.[nx]) {
          outline[y][x] = AIRPORT_ZONE;
          break;
        }
      }
    }
  }
  return { mask, outline, zone };
}

export function gtaAirportOutline(input: Record<string, unknown>): Record<string, unknown> {
  if (!isGrid(input.landGrid)) return { error: "landGrid is required" };
  const landGrid = input.landGrid as Grid;
  const heightMap = isGrid(input.heightMap) ? input.heightMap as Grid : null;
  const rows = landGrid.length;
  const cols = landGrid[0]?.length ?? 0;
  const seed = resolveSeed(input.seed);
  const siteLength = clamp(int(input, "siteLength", 96), 40, 220);
  const siteWidth = clamp(int(input, "siteWidth", 38), 16, 96);
  const edgeInset = clamp(int(input, "edgeInset", 18), 0, 120);
  const candidate = pickCoastalCandidate(landGrid, heightMap, siteLength, siteWidth, seed)
    ?? pickCandidate(landGrid, heightMap, siteLength, siteWidth, edgeInset, seed)
    ?? { x: cols * 0.78, y: rows * 0.78, angle: 0, score: 0, length: siteLength, width: siteWidth };
  const { mask, outline, zone } = makeAirportGrids(rows, cols, candidate);

  return {
    airportMask: mask,
    airportOutlineGrid: outline,
    airportZoneGrid: zone,
    airportSite: {
      centerX: candidate.x,
      centerY: candidate.y,
      angle: candidate.angle,
      length: candidate.length,
      width: candidate.width,
      score: candidate.score,
    },
    outputGrid: zone,
    outputNameList: [{ id: AIRPORT_ZONE, name: "机场用地", type: "tile" }],
  };
}
