/**
 * islandsResourceScatter: 基于最终地形散布食物点和可饮水源。
 */

type Grid = number[][];
interface NameEntry { id: number; name: string; }
interface FoodItem { tileX: number; tileY: number; amount: number; maxAmount: number; type: "berry" | "grass" | "fish" | "nut" | "mushroom"; }
interface WaterSource { tileX: number; tileY: number; }

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

const TILE_FOOD: Record<number, number> = {
  [TILE.DEEP_WATER]: 0, [TILE.WATER]: 2, [TILE.SAND]: 1, [TILE.GRASS]: 4,
  [TILE.DENSE_GRASS]: 6, [TILE.FOREST]: 5, [TILE.MOUNTAIN]: 1, [TILE.SNOW]: 1,
  [TILE.CLIFF_EDGE]: 0, [TILE.CAVE_FLOOR]: 2, [TILE.MUD]: 2, [TILE.DIRT_PATH]: 1,
};

const RESOURCE_TYPE_META: Record<string, { id: number; name: string }> = {
  water_source: { id: 1, name: "岸边水源" }, berry: { id: 2, name: "浆果" },
  grass: { id: 3, name: "草料" }, fish: { id: 4, name: "鱼群" },
  nut: { id: 5, name: "坚果" }, mushroom: { id: 6, name: "蘑菇" },
};

class SeededRandom {
  private state: number;
  constructor(seed: number) {
    this.state = (seed === 0 ? Date.now() : seed) >>> 0;
    if (this.state === 0) this.state = 0x6d2b79f5;
  }
  next(): number { this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0; return this.state / 0x100000000; }
  int(min: number, max: number): number { if (max <= min) return min; return min + Math.floor(this.next() * (max - min + 1)); }
  chance(probability: number): boolean { return this.next() < probability; }
}

function isGrid(value: unknown): value is Grid {
  return Array.isArray(value) && value.length > 0 && Array.isArray((value as unknown[])[0]);
}

function makeGrid(rows: number, cols: number, fill = 0): Grid {
  return Array.from({ length: rows }, () => new Array(cols).fill(fill));
}

function dimensions(grid: Grid): { rows: number; cols: number } {
  return { rows: grid.length, cols: grid[0]?.length ?? 0 };
}

function inBounds(rows: number, cols: number, r: number, c: number): boolean {
  return r >= 0 && r < rows && c >= 0 && c < cols;
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

function placeFoodItems(grid: Grid, seed: number, densityScale: number): FoodItem[] {
  const { rows, cols } = dimensions(grid);
  const rng = new SeededRandom(seed + 1234);
  const items: FoodItem[] = [];
  const scale = clamp(densityScale, 0.1, 3);

  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const tile = grid[y][x];
      const foodValue = TILE_FOOD[tile] ?? 0;
      if (foodValue === 0) continue;
      const probability = clamp(foodValue * 0.035 * scale, 0, 0.8);
      if (!rng.chance(probability)) continue;

      let type: FoodItem["type"] = "grass";
      let amount = rng.int(2, 5);
      if (tile === TILE.FOREST || tile === TILE.CAVE_FLOOR) {
        type = rng.next() > 0.4 ? "berry" : rng.next() > 0.5 ? "mushroom" : "nut";
        amount = rng.int(3, 8);
      } else if (tile === TILE.WATER) {
        type = "fish"; amount = rng.int(1, 3);
      } else if (tile === TILE.DENSE_GRASS || tile === TILE.MUD) {
        type = rng.next() > 0.4 ? "grass" : "berry"; amount = rng.int(3, 7);
      }
      items.push({ tileX: x, tileY: y, amount, maxAmount: amount, type });
    }
  return items;
}

function placeWaterSources(grid: Grid): WaterSource[] {
  const { rows, cols } = dimensions(grid);
  const sources: WaterSource[] = [];
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const tile = grid[y][x];
      if (tile !== TILE.WATER && tile !== TILE.DEEP_WATER) continue;
      const shore = [[y - 1, x], [y + 1, x], [y, x - 1], [y, x + 1]]
        .some(([nr, nc]) => inBounds(rows, cols, nr, nc) && TILE_WALKABLE[grid[nr][nc]]);
      if (shore) sources.push({ tileX: x, tileY: y });
    }
  return sources;
}

function buildResourceGrid(baseGrid: Grid, foodItems: FoodItem[], waterSources: WaterSource[]): { resourceGrid: Grid; resourceNameList: NameEntry[] } {
  const { rows, cols } = dimensions(baseGrid);
  const resourceGrid = makeGrid(rows, cols, 0);
  const usedIds = new Set<number>();

  for (const food of foodItems) {
    const meta = RESOURCE_TYPE_META[food.type];
    if (!meta || !inBounds(rows, cols, food.tileY, food.tileX)) continue;
    resourceGrid[food.tileY][food.tileX] = meta.id;
    usedIds.add(meta.id);
  }

  const waterMeta = RESOURCE_TYPE_META.water_source;
  for (const source of waterSources) {
    if (!inBounds(rows, cols, source.tileY, source.tileX)) continue;
    if (resourceGrid[source.tileY][source.tileX] !== 0) continue;
    resourceGrid[source.tileY][source.tileX] = waterMeta.id;
    usedIds.add(waterMeta.id);
  }

  const resourceNameList = Object.values(RESOURCE_TYPE_META)
    .filter(m => usedIds.has(m.id)).sort((a, b) => a.id - b.id).map(m => ({ id: m.id, name: m.name }));
  return { resourceGrid, resourceNameList };
}

export function islandsResourceScatter(input: Record<string, unknown>): Record<string, unknown> {
  const grid = input.grid;
  if (!isGrid(grid)) return { error: "grid is required" };

  const seed = typeof input.seed === "number" ? input.seed : 0;
  const foodDensityScale = typeof input.foodDensityScale === "number" ? Math.max(0.1, Math.min(3, input.foodDensityScale)) : 1;

  const foodItems = placeFoodItems(grid, seed, foodDensityScale);
  const waterSources = placeWaterSources(grid);
  const { resourceGrid, resourceNameList } = buildResourceGrid(grid, foodItems, waterSources);

  return { outputGrid: grid, outputNameList: buildTileNameList(grid), resourceGrid, resourceNameList };
}
