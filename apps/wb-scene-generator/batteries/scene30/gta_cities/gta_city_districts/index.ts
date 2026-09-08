type Grid = number[][];

interface Point { x: number; y: number; }
interface NameEntry { id: number; name: string; type?: string; }

const CBD = 410;
const RESIDENTIAL = 411;
const INDUSTRIAL = 412;
const PARK = 413;
const SUBURB = 414;

const DIR4 = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
const DIR8 = [...DIR4, [-1, -1], [1, -1], [-1, 1], [1, 1]] as const;

const NAMES: NameEntry[] = [
  { id: CBD, name: "城市商业核心", type: "tile" },
  { id: RESIDENTIAL, name: "连续住宅片区", type: "tile" },
  { id: INDUSTRIAL, name: "工业/港区", type: "tile" },
  { id: PARK, name: "公园/自然缓冲", type: "tile" },
  { id: SUBURB, name: "郊区低密度", type: "tile" },
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

function distanceToOutside(mask: Grid): Grid {
  const rows = mask.length;
  const cols = mask[0]?.length ?? 0;
  const dist = makeGrid(rows, cols, 999999);
  const queue: Point[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!mask[y]?.[x]) continue;
      let edge = x === 0 || y === 0 || x === cols - 1 || y === rows - 1;
      for (const [dx, dy] of DIR4) if (!mask[y + dy]?.[x + dx]) edge = true;
      if (edge) {
        dist[y][x] = 0;
        queue.push({ x, y });
      }
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    for (const [dx, dy] of DIR4) {
      const nx = p.x + dx;
      const ny = p.y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !mask[ny]?.[nx]) continue;
      const nd = dist[p.y][p.x] + 1;
      if (nd >= dist[ny][nx]) continue;
      dist[ny][nx] = nd;
      queue.push({ x: nx, y: ny });
    }
  }
  return dist;
}

function heightAt(heightMap: Grid | null, x: number, y: number): number {
  return heightMap ? (heightMap[y]?.[x] ?? 0.55) : 0.55;
}

function slopeAt(heightMap: Grid | null, landMask: Grid, x: number, y: number): number {
  if (!heightMap) return 0;
  const h = heightAt(heightMap, x, y);
  let maxSlope = 0;
  for (const [dx, dy] of DIR8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!landMask[ny]?.[nx]) continue;
    maxSlope = Math.max(maxSlope, Math.abs(h - heightAt(heightMap, nx, ny)));
  }
  return maxSlope;
}

function weightedCenter(mask: Grid, coastDist: Grid, heightMap: Grid | null, seed: number): Point {
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (let y = 0; y < mask.length; y++) {
    for (let x = 0; x < (mask[0]?.length ?? 0); x++) {
      if (!mask[y]?.[x]) continue;
      const coast = coastDist[y]?.[x] ?? 0;
      const h = heightAt(heightMap, x, y);
      const flat = 1 - clamp(slopeAt(heightMap, mask, x, y) / 0.18, 0, 1);
      const n = valueNoise(x * 0.018, y * 0.018, seed);
      const w = (1 + Math.min(42, coast)) * clamp(1.2 - Math.max(0, h - 0.66) * 2, 0.25, 1.2) * (0.65 + flat * 0.35) * (0.9 + n * 0.2);
      sx += x * w;
      sy += y * w;
      sw += w;
    }
  }
  return sw > 0 ? { x: sx / sw, y: sy / sw } : { x: 0, y: 0 };
}

function smoothDistricts(grid: Grid, mask: Grid, iterations: number): Grid {
  let cur = grid;
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  for (let it = 0; it < iterations; it++) {
    const next = cur.map(row => row.slice());
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (!mask[y]?.[x] || cur[y][x] === CBD) continue;
        const counts = new Map<number, number>();
        for (const [dx, dy] of DIR8) {
          const v = cur[y + dy]?.[x + dx] ?? 0;
          if (v > 0) counts.set(v, (counts.get(v) ?? 0) + 1);
        }
        let best = cur[y][x];
        let bestCount = 0;
        for (const [v, count] of counts) {
          if (count > bestCount) {
            best = v;
            bestCount = count;
          }
        }
        if (bestCount >= 5) next[y][x] = best;
      }
    }
    cur = next;
  }
  return cur;
}

export function gtaCityDistricts(input: Record<string, unknown>): Record<string, unknown> {
  if (!isGrid(input.landGrid)) return { error: "landGrid is required" };
  const landGrid = input.landGrid as Grid;
  const heightMap = isGrid(input.heightMap) ? input.heightMap as Grid : null;
  const rows = landGrid.length;
  const cols = landGrid[0]?.length ?? 0;
  const seed = resolveSeed(input.seed);
  const coastInset = clamp(int(input, "coastInset", 6), 0, 80);
  const urbanCoverage = clamp(num(input, "urbanCoverage", 0.78), 0.15, 1);
  const centerBias = clamp(num(input, "centerBias", 0.62), 0, 1);

  const landMask = landGrid.map(row => row.map(v => v > 0 ? 1 : 0));
  const coastDist = distanceToOutside(landMask);
  const center = weightedCenter(landMask, coastDist, heightMap, seed);
  const diag = Math.max(1, Math.hypot(rows, cols));
  let maxUsefulDist = 1;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!landMask[y]?.[x]) continue;
      maxUsefulDist = Math.max(maxUsefulDist, Math.hypot(x - center.x, y - center.y));
    }
  }

  let districtGrid = makeGrid(rows, cols, 0);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!landMask[y]?.[x]) continue;
      const h = heightAt(heightMap, x, y);
      const slope = slopeAt(heightMap, landMask, x, y);
      const coast = coastDist[y]?.[x] ?? 0;
      const d = Math.hypot(x - center.x, y - center.y) / maxUsefulDist;
      const n = valueNoise(x * 0.018, y * 0.018, seed + 17);
      const urbanScore = (1 - d) * centerBias + clamp(coast / Math.max(16, coastInset + 24), 0, 1) * 0.25 + (1 - clamp(slope / 0.2, 0, 1)) * 0.25 + n * 0.14 - Math.max(0, h - 0.78);

      if (coast < coastInset || h > 0.86 || slope > 0.2 || urbanScore < 1 - urbanCoverage) {
        districtGrid[y][x] = PARK;
      } else if (d < 0.16 + n * 0.03 && coast > coastInset + 4) {
        districtGrid[y][x] = CBD;
      } else if (coast < coastInset + 20 && d > 0.22 && (n > 0.46 || h < 0.5)) {
        districtGrid[y][x] = INDUSTRIAL;
      } else if (d > 0.68 || urbanScore < 0.36) {
        districtGrid[y][x] = SUBURB;
      } else {
        districtGrid[y][x] = RESIDENTIAL;
      }
    }
  }

  districtGrid = smoothDistricts(districtGrid, landMask, 2);
  const buildableMask = districtGrid.map(row => row.map(v => v === CBD || v === RESIDENTIAL || v === INDUSTRIAL || v === SUBURB ? 1 : 0));
  const centerGrid = makeGrid(rows, cols, 0);
  centerGrid[clamp(Math.round(center.y), 0, rows - 1)][clamp(Math.round(center.x), 0, cols - 1)] = 1;
  const used = new Set(districtGrid.flat().filter(v => v !== 0));

  return {
    districtGrid,
    buildableMask,
    centerGrid,
    outputGrid: districtGrid,
    outputNameList: NAMES.filter(n => used.has(n.id)),
  };
}
