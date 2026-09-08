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
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const xf = x - x0;
  const yf = y - y0;
  const v00 = hash2(x0, y0, seed);
  const v10 = hash2(x0 + 1, y0, seed);
  const v01 = hash2(x0, y0 + 1, seed);
  const v11 = hash2(x0 + 1, y0 + 1, seed);
  const u = fade(xf);
  const v = fade(yf);
  return lerp(lerp(v00, v10, u), lerp(v01, v11, u), v);
}

interface SeedPoint { x: number; y: number; }
interface LandComponent { cells: number[]; area: number; }
interface QueueNode { idx: number; countryId: number; cost: number; seedIdx: number; }

const DIR4: Array<[number, number]> = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIR8: Array<[number, number]> = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
  [-1, -1], [1, -1], [-1, 1], [1, 1],
];

class MinHeap {
  private data: QueueNode[] = [];

  get length(): number { return this.data.length; }

  push(node: QueueNode): void {
    this.data.push(node);
    this.bubbleUp(this.data.length - 1);
  }

  pop(): QueueNode | undefined {
    const first = this.data[0];
    const last = this.data.pop();
    if (!last || this.data.length === 0) return first;
    this.data[0] = last;
    this.sinkDown(0);
    return first;
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.data[parent].cost <= this.data[index].cost) break;
      [this.data[parent], this.data[index]] = [this.data[index], this.data[parent]];
      index = parent;
    }
  }

  private sinkDown(index: number): void {
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let best = index;
      if (left < this.data.length && this.data[left].cost < this.data[best].cost) best = left;
      if (right < this.data.length && this.data[right].cost < this.data[best].cost) best = right;
      if (best === index) break;
      [this.data[best], this.data[index]] = [this.data[index], this.data[best]];
      index = best;
    }
  }
}

function findLandComponents(landGrid: Grid): LandComponent[] {
  const rows = landGrid.length;
  const cols = landGrid[0]?.length ?? 0;
  const seen = new Uint8Array(rows * cols);
  const components: LandComponent[] = [];

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const start = y * cols + x;
      if (seen[start] || !landGrid[y][x]) continue;
      const cells: number[] = [];
      const queue = [start];
      seen[start] = 1;
      let head = 0;
      while (head < queue.length) {
        const idx = queue[head++];
        cells.push(idx);
        const cx = idx % cols;
        const cy = Math.floor(idx / cols);
        for (const [dx, dy] of DIR4) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const ni = ny * cols + nx;
          if (seen[ni] || !landGrid[ny][nx]) continue;
          seen[ni] = 1;
          queue.push(ni);
        }
      }
      components.push({ cells, area: cells.length });
    }
  }

  return components.sort((a, b) => b.area - a.area);
}

function allocateSeedCounts(components: LandComponent[], totalCount: number, minArea: number): number[] {
  const totalArea = components.reduce((sum, c) => sum + c.area, 0);
  const counts = components.map(c => {
    const proportional = Math.round((c.area / Math.max(1, totalArea)) * totalCount);
    const areaCap = Math.max(1, Math.floor(c.area / Math.max(1, minArea)));
    return Math.max(1, Math.min(areaCap, proportional || 1));
  });

  while (counts.reduce((a, b) => a + b, 0) > totalCount) {
    let best = -1;
    for (let i = 0; i < counts.length; i++) {
      if (counts[i] <= 1) continue;
      if (best < 0 || components[i].area / counts[i] < components[best].area / counts[best]) best = i;
    }
    if (best < 0) break;
    counts[best]--;
  }

  while (counts.reduce((a, b) => a + b, 0) < totalCount) {
    let best = -1;
    for (let i = 0; i < counts.length; i++) {
      const cap = Math.max(1, Math.floor(components[i].area / Math.max(1, minArea)));
      if (counts[i] >= cap) continue;
      if (best < 0 || components[i].area / counts[i] > components[best].area / counts[best]) best = i;
    }
    if (best < 0) break;
    counts[best]++;
  }

  return counts;
}

