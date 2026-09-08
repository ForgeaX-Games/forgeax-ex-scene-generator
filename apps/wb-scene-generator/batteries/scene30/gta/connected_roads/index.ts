type Grid = number[][];

interface NameEntry {
  id: number;
  name: string;
  type?: string;
}

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

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  if (state === 0) state = 0x6d2b79f5;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function hash2(x: number, y: number, seed: number): number {
  let h = (seed | 0) ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const xf = x - x0, yf = y - y0;
  const u = fade(xf), v = fade(yf);
  return lerp(
    lerp(hash2(x0, y0, seed), hash2(x0 + 1, y0, seed), u),
    lerp(hash2(x0, y0 + 1, seed), hash2(x0 + 1, y0 + 1, seed), u),
    v
  );
}

interface SeedPoint { x: number; y: number; }
interface LandComponent { cells: number[]; area: number; }
interface QueueNode { idx: number; countryId: number; cost: number; seedIdx: number; }

const DIR4: Array<[number, number]> = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIR8: Array<[number, number]> = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
  [-1, -1], [1, -1], [-1, 1], [1, 1],
];

// ── MinHeap（Dijkstra 用）──────────────────────────────────────────────────
class MinHeap {
  private data: QueueNode[] = [];
  get length(): number { return this.data.length; }

  push(node: QueueNode): void {
    this.data.push(node);
    this.bubbleUp(this.data.length - 1);
  }

  pop(): QueueNode | undefined {
    const first = this.data[0];
    const last  = this.data.pop();
    if (!last || this.data.length === 0) return first;
    this.data[0] = last;
    this.sinkDown(0);
    return first;
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const p = Math.floor((i - 1) / 2);
      if (this.data[p].cost <= this.data[i].cost) break;
      [this.data[p], this.data[i]] = [this.data[i], this.data[p]];
      i = p;
    }
  }

  private sinkDown(i: number): void {
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let best = i;
      if (l < this.data.length && this.data[l].cost < this.data[best].cost) best = l;
      if (r < this.data.length && this.data[r].cost < this.data[best].cost) best = r;
      if (best === i) break;
      [this.data[best], this.data[i]] = [this.data[i], this.data[best]];
      i = best;
    }
  }
}

// ── 连通分量（来自 worldmap_countries）────────────────────────────────────
function findLandComponents(landGrid: Grid): LandComponent[] {
  const rows = landGrid.length, cols = landGrid[0]?.length ?? 0;
  const seen = new Uint8Array(rows * cols);
  const components: LandComponent[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const start = y * cols + x;
      if (seen[start] || !landGrid[y][x]) continue;
      const cells: number[] = [];
      const queue = [start]; seen[start] = 1; let head = 0;
      while (head < queue.length) {
        const idx = queue[head++]; cells.push(idx);
        const cx = idx % cols, cy = Math.floor(idx / cols);
        for (const [dx, dy] of DIR4) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const ni = ny * cols + nx;
          if (seen[ni] || !landGrid[ny][nx]) continue;
          seen[ni] = 1; queue.push(ni);
        }
      }
      components.push({ cells, area: cells.length });
    }
  }
  return components.sort((a, b) => b.area - a.area);
}

function allocateSeedCounts(components: LandComponent[], totalCount: number, minArea: number): number[] {
  const totalArea = components.reduce((s, c) => s + c.area, 0);
  const counts = components.map(c => {
    const p = Math.round((c.area / Math.max(1, totalArea)) * totalCount);
    const cap = Math.max(1, Math.floor(c.area / Math.max(1, minArea)));
    return Math.max(1, Math.min(cap, p || 1));
  });
  while (counts.reduce((a, b) => a + b, 0) > totalCount) {
    let best = -1;
    for (let i = 0; i < counts.length; i++) {
      if (counts[i] <= 1) continue;
      if (best < 0 || components[i].area / counts[i] < components[best].area / counts[best]) best = i;
    }
    if (best < 0) break; counts[best]--;
  }
  while (counts.reduce((a, b) => a + b, 0) < totalCount) {
    let best = -1;
    for (let i = 0; i < counts.length; i++) {
      const cap = Math.max(1, Math.floor(components[i].area / Math.max(1, minArea)));
      if (counts[i] >= cap) continue;
      if (best < 0 || components[i].area / counts[i] > components[best].area / counts[best]) best = i;
    }
    if (best < 0) break; counts[best]++;
  }
  return counts;
}

function terrainScore(idx: number, cols: number, heightMap: Grid | null): number {
  if (!heightMap) return 1;
  const h = heightMap[Math.floor(idx / cols)]?.[idx % cols] ?? 0.55;
  return clamp(1 - Math.abs(h - 0.58) * 1.6, 0.25, 1);
}

