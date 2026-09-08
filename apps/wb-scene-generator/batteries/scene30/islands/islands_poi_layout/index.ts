/**
 * islandsPoiLayout: 布置岛屿兴趣点并将其足迹写回地形。
 */

type Grid = number[][];
interface NameEntry { id: number; name: string; }
interface PoiFootprintCell { dx: number; dy: number; tile: number; }
interface PoiDecoration { dx: number; dy: number; kind: string; }
interface Poi {
  type: string; label: string; tileX: number; tileY: number;
  radius: number; footprint: PoiFootprintCell[]; decorations: PoiDecoration[];
}

const TILE = {
  DEEP_WATER: 1, WATER: 2, SAND: 3, GRASS: 4, DENSE_GRASS: 5,
  FOREST: 6, MOUNTAIN: 7, SNOW: 8, CLIFF_EDGE: 9, CAVE_FLOOR: 10,
  MUD: 11, DIRT_PATH: 12,
} as const;

const POI_TYPE_META: Record<string, { id: number; name: string }> = {
  cave_entrance: { id: 1, name: "洞穴入口" }, ruined_house: { id: 2, name: "废弃小屋" },
  ruin: { id: 3, name: "古代遗迹" }, watchtower: { id: 4, name: "瞭望塔" },
  campfire: { id: 5, name: "营火点" }, stone_circle: { id: 6, name: "石阵" },
  oasis: { id: 7, name: "绿洲" }, grave_site: { id: 8, name: "墓地" },
  abandoned_mine: { id: 9, name: "废弃矿洞" }, signpost: { id: 10, name: "路牌" },
};

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

type PoiConfig = {
  type: string; label: string; biomes: number[]; count: [number, number];
  radius: number; footprint: PoiFootprintCell[]; decorations: PoiDecoration[];
};

