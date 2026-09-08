type Grid = number[][];
interface NameEntry { id: number; name: string; type?: string; }

// ── Zone IDs (from gta_zones) ────────────────────────────────────────
const COMMERCIAL = 421;
const RESIDENTIAL = 422;
const INDUSTRIAL = 423;
const PARK = 424;
const GREENING = 425;
const SUBURB = 427;

// ── Building IDs ─────────────────────────────────────────────────────
const B_COMMERCIAL = 500;
const B_RESIDENTIAL = 501;
const B_INDUSTRIAL = 502;
const B_SUBURB = 503;
const B_PARK = 504;

const NAMES: NameEntry[] = [
  { id: B_COMMERCIAL, name: "商业楼", type: "tile" },
  { id: B_RESIDENTIAL, name: "住宅楼", type: "tile" },
  { id: B_INDUSTRIAL, name: "工业厂房", type: "tile" },
  { id: B_SUBURB, name: "郊区小屋", type: "tile" },
  { id: B_PARK, name: "公园小筑", type: "tile" },
];

// ── Zone building specs ──────────────────────────────────────────────
interface ZoneSpec {
  value: number;
  minW: number; maxW: number;
  minH: number; maxH: number;
  step: number;       // scan grid step
  prob: number;       // base placement probability
  gap: number;        // min gap between buildings
  lShapeProb: number; // chance of L-shape
  clusterSize: number; // how many buildings per cluster attempt
}

function specForZone(zone: number): ZoneSpec | null {
  switch (zone) {
    case COMMERCIAL:  return { value: B_COMMERCIAL, minW: 4, maxW: 11, minH: 4, maxH: 11, step: 10, prob: 0.94, gap: 1, lShapeProb: 0.25, clusterSize: 5 };
    case RESIDENTIAL: return { value: B_RESIDENTIAL, minW: 5, maxW: 13, minH: 5, maxH: 13, step: 14, prob: 0.78, gap: 2, lShapeProb: 0.15, clusterSize: 3 };
    case INDUSTRIAL:  return { value: B_INDUSTRIAL, minW: 12, maxW: 30, minH: 8, maxH: 22, step: 28, prob: 0.72, gap: 4, lShapeProb: 0.30, clusterSize: 2 };
    case SUBURB:      return { value: B_SUBURB, minW: 3, maxW: 8, minH: 3, maxH: 8, step: 22, prob: 0.32, gap: 5, lShapeProb: 0.08, clusterSize: 1 };
    case PARK:        return { value: B_PARK, minW: 3, maxW: 6, minH: 3, maxH: 5, step: 60, prob: 0.08, gap: 12, lShapeProb: 0.0, clusterSize: 1 };
    default: return null;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────
function isGrid(v: unknown): v is Grid {
  return Array.isArray(v) && v.length > 0 && Array.isArray(v[0])
    && ((v[0] as unknown[]).length === 0 || typeof (v[0] as unknown[])[0] === "number");
}

function makeGrid(rows: number, cols: number, fill = 0): Grid {
  return Array.from({ length: rows }, () => new Array(cols).fill(fill));
}

function hash2(x: number, y: number, seed: number): number {
  let h = (seed | 0) ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function resolveSeed(seed: unknown): number {
  const raw = typeof seed === "number" && Number.isFinite(seed) ? seed : 0;
  return raw === 0 ? 123456789 : raw >>> 0;
}

const DIR4: ReadonlyArray<[number, number]> = [[-1, 0], [1, 0], [0, -1], [0, 1]];

// ── Merge road grids ─────────────────────────────────────────────────
function mergeRoads(rows: number, cols: number, ...grids: (Grid | null)[]): Grid {
  const merged = makeGrid(rows, cols, 0);
  for (const g of grids) {
    if (!g) continue;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++)
        if ((g[y]?.[x] ?? 0) >= 300 && merged[y][x] === 0)
          merged[y][x] = g[y][x];
  }
  return merged;
}

// ── BFS distance + nearest road source tracking ──────────────────────
interface DistResult {
  dist: Grid;
  nearestX: Int16Array;
  nearestY: Int16Array;
}

function roadDistanceField(roadMask: Grid, rows: number, cols: number, maxDist: number): DistResult {
  const dist = makeGrid(rows, cols, maxDist + 1);
  const nearestX = new Int16Array(rows * cols).fill(-1);
  const nearestY = new Int16Array(rows * cols).fill(-1);
  const queue: number[] = [];
  let head = 0;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if ((roadMask[y]?.[x] ?? 0) >= 300) {
        dist[y][x] = 0;
        const idx = y * cols + x;
        nearestX[idx] = x;
        nearestY[idx] = y;
        queue.push(idx);
      }
    }
  }

  while (head < queue.length) {
    const idx = queue[head++];
    const cx = idx % cols;
    const cy = (idx - cx) / cols;
    const nd = dist[cy][cx] + 1;
    if (nd > maxDist) continue;
    for (const [dx, dy] of DIR4) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      if (dist[ny][nx] <= nd) continue;
      dist[ny][nx] = nd;
      const ni = ny * cols + nx;
      nearestX[ni] = nearestX[idx];
      nearestY[ni] = nearestY[idx];
      queue.push(ni);
    }
  }
  return { dist, nearestX, nearestY };
}

