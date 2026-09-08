/**
 * islandsPathGenerate: 在草地开路，形成探索导向的土路网络。
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
  next(): number { this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0; return this.state / 0x100000000; }
  int(min: number, max: number): number { if (max <= min) return min; return min + Math.floor(this.next() * (max - min + 1)); }
}

function isGrid(value: unknown): value is Grid {
  return Array.isArray(value) && value.length > 0 && Array.isArray((value as unknown[])[0]);
}

function cloneGrid(grid: Grid): Grid { return grid.map(row => [...row]); }

function dimensions(grid: Grid): { rows: number; cols: number } {
  return { rows: grid.length, cols: grid[0]?.length ?? 0 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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

function generateDirtPaths(grid: Grid, seed: number, pathCount: number, stepMin: number, stepMax: number): Grid {
  const { rows, cols } = dimensions(grid);
  const next = cloneGrid(grid);
  const rng = new SeededRandom(seed + 5555);
  const dirs: Array<[number, number]> = [[0, 1], [0, -1], [1, 0], [-1, 0]];

  for (let pathIndex = 0; pathIndex < pathCount; pathIndex++) {
    let sx = 0, sy = 0;
    for (let attempt = 0; attempt < 200; attempt++) {
      sx = rng.int(5, Math.max(5, cols - 6));
      sy = rng.int(5, Math.max(5, rows - 6));
      const tile = next[sy][sx];
      if (tile === TILE.GRASS || tile === TILE.DENSE_GRASS) break;
    }
    const steps = rng.int(stepMin, stepMax);
    let cx = sx, cy = sy;
    for (let step = 0; step < steps; step++) {
      const tile = next[cy][cx];
      if (tile === TILE.GRASS || tile === TILE.DENSE_GRASS || tile === TILE.MUD)
        next[cy][cx] = TILE.DIRT_PATH;
      const [dx, dy] = dirs[rng.int(0, dirs.length - 1)];
      const nx = clamp(cx + dx, 1, cols - 2);
      const ny = clamp(cy + dy, 1, rows - 2);
      const nextTile = next[ny][nx];
      if (nextTile !== TILE.DEEP_WATER && nextTile !== TILE.WATER &&
          nextTile !== TILE.MOUNTAIN && nextTile !== TILE.SNOW && nextTile !== TILE.CLIFF_EDGE)
        { cx = nx; cy = ny; }
    }
  }
  return next;
}

export function islandsPathGenerate(input: Record<string, unknown>): Record<string, unknown> {
  const grid = input.grid;
  if (!isGrid(grid)) return { error: "grid is required" };

  const seed = typeof input.seed === "number" ? input.seed : 0;
  const pathCount = typeof input.pathCount === "number" ? Math.max(1, Math.round(input.pathCount)) : 6;
  const stepMin = typeof input.stepMin === "number" ? Math.max(5, Math.round(input.stepMin)) : 20;
  const stepMax = typeof input.stepMax === "number" ? Math.max(stepMin, Math.round(input.stepMax)) : 60;

  const outputGrid = generateDirtPaths(grid, seed, pathCount, stepMin, stepMax);
  return { outputGrid, outputNameList: buildTileNameList(outputGrid) };
}