const POI_CONFIGS: PoiConfig[] = [
  {
    type: "cave_entrance", label: "Cave Entrance", biomes: [TILE.MOUNTAIN, TILE.CLIFF_EDGE],
    count: [3, 6], radius: 3,
    footprint: [
      { dx: 0, dy: 0, tile: TILE.CAVE_FLOOR }, { dx: 1, dy: 0, tile: TILE.CAVE_FLOOR },
      { dx: -1, dy: 0, tile: TILE.CAVE_FLOOR }, { dx: 0, dy: 1, tile: TILE.CAVE_FLOOR },
      { dx: 0, dy: -1, tile: TILE.CLIFF_EDGE },
    ],
    decorations: [{ dx: 0, dy: 2, kind: "cave_torch" }, { dx: -1, dy: 1, kind: "bones" }, { dx: 1, dy: 1, kind: "bones" }],
  },
  {
    type: "ruined_house", label: "Ruined House", biomes: [TILE.GRASS, TILE.DENSE_GRASS, TILE.DIRT_PATH],
    count: [4, 8], radius: 3,
    footprint: [
      { dx: -2, dy: -2, tile: TILE.MOUNTAIN }, { dx: -1, dy: -2, tile: TILE.MOUNTAIN }, { dx: 0, dy: -2, tile: TILE.MOUNTAIN },
      { dx: 1, dy: -2, tile: TILE.MOUNTAIN }, { dx: 2, dy: -2, tile: TILE.MOUNTAIN }, { dx: -2, dy: 2, tile: TILE.MOUNTAIN },
      { dx: -1, dy: 2, tile: TILE.MOUNTAIN }, { dx: 1, dy: 2, tile: TILE.MOUNTAIN }, { dx: 2, dy: 2, tile: TILE.MOUNTAIN },
      { dx: -2, dy: -1, tile: TILE.MOUNTAIN }, { dx: -2, dy: 0, tile: TILE.MOUNTAIN }, { dx: -2, dy: 1, tile: TILE.MOUNTAIN },
      { dx: 2, dy: -1, tile: TILE.MOUNTAIN }, { dx: 2, dy: 0, tile: TILE.MOUNTAIN }, { dx: 2, dy: 1, tile: TILE.MOUNTAIN },
      { dx: -1, dy: -1, tile: TILE.DIRT_PATH }, { dx: 0, dy: -1, tile: TILE.DIRT_PATH }, { dx: 1, dy: -1, tile: TILE.DIRT_PATH },
      { dx: -1, dy: 0, tile: TILE.DIRT_PATH }, { dx: 0, dy: 0, tile: TILE.DIRT_PATH }, { dx: 1, dy: 0, tile: TILE.DIRT_PATH },
      { dx: -1, dy: 1, tile: TILE.DIRT_PATH }, { dx: 0, dy: 1, tile: TILE.DIRT_PATH }, { dx: 1, dy: 1, tile: TILE.DIRT_PATH },
      { dx: 0, dy: 2, tile: TILE.DIRT_PATH },
    ],
    decorations: [{ dx: 1, dy: 1, kind: "broken_pot" }, { dx: -1, dy: -1, kind: "chest" }, { dx: 0, dy: 0, kind: "campfire_cold" }],
  },
  {
    type: "ruin", label: "Ancient Ruin", biomes: [TILE.GRASS, TILE.SAND, TILE.DENSE_GRASS],
    count: [3, 5], radius: 4,
    footprint: [
      { dx: -3, dy: -3, tile: TILE.CLIFF_EDGE }, { dx: 3, dy: -3, tile: TILE.CLIFF_EDGE },
      { dx: -3, dy: 3, tile: TILE.CLIFF_EDGE }, { dx: 3, dy: 3, tile: TILE.CLIFF_EDGE },
      { dx: 0, dy: 0, tile: TILE.DIRT_PATH }, { dx: 1, dy: 0, tile: TILE.DIRT_PATH },
      { dx: -1, dy: 0, tile: TILE.DIRT_PATH }, { dx: 0, dy: 1, tile: TILE.DIRT_PATH },
      { dx: 0, dy: -1, tile: TILE.DIRT_PATH }, { dx: -2, dy: -2, tile: TILE.MOUNTAIN },
      { dx: 2, dy: 2, tile: TILE.MOUNTAIN },
    ],
    decorations: [{ dx: 0, dy: 0, kind: "ancient_altar" }, { dx: -2, dy: 0, kind: "standing_stone" }, { dx: 2, dy: 0, kind: "standing_stone" }],
  },
  {
    type: "watchtower", label: "Watchtower", biomes: [TILE.GRASS, TILE.DENSE_GRASS],
    count: [2, 4], radius: 2,
    footprint: [
      { dx: 0, dy: 0, tile: TILE.DIRT_PATH }, { dx: 1, dy: 0, tile: TILE.DIRT_PATH },
      { dx: 0, dy: 1, tile: TILE.DIRT_PATH }, { dx: 1, dy: 1, tile: TILE.DIRT_PATH },
    ],
    decorations: [{ dx: 0, dy: 0, kind: "watchtower_base" }],
  },
  {
    type: "campfire", label: "Campfire Site", biomes: [TILE.GRASS, TILE.FOREST, TILE.DENSE_GRASS],
    count: [5, 9], radius: 2,
    footprint: [
      { dx: 0, dy: 0, tile: TILE.SAND }, { dx: 1, dy: 0, tile: TILE.SAND },
      { dx: -1, dy: 0, tile: TILE.SAND }, { dx: 0, dy: 1, tile: TILE.SAND },
      { dx: 0, dy: -1, tile: TILE.SAND },
    ],
    decorations: [{ dx: 0, dy: 0, kind: "campfire_lit" }],
  },
  {
    type: "stone_circle", label: "Stone Circle", biomes: [TILE.GRASS, TILE.DENSE_GRASS, TILE.SAND],
    count: [2, 4], radius: 3,
    footprint: [
      { dx: 0, dy: -3, tile: TILE.CLIFF_EDGE }, { dx: 3, dy: 0, tile: TILE.CLIFF_EDGE },
      { dx: 0, dy: 3, tile: TILE.CLIFF_EDGE }, { dx: -3, dy: 0, tile: TILE.CLIFF_EDGE },
      { dx: 0, dy: 0, tile: TILE.DIRT_PATH },
    ],
    decorations: [{ dx: 0, dy: 0, kind: "ancient_altar" }],
  },
  {
    type: "oasis", label: "Oasis", biomes: [TILE.SAND],
    count: [2, 3], radius: 4,
    footprint: [
      { dx: 0, dy: 0, tile: TILE.WATER }, { dx: 1, dy: 0, tile: TILE.WATER },
      { dx: -1, dy: 0, tile: TILE.WATER }, { dx: 0, dy: 1, tile: TILE.WATER },
      { dx: 0, dy: -1, tile: TILE.WATER }, { dx: 2, dy: 0, tile: TILE.MUD },
      { dx: -2, dy: 0, tile: TILE.MUD }, { dx: 0, dy: 2, tile: TILE.MUD },
      { dx: 0, dy: -2, tile: TILE.MUD },
    ],
    decorations: [{ dx: 3, dy: 0, kind: "palm_tree" }, { dx: -3, dy: 0, kind: "palm_tree" }],
  },
  {
    type: "grave_site", label: "Grave Site", biomes: [TILE.GRASS, TILE.DENSE_GRASS, TILE.FOREST],
    count: [3, 6], radius: 2,
    footprint: [
      { dx: 0, dy: 0, tile: TILE.DIRT_PATH }, { dx: 1, dy: 0, tile: TILE.DIRT_PATH },
      { dx: -1, dy: 0, tile: TILE.DIRT_PATH }, { dx: 2, dy: 0, tile: TILE.DIRT_PATH },
    ],
    decorations: [{ dx: 0, dy: 0, kind: "gravestone" }, { dx: 1, dy: 0, kind: "gravestone" }, { dx: -1, dy: 0, kind: "gravestone_broken" }],
  },
  {
    type: "abandoned_mine", label: "Abandoned Mine", biomes: [TILE.MOUNTAIN, TILE.CLIFF_EDGE, TILE.GRASS],
    count: [2, 4], radius: 3,
    footprint: [
      { dx: 0, dy: 0, tile: TILE.CAVE_FLOOR }, { dx: 1, dy: 0, tile: TILE.CAVE_FLOOR },
      { dx: -1, dy: 0, tile: TILE.CAVE_FLOOR }, { dx: 0, dy: 1, tile: TILE.CAVE_FLOOR },
      { dx: -2, dy: 0, tile: TILE.DIRT_PATH }, { dx: -3, dy: 0, tile: TILE.DIRT_PATH },
      { dx: 0, dy: -1, tile: TILE.CLIFF_EDGE },
    ],
    decorations: [{ dx: 0, dy: 0, kind: "mine_cart" }, { dx: 1, dy: 1, kind: "ore_deposit" }],
  },
  {
    type: "signpost", label: "Signpost", biomes: [TILE.DIRT_PATH, TILE.GRASS],
    count: [4, 8], radius: 1,
    footprint: [],
    decorations: [{ dx: 0, dy: 0, kind: "sign" }],
  },
];