function terrainScore(idx: number, cols: number, heightMap: Grid | null): number {
  if (!heightMap) return 1;
  const x = idx % cols;
  const y = Math.floor(idx / cols);
  const h = heightMap[y]?.[x] ?? 0.55;
  // 国家核心更常出现在低地/丘陵，少放在海岸阈值附近或高山尖顶。
  return clamp(1 - Math.abs(h - 0.58) * 1.6, 0.25, 1);
}

function pickSeedsForComponent(
  component: LandComponent,
  count: number,
  cols: number,
  seed: number,
  rng: () => number,
  heightMap: Grid | null
): SeedPoint[] {
  const seeds: SeedPoint[] = [];
  if (component.cells.length === 0 || count <= 0) return seeds;
  const firstIdx = component.cells[Math.floor(rng() * component.cells.length)];
  seeds.push({ x: firstIdx % cols, y: Math.floor(firstIdx / cols) });

  while (seeds.length < count) {
    let bestIdx = component.cells[0];
    let bestScore = -Infinity;
    for (const idx of component.cells) {
      const x = idx % cols;
      const y = Math.floor(idx / cols);
      let minD2 = Infinity;
      for (const s of seeds) {
        const d2 = (x - s.x) ** 2 + (y - s.y) ** 2;
        if (d2 < minD2) minD2 = d2;
      }
      const jitter = 0.92 + valueNoise(x * 0.07, y * 0.07, seed + 3001) * 0.16;
      const score = minD2 * terrainScore(idx, cols, heightMap) * jitter;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = idx;
      }
    }
    seeds.push({ x: bestIdx % cols, y: Math.floor(bestIdx / cols) });
  }

  return seeds;
}

function growCountries(
  landGrid: Grid,
  heightMap: Grid | null,
  seeds: SeedPoint[],
  seed: number,
  warp: number
): Grid {
  const rows = landGrid.length;
  const cols = landGrid[0]?.length ?? 0;
  const out = makeGrid(rows, cols, 0);
  const heap = new MinHeap();
  const seedBias = seeds.map((s, i) => 0.9 + valueNoise(s.x * 0.05, s.y * 0.05, seed + i * 97) * 0.22);

  seeds.forEach((s, i) => {
    const x = clamp(Math.round(s.x), 0, cols - 1);
    const y = clamp(Math.round(s.y), 0, rows - 1);
    if (landGrid[y]?.[x]) heap.push({ idx: y * cols + x, countryId: i + 1, cost: 0, seedIdx: i });
  });

  while (heap.length > 0) {
    const cur = heap.pop();
    if (!cur) break;
    const x = cur.idx % cols;
    const y = Math.floor(cur.idx / cols);
    if (!landGrid[y]?.[x] || out[y][x] !== 0) continue;
    out[y][x] = cur.countryId;

    for (const [dx, dy] of DIR4) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !landGrid[ny][nx] || out[ny][nx]) continue;
      const ni = ny * cols + nx;
      const h0 = heightMap ? (heightMap[y]?.[x] ?? 0.5) : 0.5;
      const h1 = heightMap ? (heightMap[ny]?.[nx] ?? h0) : h0;
      const heightPenalty = heightMap ? Math.abs(h1 - h0) * 9 + Math.max(0, h1 - 0.78) * 1.8 : 0;
      const noisePenalty = valueNoise(nx * 0.08, ny * 0.08, seed + cur.countryId * 131) * warp * 8;
      heap.push({
        idx: ni,
        countryId: cur.countryId,
        seedIdx: cur.seedIdx,
        cost: cur.cost + (1 + heightPenalty + noisePenalty) * seedBias[cur.seedIdx],
      });
    }
  }

  return out;
}

function smoothRegions(countryGrid: Grid, landGrid: Grid, iterations: number): Grid {
  const rows = countryGrid.length;
  const cols = countryGrid[0]?.length ?? 0;
  let grid = countryGrid.map(row => row.slice());
  for (let it = 0; it < iterations; it++) {
    const next = grid.map(row => row.slice());
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (!landGrid[y]?.[x]) continue;
        const counts = new Map<number, number>();
        for (const [dx, dy] of DIR8) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !landGrid[ny][nx]) continue;
          const v = grid[ny][nx];
          if (v > 0) counts.set(v, (counts.get(v) ?? 0) + 1);
        }
        let best = grid[y][x];
        let bestCount = 0;
        for (const [id, count] of counts) {
          if (count > bestCount) {
            best = id;
            bestCount = count;
          }
        }
        if (best !== grid[y][x] && bestCount >= 5) next[y][x] = best;
      }
    }
    grid = next;
  }
  return grid;
}

