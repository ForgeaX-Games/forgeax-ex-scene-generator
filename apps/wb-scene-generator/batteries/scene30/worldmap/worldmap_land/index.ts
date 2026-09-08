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

const NAMES: NameEntry[] = [
  { id: 1, name: "海洋", type: "tile" },
  { id: 2, name: "海岸", type: "tile" },
  { id: 3, name: "陆地", type: "tile" },
];

function smoothLand(grid: Grid, iterations: number, birthLimit: number): Grid {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  let cells = grid.map(row => row.map(v => (v ? 1 : 0)));
  const at = (g: Grid, x: number, y: number) => x < 0 || y < 0 || x >= cols || y >= rows ? 0 : g[y][x];
  for (let it = 0; it < iterations; it++) {
    const next = cells.map(row => row.slice());
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx !== 0 || dy !== 0) n += at(cells, x + dx, y + dy) ? 1 : 0;
          }
        }
        next[y][x] = n >= birthLimit ? 1 : n <= 8 - birthLimit ? 0 : cells[y][x];
      }
    }
    cells = next;
  }
  return cells;
}

function preview(landGrid: Grid): Grid {
  const rows = landGrid.length;
  const cols = landGrid[0]?.length ?? 0;
  const out = makeGrid(rows, cols, 1);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!landGrid[y][x]) continue;
      let coast = false;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !landGrid[ny][nx]) coast = true;
      }
      out[y][x] = coast ? 2 : 3;
    }
  }
  return out;
}

export function worldmapLand(input: Record<string, unknown>): Record<string, unknown> {
  if (!isGrid(input.heightMap)) return { error: "heightMap is required" };
  const heightMap = input.heightMap as Grid;
  const seaLevel = clamp(num(input, "seaLevel", 0.48), 0, 1);
  const iterations = clamp(int(input, "iterations", 3), 0, 10);
  const birthLimit = clamp(int(input, "birthLimit", 5), 1, 8);
  const initial = heightMap.map(row => row.map(h => (h >= seaLevel ? 1 : 0)));
  const landGrid = smoothLand(initial, iterations, birthLimit);
  const outputGrid = preview(landGrid);
  return { landGrid, outputGrid, outputNameList: NAMES };
}