function pickSeedsForComponent(
  component: LandComponent, count: number, cols: number,
  seed: number, rng: () => number, heightMap: Grid | null
): SeedPoint[] {
  const seeds: SeedPoint[] = [];
  if (!component.cells.length || count <= 0) return seeds;
  const firstIdx = component.cells[Math.floor(rng() * component.cells.length)];
  seeds.push({ x: firstIdx % cols, y: Math.floor(firstIdx / cols) });
  while (seeds.length < count) {
    let bestIdx = component.cells[0], bestScore = -Infinity;
    for (const idx of component.cells) {
      const x = idx % cols, y = Math.floor(idx / cols);
      let minD2 = Infinity;
      for (const s of seeds) {
        const d2 = (x - s.x) ** 2 + (y - s.y) ** 2;
        if (d2 < minD2) minD2 = d2;
      }
      const score = minD2 * terrainScore(idx, cols, heightMap)
        * (0.92 + valueNoise(x * 0.07, y * 0.07, seed + 3001) * 0.16);
      if (score > bestScore) { bestScore = score; bestIdx = idx; }
    }
    seeds.push({ x: bestIdx % cols, y: Math.floor(bestIdx / cols) });
  }
  return seeds;
}

function growZones(
  landGrid: Grid, heightMap: Grid | null,
  seeds: SeedPoint[], seed: number, warp: number
): Grid {
  const rows = landGrid.length, cols = landGrid[0]?.length ?? 0;
  const out  = makeGrid(rows, cols, 0);
  const heap = new MinHeap();
  const bias = seeds.map((s, i) => 0.9 + valueNoise(s.x * 0.05, s.y * 0.05, seed + i * 97) * 0.22);
  seeds.forEach((s, i) => {
    const x = clamp(Math.round(s.x), 0, cols - 1), y = clamp(Math.round(s.y), 0, rows - 1);
    if (landGrid[y]?.[x]) heap.push({ idx: y * cols + x, countryId: i + 1, cost: 0, seedIdx: i });
  });
  while (heap.length > 0) {
    const cur = heap.pop(); if (!cur) break;
    const x = cur.idx % cols, y = Math.floor(cur.idx / cols);
    if (!landGrid[y]?.[x] || out[y][x] !== 0) continue;
    out[y][x] = cur.countryId;
    for (const [dx, dy] of DIR4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !landGrid[ny][nx] || out[ny][nx]) continue;
      const h0 = heightMap ? (heightMap[y]?.[x] ?? 0.5) : 0.5;
      const h1 = heightMap ? (heightMap[ny]?.[nx] ?? h0) : h0;
      const hp  = heightMap ? Math.abs(h1 - h0) * 9 + Math.max(0, h1 - 0.78) * 1.8 : 0;
      const np  = valueNoise(nx * 0.08, ny * 0.08, seed + cur.countryId * 131) * warp * 8;
      heap.push({ idx: ny * cols + nx, countryId: cur.countryId, seedIdx: cur.seedIdx,
        cost: cur.cost + (1 + hp + np) * bias[cur.seedIdx] });
    }
  }
  return out;
}

function smoothRegions(zoneGrid: Grid, landGrid: Grid, iterations: number): Grid {
  const rows = zoneGrid.length, cols = zoneGrid[0]?.length ?? 0;
  let grid = zoneGrid.map(r => r.slice());
  for (let it = 0; it < iterations; it++) {
    const next = grid.map(r => r.slice());
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (!landGrid[y]?.[x]) continue;
        const counts = new Map<number, number>();
        for (const [dx, dy] of DIR8) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !landGrid[ny][nx]) continue;
          const v = grid[ny][nx];
          if (v > 0) counts.set(v, (counts.get(v) ?? 0) + 1);
        }
        let best = grid[y][x], bestCnt = 0;
        for (const [id, cnt] of counts) if (cnt > bestCnt) { best = id; bestCnt = cnt; }
        if (best !== grid[y][x] && bestCnt >= 5) next[y][x] = best;
      }
    }
    grid = next;
  }
  return grid;
}

