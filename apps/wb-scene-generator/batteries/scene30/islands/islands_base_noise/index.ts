/**
 * islandsBaseNoise: 接受输入掩码网格，仅对非 0 格子生成岛屿高度图与湿度图，并输出预览地形。
 * 0 格子在所有输出中保持 0。
 */

type Grid = number[][];
interface NameEntry { id: number; name: string; }

const TILE = {
  DEEP_WATER: 1, WATER: 2, SAND: 3, GRASS: 4, DENSE_GRASS: 5,
  FOREST: 6, MOUNTAIN: 7, SNOW: 8, CLIFF_EDGE: 9, CAVE_FLOOR: 10,
  MUD: 11, DIRT_PATH: 12,
} as const;

class SeededRandom {
  private state: number;
  constructor(seed: number) {
    this.state = (seed === 0 ? Date.now() : seed) >>> 0;
    if (this.state === 0) this.state = 0x6d2b79f5;
  }
  next(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }
}

function isGrid(value: unknown): value is Grid {
  return Array.isArray(value) && value.length > 0 && Array.isArray((value as unknown[])[0]);
}

function makeGrid(rows: number, cols: number, fill = 0): Grid {
  return Array.from({ length: rows }, () => new Array(cols).fill(fill));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function resolveSeed(seed: number): number {
  return seed === 0 ? Date.now() >>> 0 : seed >>> 0;
}

function buildTileNameList(grid: Grid): NameEntry[] {
  const names = new Map<number, string>([
    [TILE.DEEP_WATER, "深水"], [TILE.WATER, "浅水"], [TILE.SAND, "沙滩"],
    [TILE.GRASS, "草地"], [TILE.DENSE_GRASS, "浓草地"], [TILE.FOREST, "森林"],
    [TILE.MOUNTAIN, "山地"], [TILE.SNOW, "雪地"], [TILE.CLIFF_EDGE, "悬崖边"],
    [TILE.CAVE_FLOOR, "洞穴入口"], [TILE.MUD, "泥地"], [TILE.DIRT_PATH, "土路"],
  ]);
  const ids = new Set<number>();
  for (const row of grid) for (const v of row) ids.add(v);
  return [...ids].sort((a, b) => a - b).map(id => ({ id, name: names.get(id) ?? `区域 ${id}` }));
}

function generateValueNoise(
  width: number, height: number, seed: number,
  octaves: number, persistence: number, seedOffset = 0, baseScale = 6
): Grid {
  const result = makeGrid(height, width, 0);
  const rng = new SeededRandom((seed + seedOffset * 2654435761) >>> 0);
  let amplitude = 1, totalAmplitude = 0, scale = baseScale;

  for (let octave = 0; octave < octaves; octave++) {
    const gridW = Math.ceil(width / scale) + 2;
    const gridH = Math.ceil(height / scale) + 2;
    const noiseGrid = makeGrid(gridH, gridW, 0).map(row => row.map(() => rng.next()));

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const fx = x / scale, fy = y / scale;
        const ix = Math.floor(fx), iy = Math.floor(fy);
        const tx = fx - ix, ty = fy - iy;
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const v00 = noiseGrid[iy]?.[ix] ?? 0, v10 = noiseGrid[iy]?.[ix + 1] ?? 0;
        const v01 = noiseGrid[iy + 1]?.[ix] ?? 0, v11 = noiseGrid[iy + 1]?.[ix + 1] ?? 0;
        result[y][x] += (v00 * (1 - sx) * (1 - sy) + v10 * sx * (1 - sy) +
          v01 * (1 - sx) * sy + v11 * sx * sy) * amplitude;
      }
    }
    totalAmplitude += amplitude;
    amplitude *= persistence;
    scale = Math.max(1, Math.ceil(scale / 2));
  }

  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      result[y][x] /= totalAmplitude;

  const cx = width / 2, cy = height / 2;
  const maxDist = Math.min(cx, cy) * 0.82;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      result[y][x] = clamp(result[y][x] * 0.5 + Math.max(0, 1 - dist / maxDist) * 0.5, 0, 1);
    }

  return result;
}

function previewFromHeightMap(heightMap: Grid): Grid {
  return heightMap.map(row => row.map(v => {
    if (v < 0.27) return TILE.DEEP_WATER;
    if (v < 0.37) return TILE.WATER;
    if (v < 0.42) return TILE.SAND;
    return TILE.GRASS;
  }));
}

export function islandsBaseNoise(input: Record<string, unknown>): Record<string, unknown> {
  if (!isGrid(input.grid)) return { error: "grid is required" };
  const inputGrid = input.grid as Grid;
  const height = inputGrid.length;
  const width = inputGrid[0].length;

  const seed = resolveSeed(typeof input.seed === "number" ? input.seed : 0);
  const heightOctaves = typeof input.heightOctaves === "number" ? Math.max(1, Math.round(input.heightOctaves)) : 5;
  const heightPersistence = typeof input.heightPersistence === "number" ? Math.max(0.1, Math.min(0.95, input.heightPersistence)) : 0.55;
  const moistureOctaves = typeof input.moistureOctaves === "number" ? Math.max(1, Math.round(input.moistureOctaves)) : 4;
  const moisturePersistence = typeof input.moisturePersistence === "number" ? Math.max(0.1, Math.min(0.95, input.moisturePersistence)) : 0.5;

  const heightMap = generateValueNoise(width, height, seed, heightOctaves, heightPersistence, 1, 6);
  const moistureMap = generateValueNoise(width, height, seed, moistureOctaves, moisturePersistence, 9999, 7);

  if (!isGrid(heightMap) || !isGrid(moistureMap)) return { error: "failed to generate maps" };

  // 掩码外的格子用 -1 标记，与有效的极低噪声值（0~0.27 的深水区）区分开来
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if ((inputGrid[y]?.[x] ?? 0) === 0) { heightMap[y][x] = -1; moistureMap[y][x] = -1; }

  const outputGrid = previewFromHeightMap(heightMap);

  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if ((inputGrid[y]?.[x] ?? 0) === 0) outputGrid[y][x] = 0;

  return { outputGrid, outputNameList: buildTileNameList(outputGrid), heightMap, moistureMap };
}