function cleanupTinyPatches(countryGrid: Grid, landGrid: Grid, minPatchArea: number): Grid {
  if (minPatchArea <= 0) return countryGrid;
  const rows = countryGrid.length;
  const cols = countryGrid[0]?.length ?? 0;
  const grid = countryGrid.map(row => row.slice());
  const seen = new Uint8Array(rows * cols);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const start = y * cols + x;
      const id = grid[y][x];
      if (seen[start] || !landGrid[y]?.[x] || id <= 0) continue;
      const cells: number[] = [];
      const borderCounts = new Map<number, number>();
      const queue = [start];
      seen[start] = 1;
      let head = 0;
      while (head < queue.length) {
        const idx = queue[head++];
        cells.push(idx);
        const cx = idx % cols;
        const cy = Math.floor(idx / cols);
        for (const [dx, dy] of DIR4) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !landGrid[ny]?.[nx]) continue;
          const ni = ny * cols + nx;
          const nv = grid[ny][nx];
          if (nv === id && !seen[ni]) {
            seen[ni] = 1;
            queue.push(ni);
          } else if (nv !== id && nv > 0) {
            borderCounts.set(nv, (borderCounts.get(nv) ?? 0) + 1);
          }
        }
      }
      if (cells.length >= minPatchArea || borderCounts.size === 0) continue;
      let target = id;
      let bestCount = -1;
      for (const [neighborId, count] of borderCounts) {
        if (count > bestCount) {
          target = neighborId;
          bestCount = count;
        }
      }
      for (const idx of cells) grid[Math.floor(idx / cols)][idx % cols] = target;
    }
  }

  return grid;
}

export function worldmapCountries(input: Record<string, unknown>): Record<string, unknown> {
  if (!isGrid(input.landGrid)) return { error: "landGrid is required" };
  const landGrid = input.landGrid as Grid;
  const heightMap = isGrid(input.heightMap) ? input.heightMap as Grid : null;
  const rows = landGrid.length;
  const cols = landGrid[0]?.length ?? 0;
  const seed = resolveSeed(input.seed);
  const rng = makeRng(seed);
  const countryCount = clamp(int(input, "countryCount", 20), 2, 120);
  const relax = clamp(int(input, "relax", 2), 0, 5);
  const warp = clamp(num(input, "warp", 0.06), 0, 0.3);
  const minPatchArea = clamp(int(input, "minPatchArea", 48), 0, 1000);

  const components = findLandComponents(landGrid);
  if (components.length === 0) {
    const countryGrid = makeGrid(rows, cols, 0);
    const empty: NameEntry[] = [{ id: 0, name: "海洋", type: "tile" }];
    return { countryGrid, countryNameList: empty, outputGrid: countryGrid, outputNameList: empty };
  }

  const totalLand = components.reduce((sum, c) => sum + c.area, 0);
  const targetArea = Math.max(1, Math.floor(totalLand / countryCount));
  const seedCounts = allocateSeedCounts(components, Math.min(countryCount, totalLand), Math.max(16, Math.floor(targetArea * 0.45)));
  const seeds: SeedPoint[] = [];
  for (let i = 0; i < components.length; i++) {
    seeds.push(...pickSeedsForComponent(components[i], seedCounts[i] ?? 0, cols, seed + i * 1009, rng, heightMap));
  }

  let countryGrid = growCountries(landGrid, heightMap, seeds, seed, warp);
  countryGrid = smoothRegions(countryGrid, landGrid, relax);
  countryGrid = cleanupTinyPatches(countryGrid, landGrid, minPatchArea);

  const countryNameList: NameEntry[] = [{ id: 0, name: "海洋", type: "tile" }];
  for (let i = 0; i < seeds.length; i++) countryNameList.push({ id: i + 1, name: `国家 ${i + 1}`, type: "tile" });
  return { countryGrid, countryNameList, outputGrid: countryGrid, outputNameList: countryNameList };
}
