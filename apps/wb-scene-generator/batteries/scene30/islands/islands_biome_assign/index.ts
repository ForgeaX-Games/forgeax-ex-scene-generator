/**
 * islandsBiomeAssign: 把高度图与湿度图映射成可玩的岛屿生物群系网格。
 */

type Grid = number[][];
interface NameEntry { id: number; name: string; }

const TILE = {
  DEEP_WATER: 1, WATER: 2, SAND: 3, GRASS: 4, DENSE_GRASS: 5,
  FOREST: 6, MOUNTAIN: 7, SNOW: 8, CLIFF_EDGE: 9, CAVE_FLOOR: 10,
  MUD: 11, DIRT_PATH: 12,
} as const;

function isGrid(value: unknown): value is Grid {
  return Array.isArray(value) && value.length > 0 && Array.isArray((value as unknown[])[0]);
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

function heightToTile(height: number, moisture: number): number {
  // height < 0 是掩码哨兵值（来自 islands_base_noise 的空白格子），保持为 0
  if (height < 0) return 0;
  if (height < 0.27) return TILE.DEEP_WATER;
  if (height < 0.37) return TILE.WATER;
  if (height < 0.42) return TILE.SAND;
  if (height > 0.84) return TILE.SNOW;
  if (height > 0.72) return TILE.MOUNTAIN;
  if (moisture > 0.68 && height > 0.5) return TILE.FOREST;
  if (moisture > 0.52 && height > 0.46) return TILE.DENSE_GRASS;
  return TILE.GRASS;
}

export function islandsBiomeAssign(input: Record<string, unknown>): Record<string, unknown> {
  const heightMap = input.heightMap;
  const moistureMap = input.moistureMap;
  if (!isGrid(heightMap) || !isGrid(moistureMap) || heightMap.length !== moistureMap.length) {
    return { error: "heightMap and moistureMap are required" };
  }

  const outputGrid = heightMap.map((row, r) =>
    row.map((value, c) => heightToTile(value, typeof moistureMap[r][c] === "number" ? moistureMap[r][c] : 0))
  );

  return { outputGrid, outputNameList: buildTileNameList(outputGrid), heightMap, moistureMap };
}