function checkPoiArea(grid: Grid, tx: number, ty: number): boolean {
  const forbidden = new Set<number>([TILE.DEEP_WATER, TILE.WATER]);
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const tile = grid[ty + dy]?.[tx + dx];
      if (tile == null || forbidden.has(tile)) return false;
    }
  return true;
}

function placePois(grid: Grid, seed: number, densityScale: number, minDistance: number): Poi[] {
  const { rows, cols } = dimensions(grid);
  const rng = new SeededRandom(seed + 11111);
  const pois: Poi[] = [];
  const scale = clamp(densityScale, 0.25, 3);

  for (const config of POI_CONFIGS) {
    const baseCount = rng.int(config.count[0], config.count[1]);
    const count = Math.max(1, Math.round(baseCount * scale));
    for (let index = 0; index < count; index++) {
      for (let attempt = 0; attempt < 200; attempt++) {
        const tx = rng.int(config.radius + 1, Math.max(config.radius + 1, cols - config.radius - 2));
        const ty = rng.int(config.radius + 1, Math.max(config.radius + 1, rows - config.radius - 2));
        if (!config.biomes.includes(grid[ty][tx])) continue;
        if (!checkPoiArea(grid, tx, ty)) continue;
        const tooClose = pois.some(poi => Math.sqrt((poi.tileX - tx) ** 2 + (poi.tileY - ty) ** 2) < minDistance);
        if (tooClose) continue;
        pois.push({ type: config.type, label: config.label, tileX: tx, tileY: ty, radius: config.radius, footprint: config.footprint, decorations: config.decorations });
        break;
      }
    }
  }
  return pois;
}

function applyPoiFootprints(grid: Grid, pois: Poi[]): Grid {
  const { rows, cols } = dimensions(grid);
  const next = cloneGrid(grid);
  for (const poi of pois)
    for (const fp of poi.footprint) {
      const gx = poi.tileX + fp.dx, gy = poi.tileY + fp.dy;
      if (inBounds(rows, cols, gy, gx)) next[gy][gx] = fp.tile;
    }
  return next;
}

function buildPoiPointGrid(baseGrid: Grid, pois: Poi[]): { poiGrid: Grid; poiNameList: NameEntry[] } {
  const { rows, cols } = dimensions(baseGrid);
  const poiGrid = makeGrid(rows, cols, 0);
  const usedIds = new Set<number>();
  for (const poi of pois) {
    const meta = POI_TYPE_META[poi.type];
    if (!meta || !inBounds(rows, cols, poi.tileY, poi.tileX)) continue;
    poiGrid[poi.tileY][poi.tileX] = meta.id;
    usedIds.add(meta.id);
  }
  const poiNameList = Object.values(POI_TYPE_META)
    .filter(m => usedIds.has(m.id)).sort((a, b) => a.id - b.id).map(m => ({ id: m.id, name: m.name }));
  return { poiGrid, poiNameList };
}

export function islandsPoiLayout(input: Record<string, unknown>): Record<string, unknown> {
  const grid = input.grid;
  if (!isGrid(grid)) return { error: "grid is required" };

  const seed = typeof input.seed === "number" ? input.seed : 0;
  const poiDensityScale = typeof input.poiDensityScale === "number" ? Math.max(0.25, Math.min(3, input.poiDensityScale)) : 1;
  const minDistance = typeof input.minDistance === "number" ? Math.max(4, Math.round(input.minDistance)) : 12;

  const poiList = placePois(grid, seed, poiDensityScale, minDistance);
  const outputGrid = applyPoiFootprints(grid, poiList);
  const { poiGrid, poiNameList } = buildPoiPointGrid(grid, poiList);

  return { outputGrid, outputNameList: buildTileNameList(outputGrid), poiGrid, poiNameList };
}