// ── Road direction field ─────────────────────────────────────────────
// For each pixel, compute the local road direction (angle in radians)
// by looking at the nearest road pixel's neighborhood along the road.
function roadAngleField(roadMask: Grid, distResult: DistResult, rows: number, cols: number): Float32Array {
  const angles = new Float32Array(rows * cols);
  const { nearestX, nearestY } = distResult;

  // Precompute road direction at road pixels using local gradient
  const roadAngleAt = new Float32Array(rows * cols);
  const computed = new Uint8Array(rows * cols);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if ((roadMask[y]?.[x] ?? 0) < 300) continue;
      const idx = y * cols + x;
      // Gather nearby road pixels to estimate direction
      let sumDx = 0, sumDy = 0;
      const r = 4;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          if ((roadMask[ny]?.[nx] ?? 0) >= 300) {
            sumDx += dx;
            sumDy += dy;
          }
        }
      }
      roadAngleAt[idx] = Math.atan2(sumDy, sumDx);
      computed[idx] = 1;
    }
  }

  // Propagate: each non-road pixel gets the angle from its nearest road pixel
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const idx = y * cols + x;
      const rx = nearestX[idx];
      const ry = nearestY[idx];
      if (rx >= 0 && ry >= 0 && computed[ry * cols + rx]) {
        angles[idx] = roadAngleAt[ry * cols + rx];
      }
    }
  }
  return angles;
}

// ── Coast distance (distance from land edge) ─────────────────────────
function coastDistance(landGrid: Grid | null, rows: number, cols: number, maxDist: number): Grid {
  if (!landGrid) return makeGrid(rows, cols, maxDist);
  const dist = makeGrid(rows, cols, maxDist);
  const queue: number[] = [];
  let head = 0;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!landGrid[y]?.[x]) continue;
      let isEdge = y === 0 || x === 0 || y === rows - 1 || x === cols - 1;
      if (!isEdge) {
        for (const [dx, dy] of DIR4) {
          if (!(landGrid[y + dy]?.[x + dx])) { isEdge = true; break; }
        }
      }
      if (isEdge) {
        dist[y][x] = 0;
        queue.push(y * cols + x);
      }
    }
  }

  while (head < queue.length) {
    const idx = queue[head++];
    const cx = idx % cols;
    const cy = (idx - cx) / cols;
    const nd = dist[cy][cx] + 1;
    if (nd >= maxDist) continue;
    for (const [dx, dy] of DIR4) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      if (!landGrid[ny]?.[nx] || dist[ny][nx] <= nd) continue;
      dist[ny][nx] = nd;
      queue.push(ny * cols + nx);
    }
  }
  return dist;
}

// ── Rotated rectangle rasterization ──────────────────────────────────
// Returns list of [x, y] pixels that form a rotated rectangle centered at (cx,cy)
function rotatedRectPixels(
  cx: number, cy: number, halfW: number, halfH: number, angle: number,
  rows: number, cols: number,
): Array<[number, number]> {
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const maxR = Math.ceil(Math.sqrt(halfW * halfW + halfH * halfH)) + 1;
  const pixels: Array<[number, number]> = [];
  const x0 = Math.max(0, Math.floor(cx - maxR));
  const y0 = Math.max(0, Math.floor(cy - maxR));
  const x1 = Math.min(cols - 1, Math.ceil(cx + maxR));
  const y1 = Math.min(rows - 1, Math.ceil(cy + maxR));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const lx = Math.abs(dx * cosA + dy * sinA);
      const ly = Math.abs(-dx * sinA + dy * cosA);
      if (lx <= halfW && ly <= halfH) {
        pixels.push([x, y]);
      }
    }
  }
  return pixels;
}

