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

function bool(input: Record<string, unknown>, key: string, fallback: boolean): boolean {
  return typeof input[key] === "boolean" ? input[key] as boolean : fallback;
}

const NAMES: NameEntry[] = [
  { id: 90, name: "国界", type: "tile" },
  { id: 91, name: "海岸线", type: "tile" },
];

export function worldmapBoundaries(input: Record<string, unknown>): Record<string, unknown> {
  if (!isGrid(input.countryGrid)) return { error: "countryGrid is required" };
  const countryGrid = input.countryGrid as Grid;
  const rows = countryGrid.length;
  const cols = countryGrid[0]?.length ?? 0;
  const includeCoast = bool(input, "includeCoast", true);
  const boundaryGrid = makeGrid(rows, cols, 0);
  const at = (x: number, y: number) => x < 0 || y < 0 || x >= cols || y >= rows ? 0 : countryGrid[y][x];

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const v = countryGrid[y][x];
      if (v <= 0) continue;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const w = at(x + dx, y + dy);
        if (w === v) continue;
        if (w === 0) {
          if (includeCoast) boundaryGrid[y][x] = 91;
        } else {
          boundaryGrid[y][x] = 90;
        }
        if (boundaryGrid[y][x] === 90) break;
      }
    }
  }

  const used = new Set(boundaryGrid.flat().filter(v => v !== 0));
  const outputNameList = NAMES.filter(entry => used.has(entry.id));
  return { boundaryGrid, outputGrid: boundaryGrid, outputNameList };
}
