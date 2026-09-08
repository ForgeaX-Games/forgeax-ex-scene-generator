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

function splitValues(grid: Grid, entries: NameEntry[]): Grid[] {
  return entries.map(entry => grid.map(row => row.map(v => (v === entry.id ? entry.id : 0))));
}

const TERRAIN: NameEntry[] = [
  { id: 1, name: "深海", type: "tile" },
  { id: 2, name: "浅海", type: "tile" },
  { id: 3, name: "沙滩", type: "tile" },
  { id: 4, name: "平原", type: "tile" },
  { id: 5, name: "森林", type: "tile" },
  { id: 6, name: "山地", type: "tile" },
];

const OVERLAYS: NameEntry[] = [
  { id: 90, name: "国界", type: "tile" },
  { id: 91, name: "海岸线", type: "tile" },
  { id: 200, name: "首都", type: "tile" },
  { id: 201, name: "城市", type: "tile" },
  { id: 300, name: "主道路", type: "tile" },
  { id: 301, name: "城市道路", type: "tile" },
  { id: 302, name: "小路", type: "tile" },
  { id: 303, name: "海底隧道", type: "tile" },
  { id: 304, name: "机场跑道", type: "tile" },
  { id: 305, name: "机场入口道路", type: "tile" },
  { id: 306, name: "码头栈桥", type: "tile" },
  { id: 307, name: "港池泊位", type: "tile" },
  { id: 413, name: "绿地公园", type: "tile" },
  { id: 416, name: "码头陆地区", type: "tile" },
  { id: 417, name: "海岛中心区", type: "tile" },
  { id: 418, name: "海岛住宅区", type: "tile" },
  { id: 419, name: "海岛小港区", type: "tile" },
  { id: 500, name: "商业方盒", type: "tile" },
  { id: 501, name: "住宅方盒", type: "tile" },
  { id: 502, name: "工业大盒", type: "tile" },
  { id: 503, name: "郊区小屋", type: "tile" },
];

const ISLAND_LAYERS: NameEntry[] = [
  { id: 3, name: "海岛沙滩", type: "tile" },
  { id: 4, name: "海岛平原", type: "tile" },
  { id: 5, name: "海岛树林", type: "tile" },
  { id: 300, name: "海岛主路", type: "tile" },
  { id: 301, name: "海岛小路", type: "tile" },
  { id: 417, name: "海岛中心区", type: "tile" },
  { id: 418, name: "海岛住宅区", type: "tile" },
  { id: 419, name: "海岛小港区", type: "tile" },
];

function terrainFromHeight(heightMap: Grid, landGrid: Grid): Grid {
  const rows = heightMap.length;
  const cols = heightMap[0]?.length ?? 0;
  const out = makeGrid(rows, cols, 0);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const h = heightMap[y]?.[x] ?? -1;
      if (!landGrid[y]?.[x]) {
        out[y][x] = h >= 0.34 ? 2 : 1;
      } else if (h < 0.50) {
        out[y][x] = 3;
      } else if (h < 0.68) {
        out[y][x] = 4;
      } else if (h < 0.82) {
        out[y][x] = 5;
      } else {
        out[y][x] = 6;
      }
    }
  }
  return out;
}

function overlay(base: Grid, layer: Grid | null): void {
  if (!layer) return;
  for (let y = 0; y < base.length; y++) {
    for (let x = 0; x < (base[0]?.length ?? 0); x++) {
      const v = layer[y]?.[x] ?? 0;
      if (v !== 0) base[y][x] = v;
    }
  }
}

export function worldmapRenderLayers(input: Record<string, unknown>): Record<string, unknown> {
  if (!isGrid(input.heightMap)) return { error: "heightMap is required" };
  if (!isGrid(input.landGrid)) return { error: "landGrid is required" };
  const heightMap = input.heightMap as Grid;
  const landGrid = input.landGrid as Grid;
  const boundaryGrid = isGrid(input.boundaryGrid) ? input.boundaryGrid as Grid : null;
  const cityGrid = isGrid(input.cityGrid) ? input.cityGrid as Grid : null;
  const roadGrid = isGrid(input.roadGrid) ? input.roadGrid as Grid : null;
  const tunnelGrid = isGrid(input.tunnelGrid) ? input.tunnelGrid as Grid : null;
  const harborGrid = isGrid(input.harborGrid) ? input.harborGrid as Grid : null;
  const islandGrid = isGrid(input.islandGrid) ? input.islandGrid as Grid : null;
  const buildingGrid = isGrid(input.buildingGrid) ? input.buildingGrid as Grid : null;
  const parkGrid = isGrid(input.parkGrid) ? input.parkGrid as Grid : null;

  const terrainGrid = terrainFromHeight(heightMap, landGrid);
  const outputNameList = [...TERRAIN];
  const outputGridList: Grid[] = splitValues(terrainGrid, TERRAIN);

  for (const [grid, allowed] of [
    [boundaryGrid, [90, 91]],
    [parkGrid, [413]],
    [roadGrid, [300, 301, 302, 304, 305]],
    [tunnelGrid, [303]],
    [harborGrid, [306, 307, 416]],
    [cityGrid, [200, 201]],
    [buildingGrid, [500, 501, 502, 503]],
  ] as Array<[Grid | null, number[]]>) {
    if (!grid) continue;
    const entries = OVERLAYS.filter(entry => allowed.includes(entry.id) && grid.some(row => row.includes(entry.id)));
    outputGridList.push(...splitValues(grid, entries));
    outputNameList.push(...entries);
  }
  if (islandGrid) {
    const entries = ISLAND_LAYERS.filter(entry => islandGrid.some(row => row.includes(entry.id)));
    outputGridList.push(...splitValues(islandGrid, entries));
    outputNameList.push(...entries);
  }

  const outputGrid = terrainGrid.map(row => row.slice());
  overlay(outputGrid, boundaryGrid);
  overlay(outputGrid, parkGrid);
  overlay(outputGrid, roadGrid);
  overlay(outputGrid, tunnelGrid);
  overlay(outputGrid, harborGrid);
  overlay(outputGrid, islandGrid);
  overlay(outputGrid, cityGrid);
  overlay(outputGrid, buildingGrid);

  return { outputGridList, outputNameList, outputGrid };
}
