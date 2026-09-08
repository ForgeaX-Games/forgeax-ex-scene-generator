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

function fbm(x: number, y: number, seed: number, octaves: number, persistence: number): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + o * 1013);
    norm += amp;
    amp *= persistence;
    freq *= 2;
  }
  return norm > 0 ? sum / norm : 0;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

const PREVIEW_NAMES: NameEntry[] = [
  { id: 1, name: "深海", type: "tile" },
  { id: 2, name: "浅海", type: "tile" },
  { id: 3, name: "沙滩", type: "tile" },
  { id: 4, name: "平原", type: "tile" },
  { id: 5, name: "丘陵", type: "tile" },
  { id: 6, name: "山地", type: "tile" },
];

function previewFromHeight(heightMap: Grid): Grid {
  return heightMap.map(row => row.map(h => {
    if (h < 0) return 0;
    if (h < 0.28) return 1;
    if (h < 0.42) return 2;
    if (h < 0.47) return 3;
    if (h < 0.68) return 4;
    if (h < 0.82) return 5;
    return 6;
  }));
}

export function worldmapHeight(input: Record<string, unknown>): Record<string, unknown> {
  const mask = isGrid(input.grid) ? input.grid : null;
  const width = mask ? mask[0]?.length ?? 1 : Math.max(8, int(input, "width", 240));
  const height = mask ? mask.length : Math.max(8, int(input, "height", 140));
  const seed = resolveSeed(input.seed);
  const scale = clamp(num(input, "scale", 4), 1, 16);
  const octaves = clamp(int(input, "octaves", 5), 1, 8);
  const persistence = clamp(num(input, "persistence", 0.5), 0.1, 0.9);
  const falloff = clamp(num(input, "falloff", 0.5), 0, 1);

  const raw = makeGrid(height, width, 0);
  let min = Infinity;
  let max = -Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask && (mask[y]?.[x] ?? 0) === 0) {
        raw[y][x] = -1;
        continue;
      }
      const nx = (x / width) * scale;
      const ny = (y / height) * scale;
      let h = fbm(nx, ny, seed, octaves, persistence);
      const cx = (x / Math.max(1, width - 1)) * 2 - 1;
      const cy = (y / Math.max(1, height - 1)) * 2 - 1;
      const d = Math.min(1, Math.hypot(cx, cy) / Math.SQRT2);
      h = Math.max(0, h - falloff * smoothstep(0.25, 1.0, d));
      raw[y][x] = h;
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }

  const span = max - min || 1;
  const heightMap = raw.map(row => row.map(h => (h < 0 ? -1 : clamp((h - min) / span, 0, 1))));
  const outputGrid = previewFromHeight(heightMap);
  const used = new Set(outputGrid.flat().filter(v => v !== 0));
  return {
    heightMap,
    outputGrid,
    outputNameList: PREVIEW_NAMES.filter(entry => used.has(entry.id)),
  };
}