// ── Check if all pixels can be placed ────────────────────────────────
function canPlacePixels(
  pixels: Array<[number, number]>,
  buildingGrid: Grid,
  zoneGrid: Grid,
  roadDist: Grid,
  zone: number,
  setback: number,
  buildable: Grid | null,
): boolean {
  if (pixels.length === 0) return false;
  for (const [x, y] of pixels) {
    if (buildingGrid[y][x] !== 0) return false;
    if (roadDist[y][x] < setback) return false;
    const z = zoneGrid[y]?.[x] ?? 0;
    // Allow placing in the target zone; for park buildings, allow park zone
    if (z !== zone) return false;
    if (buildable && !buildable[y]?.[x] && zone !== PARK) return false;
  }
  return true;
}

function stampPixels(grid: Grid, pixels: Array<[number, number]>, value: number): void {
  for (const [x, y] of pixels) grid[y][x] = value;
}

// ── L-shape building: two joined rotated rectangles ──────────────────
function lShapePixels(
  cx: number, cy: number,
  w1: number, h1: number,
  w2: number, h2: number,
  angle: number,
  rows: number, cols: number,
): Array<[number, number]> {
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);

  // Main body centered at (cx, cy)
  const mainPixels = rotatedRectPixels(cx, cy, w1 / 2, h1 / 2, angle, rows, cols);

  // Wing: offset along the local X axis, at one end of the main body
  const offsetX = (w1 / 2 - w2 / 2) * cosA - (h1 / 2 - h2 / 2) * sinA;
  const offsetY = (w1 / 2 - w2 / 2) * sinA + (h1 / 2 - h2 / 2) * cosA;
  const wingPixels = rotatedRectPixels(
    cx + offsetX, cy + offsetY,
    w2 / 2, h2 / 2, angle, rows, cols,
  );

  // Merge unique pixels
  const set = new Set<number>();
  const result: Array<[number, number]> = [];
  for (const p of mainPixels) {
    const key = p[1] * cols + p[0];
    if (!set.has(key)) { set.add(key); result.push(p); }
  }
  for (const p of wingPixels) {
    const key = p[1] * cols + p[0];
    if (!set.has(key)) { set.add(key); result.push(p); }
  }
  return result;
}

