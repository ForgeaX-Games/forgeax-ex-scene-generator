/**
 * islandsTerrainRefine: 对基础群系做平滑、泥地和悬崖细化。
 */

type Grid = number[][];
interface NameEntry { id: number; name: string; }

const TILE = {
  DEEP_WATER: 1, WATER: 2, SAND: 3, GRASS: 4, DENSE_GRASS: 5,
  FOREST: 6, MOUNTAIN: 7, SNOW: 8, CLIFF_EDGE: 9, CAVE_FLOOR: 10,
  MUD: 11, DIRT_PATH: 12,
} as const;

const TILE_WALKABLE: Record<number, boolean> = {
  [TILE.DEEP_WATER]: false, [TILE.WATER]: false, [TILE.SAND]: true,
  [TILE.GRASS]: true, [TILE.DENSE_GRASS]: true, [TILE.FOREST]: true,
  [TILE.MOUNTAIN]: false, [TILE.SNOW]: true, [TILE.CLIFF_EDGE]: false,
  [TILE.CAVE_FLOOR]: true, [TILE.MUD]: true, [TILE.DIRT_PATH]: true,
};

function isGrid(value: unknown): value is Grid {
  return Array.isArray(value) && value.length > 0 && Array.isArray((value as unknown[])[0]);
}

function cloneGrid(grid: Grid): Grid { return grid.map(row => [...row]); }

function dimensions(grid: Grid): { rows: number; cols: number } {
  return { rows: grid.length, cols: grid[0]?.length ?? 0 };
}

function inBounds(rows: number, cols: number, r: number, c: number): boolean {
  return r >= 0 && r < rows && c >= 0 && c < cols;
}

function deterministicRand(x: number, y: number, seed: number): number {
  return ((x * 374761393 + y * 1234567 + seed * 83492791) >>> 0) / 4294967296;
}

function buildTileNameList(grid: Grid): NameEntry[] {
  const names = new Map<number, string>([
    [TILE.DEEP_WATER, "深水"], [TILE.WATER, "浅水"], [TILE.SAND, "沙滩"],
    [TILE.GRASS, "草地"], [TILE.DENSE_GRASS, "浓草地"], [TILE.FOREST, "森林"],
    [TILE.MOUNTAIN, "山地"], [TILE.SNOW, "雪地"],     [TILE.CLIFF_EDGE, "悬崖"],
    [TILE.CAVE_FLOOR, "洞穴"], [TILE.MUD, "泥地"], [TILE.DIRT_PATH, "土路"],
  ]);
  const ids = new Set<number>();
  for (const row of grid) for (const v of row) ids.add(v);
  return [...ids].sort((a, b) => a - b).map(id => ({ id, name: names.get(id) ?? `区域 ${id}` }));
}

function smoothBiomeGrid(grid: Grid, passes: number): Grid {
  const { rows, cols } = dimensions(grid);
  let current = cloneGrid(grid);
  for (let pass = 0; pass < passes; pass++) {
    const next = cloneGrid(current);
    for (let y = 1; y < rows - 1; y++) {
      for (let x = 1; x < cols - 1; x++) {
        const counts = new Map<number, number>();
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const tile = current[y + dy][x + dx];
            counts.set(tile, (counts.get(tile) ?? 0) + 1);
          }
        let chosen = current[y][x], maxCount = 0;
        for (const [tile, count] of counts.entries())
          if (count > maxCount) { maxCount = count; chosen = tile; }
        if (maxCount >= 7) next[y][x] = chosen;
      }
    }
    current = next;
  }
  return current;
}

function hasTileNearby(grid: Grid, r: number, c: number, radius: number, targets: Set<number>): boolean {
  const { rows, cols } = dimensions(grid);
  for (let dy = -radius; dy <= radius; dy++)
    for (let dx = -radius; dx <= radius; dx++) {
      const nr = r + dy, nc = c + dx;
      if (!inBounds(rows, cols, nr, nc)) continue;
      if (targets.has(grid[nr][nc])) return true;
    }
  return false;
}

function applyMudNearWater(grid: Grid, radius: number, chance: number, seed: number): Grid {
  const { rows, cols } = dimensions(grid);
  const next = cloneGrid(grid);
  const waterTiles = new Set<number>([TILE.WATER, TILE.DEEP_WATER]);
  for (let y = 1; y < rows - 1; y++)
    for (let x = 1; x < cols - 1; x++) {
      if (grid[y][x] !== TILE.GRASS && grid[y][x] !== TILE.SAND) continue;
      if (!hasTileNearby(grid, y, x, radius, waterTiles)) continue;
      if (deterministicRand(x, y, seed + 101) < chance) next[y][x] = TILE.MUD;
    }
  return next;
}

function applyCliffEdges(grid: Grid, chance: number, seed: number): Grid {
  const { rows, cols } = dimensions(grid);
  // First pass: mark all mountain cells as cliff (whole region, not just border cells).
  // chance controls per-cell probability so sparse mountain patches can stay partially as mountain.
  const next = cloneGrid(grid);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      if (grid[y][x] !== TILE.MOUNTAIN) continue;
      if (deterministicRand(x, y, seed + 77) < chance)
        next[y][x] = TILE.CLIFF_EDGE;
    }
  return next;
}

export function islandsTerrainRefine(input: Record<string, unknown>): Record<string, unknown> {
  const grid = input.grid;
  if (!isGrid(grid)) return { error: "grid is required" };

  const seed = typeof input.seed === "number" ? input.seed : 0;
  const smoothPasses = typeof input.smoothPasses === "number" ? Math.max(0, Math.round(input.smoothPasses)) : 2;
  const mudRadius = typeof input.mudRadius === "number" ? Math.max(1, Math.round(input.mudRadius)) : 2;
  const mudChance = typeof input.mudChance === "number" ? Math.max(0, Math.min(1, input.mudChance)) : 0.6;
  const cliffChance = typeof input.cliffChance === "number" ? Math.max(0, Math.min(1, input.cliffChance)) : 0.65;

  let outputGrid = smoothBiomeGrid(grid, smoothPasses);
  outputGrid = applyMudNearWater(outputGrid, mudRadius, mudChance, seed);
  outputGrid = applyCliffEdges(outputGrid, cliffChance, seed);

  return { outputGrid, outputNameList: buildTileNameList(outputGrid) };
}