function cleanupTinyPatches(zoneGrid: Grid, landGrid: Grid, minPatchArea: number): Grid {
  if (minPatchArea <= 0) return zoneGrid;
  const rows = zoneGrid.length, cols = zoneGrid[0]?.length ?? 0;
  const grid = zoneGrid.map(r => r.slice());
  const seen = new Uint8Array(rows * cols);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const start = y * cols + x, id = grid[y][x];
      if (seen[start] || !landGrid[y]?.[x] || id <= 0) continue;
      const cells: number[] = [], borders = new Map<number, number>();
      const queue = [start]; seen[start] = 1; let head = 0;
      while (head < queue.length) {
        const idx = queue[head++]; cells.push(idx);
        const cx = idx % cols, cy = Math.floor(idx / cols);
        for (const [dx, dy] of DIR4) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !landGrid[ny]?.[nx]) continue;
          const ni = ny * cols + nx, nv = grid[ny][nx];
          if (nv === id && !seen[ni]) { seen[ni] = 1; queue.push(ni); }
          else if (nv !== id && nv > 0) borders.set(nv, (borders.get(nv) ?? 0) + 1);
        }
      }
      if (cells.length >= minPatchArea || !borders.size) continue;
      let target = id, best = -1;
      for (const [nid, cnt] of borders) if (cnt > best) { best = cnt; target = nid; }
      for (const idx of cells) grid[Math.floor(idx / cols)][idx % cols] = target;
    }
  }
  return grid;
}

// ── 内部边界提取（不含海岸线）────────────────────────────────────────────
function extractInternalBorders(zoneGrid: Grid, landGrid: Grid): Grid {
  const rows = zoneGrid.length, cols = zoneGrid[0]?.length ?? 0;
  const out = makeGrid(rows, cols, 0);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const v = zoneGrid[y][x];
      if (v <= 0) continue;
      for (const [dx, dy] of DIR4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const w = zoneGrid[ny][nx];
        // 仅标记两侧均为陆地但属于不同区域的边界（排除海岸）
        if (w > 0 && w !== v) { out[y][x] = 1; break; }
      }
    }
  }
  return out;
}

// ── 圆形膨胀（roadWidth px）──────────────────────────────────────────────
function dilate(grid: Grid, landGrid: Grid, radius: number): Grid {
  if (radius <= 0) return grid.map(r => r.slice());
  const rows = grid.length, cols = grid[0]?.length ?? 0;
  const out = makeGrid(rows, cols, 0);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!grid[y][x]) continue;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > radius * radius) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          if (landGrid[ny][nx]) out[ny][nx] = 1;
        }
      }
    }
  }
  return out;
}

// ── 主函数 ────────────────────────────────────────────────────────────────
export function connectedRoads(input: Record<string, unknown>): Record<string, unknown> {
  if (!isGrid(input.landGrid)) return { error: "landGrid is required" };
  const landGrid   = input.landGrid as Grid;
  const heightMap  = isGrid(input.heightMap) ? input.heightMap as Grid : null;
  const rows = landGrid.length, cols = landGrid[0]?.length ?? 0;
  const seed        = resolveSeed(input.seed);
  const rng         = makeRng(seed);
  const zoneCount   = clamp(int(input, "countryCount", 20), 2, 120);
  const roadWidth   = clamp(int(input, "roadWidth", 1), 1, 9);
  const warp        = clamp(num(input, "warp", 0.06), 0, 0.3);
  const relax       = clamp(int(input, "relax", 2), 0, 5);
  const minPatch    = clamp(int(input, "minPatchArea", 48), 0, 500);
  const dilRadius   = Math.floor((roadWidth - 1) / 2);

  const components = findLandComponents(landGrid);
  if (!components.length) {
    const empty = makeGrid(rows, cols, 0);
    return { roadGrid: empty, zoneGrid: empty, outputNameList: [] };
  }

  const totalLand = components.reduce((s, c) => s + c.area, 0);
  const targetArea = Math.max(1, Math.floor(totalLand / zoneCount));
  const seedCounts = allocateSeedCounts(
    components, Math.min(zoneCount, totalLand),
    Math.max(16, Math.floor(targetArea * 0.45))   // 与 worldmap_countries 完全相同
  );
  const seeds: SeedPoint[] = [];
  for (let i = 0; i < components.length; i++) {
    seeds.push(...pickSeedsForComponent(components[i], seedCounts[i] ?? 0, cols, seed + i * 1009, rng, heightMap));
  }

  let zoneGrid = growZones(landGrid, heightMap, seeds, seed, warp);
  zoneGrid = smoothRegions(zoneGrid, landGrid, relax);
  zoneGrid = cleanupTinyPatches(zoneGrid, landGrid, minPatch);

  const skeleton = extractInternalBorders(zoneGrid, landGrid);
  const roadGrid = dilate(skeleton, landGrid, dilRadius);

  const NAMES: NameEntry[] = [{ id: 1, name: "道路", type: "tile" }];
  return { roadGrid, zoneGrid, outputNameList: NAMES };
}