// ── Main function ────────────────────────────────────────────────────
export function gtaBuildings(input: Record<string, unknown>): Record<string, unknown> {
  if (!isGrid(input.zoneGrid)) return { error: "zoneGrid is required" };
  const zoneGrid = input.zoneGrid as Grid;
  const rows = zoneGrid.length;
  const cols = zoneGrid[0]?.length ?? 0;
  const seed = resolveSeed(input.seed);
  const density = clamp(typeof input.density === "number" ? input.density : 0.7, 0.1, 1);
  const setback = clamp(Math.round(typeof input.roadSetback === "number" ? input.roadSetback : 2), 1, 6);

  const mainRoad = isGrid(input.mainRoadGrid) ? input.mainRoadGrid as Grid : null;
  const coastalRoad = isGrid(input.coastalRoadGrid) ? input.coastalRoadGrid as Grid : null;
  const trimRoad = isGrid(input.trimRoadGrid) ? input.trimRoadGrid as Grid : null;
  const buildable = isGrid(input.buildableMask) ? input.buildableMask as Grid : null;
  const landGrid = isGrid(input.landGrid) ? input.landGrid as Grid : null;

  // Step 1: Merge all roads
  const roadMerged = mergeRoads(rows, cols, mainRoad, coastalRoad, trimRoad);

  // Step 2: Compute distance + direction fields
  const maxDistField = Math.max(40, Math.round(Math.min(rows, cols) / 10));
  const distResult = roadDistanceField(roadMerged, rows, cols, maxDistField);
  const angleField = roadAngleField(roadMerged, distResult, rows, cols);
  const coastDist = coastDistance(landGrid, rows, cols, 60);

  const buildingGrid = makeGrid(rows, cols, 0);

  // Step 3: Place buildings per zone
  const ZONES = [COMMERCIAL, RESIDENTIAL, INDUSTRIAL, SUBURB, PARK];

  for (const zone of ZONES) {
    const spec = specForZone(zone);
    if (!spec) continue;

    const effectiveStep = Math.max(4, Math.round(spec.step * (1.15 - density * 0.15)));

    for (let gy = 0; gy < rows; gy += effectiveStep) {
      for (let gx = 0; gx < cols; gx += effectiveStep) {
        // Jitter the scan point
        const jx = gx + Math.floor(hash2(gx, gy, seed + zone * 7 + 1) * effectiveStep * 0.7);
        const jy = gy + Math.floor(hash2(gx, gy, seed + zone * 7 + 2) * effectiveStep * 0.7);
        if (jx >= cols || jy >= rows) continue;
        if (zoneGrid[jy]?.[jx] !== zone) continue;
        if (buildable && !buildable[jy]?.[jx] && zone !== PARK) continue;

        // Coast proximity penalty: reduce probability near coast
        const cDist = coastDist[jy]?.[jx] ?? 60;
        const coastFactor = clamp(cDist / 25, 0.08, 1.0);

        // Road proximity bonus: slightly prefer near roads (but not too close)
        const rDist = distResult.dist[jy]?.[jx] ?? maxDistField;
        const roadBonus = rDist <= setback ? 0 : (rDist < 20 ? 1.0 : 0.7);

        const effectiveProb = spec.prob * density * coastFactor * roadBonus;
        if (hash2(gx, gy, seed + zone * 13) > effectiveProb) continue;

        // Place a cluster of buildings
        const clusterCount = spec.clusterSize;
        let cx = jx, cy = jy;

        for (let ci = 0; ci < clusterCount; ci++) {
          if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) break;
          if (zoneGrid[cy]?.[cx] !== zone) break;
          if (buildingGrid[cy]?.[cx] !== 0) break;

          // Building size with some randomness
          const rw = hash2(cx + 31, cy + 53, seed + zone * 17 + ci * 97);
          const rh = hash2(cx + 67, cy + 89, seed + zone * 19 + ci * 113);
          const bw = Math.round(spec.minW + (spec.maxW - spec.minW) * rw);
          const bh = Math.round(spec.minH + (spec.maxH - spec.minH) * rh);

          // Angle from road direction field + small jitter
          const idx = cy * cols + cx;
          let angle = angleField[idx];
          // Snap to perpendicular or parallel to road
          const snapChoice = hash2(cx + 3, cy + 7, seed + ci * 31);
          if (snapChoice > 0.5) angle += Math.PI / 2;
          // Small angular jitter for organic feel
          angle += (hash2(cx + 41, cy + 59, seed + ci * 53) - 0.5) * 0.2;

          // Decide shape: rectangle or L-shape
          const doLShape = hash2(cx + 101, cy + 103, seed + ci * 67) < spec.lShapeProb;

          let pixels: Array<[number, number]>;
          if (doLShape && bw >= 6 && bh >= 6) {
            const w2 = Math.round(bw * (0.4 + hash2(cx + 111, cy + 113, seed + ci * 71) * 0.3));
            const h2 = Math.round(bh * (0.4 + hash2(cx + 121, cy + 123, seed + ci * 73) * 0.3));
            pixels = lShapePixels(cx, cy, bw, bh, w2, h2, angle, rows, cols);
          } else {
            pixels = rotatedRectPixels(cx, cy, bw / 2, bh / 2, angle, rows, cols);
          }

          if (canPlacePixels(pixels, buildingGrid, zoneGrid, distResult.dist, zone, setback, buildable)) {
            stampPixels(buildingGrid, pixels, spec.value);
          }

          // Next cluster member: offset along road direction
          const stepDist = bw + spec.gap + Math.round(hash2(cx + 201, cy + 203, seed + ci * 79) * 4);
          cx += Math.round(Math.cos(angle) * stepDist);
          cy += Math.round(Math.sin(angle) * stepDist);
        }
      }
    }
  }

  const used = new Set(buildingGrid.flat().filter(v => v !== 0));
  return {
    buildingGrid,
    outputGrid: buildingGrid,
    outputNameList: NAMES.filter(n => used.has(n.id)),
  };
}
