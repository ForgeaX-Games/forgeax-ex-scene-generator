/**
 * corridor_connect: Connect rooms in an existing grid using L/Z-shaped corridors.
 * Builds MST (Kruskal) over room centers for base connectivity,
 * optionally adds extra edges for loops, then carves corridors.
 * Input:  grid, corridorWidth, corridorValue, extraEdgeRatio, shape, seed
 * Output: grid, corridorGrid, connections, numConnections
 */

interface RoomCenter {
  id: number;
  cx: number;
  cy: number;
}

interface Edge {
  from: number;
  to: number;
  dist: number;
}

class LCG {
  private s: bigint;
  constructor(seed: number) {
    this.s = BigInt(seed > 0 ? seed : 48271);
  }
  next(): bigint {
    this.s =
      (this.s * 6364136223846793005n + 1442695040888963407n) &
      0xffffffffffffffffn;
    return this.s;
  }
  float01(): number {
    return Number((this.next() >> 33n) % 1000000n) / 1000000;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// --- Union-Find ---

function ufInit(n: number): { parent: number[]; rank: number[] } {
  const parent = Array.from({ length: n }, (_, i) => i);
  const rank = new Array(n).fill(0);
  return { parent, rank };
}

function ufFind(parent: number[], x: number): number {
  while (parent[x] !== x) {
    parent[x] = parent[parent[x]];
    x = parent[x];
  }
  return x;
}

function ufUnion(parent: number[], rank: number[], a: number, b: number): boolean {
  const ra = ufFind(parent, a);
  const rb = ufFind(parent, b);
  if (ra === rb) return false;
  if (rank[ra] < rank[rb]) {
    parent[ra] = rb;
  } else if (rank[ra] > rank[rb]) {
    parent[rb] = ra;
  } else {
    parent[rb] = ra;
    rank[ra]++;
  }
  return true;
}

// --- Room extraction ---

function extractRooms(grid: number[][]): RoomCenter[] {
  const rows = grid.length;
  const cols = grid[0].length;
  const acc = new Map<number, { sumX: number; sumY: number; count: number }>();

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = grid[r][c];
      if (v <= 0) continue;
      let entry = acc.get(v);
      if (!entry) {
        entry = { sumX: 0, sumY: 0, count: 0 };
        acc.set(v, entry);
      }
      entry.sumX += c;
      entry.sumY += r;
      entry.count++;
    }
  }

  const rooms: RoomCenter[] = [];
  for (const [id, data] of acc) {
    rooms.push({
      id,
      cx: Math.round(data.sumX / data.count),
      cy: Math.round(data.sumY / data.count),
    });
  }
  rooms.sort((a, b) => a.id - b.id);
  return rooms;
}

// --- MST + extra edges ---

function buildEdges(rooms: RoomCenter[]): Edge[] {
  const edges: Edge[] = [];
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const dx = rooms[i].cx - rooms[j].cx;
      const dy = rooms[i].cy - rooms[j].cy;
      edges.push({ from: i, to: j, dist: Math.sqrt(dx * dx + dy * dy) });
    }
  }
  edges.sort((a, b) => a.dist - b.dist);
  return edges;
}

function selectEdges(
  rooms: RoomCenter[],
  edges: Edge[],
  extraRatio: number,
  rng: LCG,
): Edge[] {
  const n = rooms.length;
  if (n <= 1) return [];

  const { parent, rank } = ufInit(n);
  const mst: Edge[] = [];
  const rest: Edge[] = [];

  for (const e of edges) {
    if (ufUnion(parent, rank, e.from, e.to)) {
      mst.push(e);
    } else {
      rest.push(e);
    }
  }

  const extraCount = Math.floor(rest.length * clamp(extraRatio, 0, 1));
  // Shuffle rest and pick first extraCount
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rng.float01() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  const selected = mst.concat(rest.slice(0, extraCount));
  return selected;
}

// --- Corridor carving ---

function carveLine(
  corridorGrid: number[][],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  halfW: number,
  rows: number,
  cols: number,
): void {
  if (y0 === y1) {
    // Horizontal
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    for (let x = minX; x <= maxX; x++) {
      for (let d = -halfW; d <= halfW; d++) {
        const ry = y0 + d;
        if (ry >= 0 && ry < rows && x >= 0 && x < cols) {
          corridorGrid[ry][x] = 1;
        }
      }
    }
  } else {
    // Vertical
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    for (let y = minY; y <= maxY; y++) {
      for (let d = -halfW; d <= halfW; d++) {
        const rx = x0 + d;
        if (rx >= 0 && rx < cols && y >= 0 && y < rows) {
          corridorGrid[y][rx] = 1;
        }
      }
    }
  }
}

function carveL(
  corridorGrid: number[][],
  ax: number,
  ay: number,
  bx: number,
  by: number,
  halfW: number,
  rows: number,
  cols: number,
  variant: boolean,
): void {
  if (variant) {
    // Horizontal first, then vertical
    carveLine(corridorGrid, ax, ay, bx, ay, halfW, rows, cols);
    carveLine(corridorGrid, bx, ay, bx, by, halfW, rows, cols);
  } else {
    // Vertical first, then horizontal
    carveLine(corridorGrid, ax, ay, ax, by, halfW, rows, cols);
    carveLine(corridorGrid, ax, by, bx, by, halfW, rows, cols);
  }
}

function carveZ(
  corridorGrid: number[][],
  ax: number,
  ay: number,
  bx: number,
  by: number,
  halfW: number,
  rows: number,
  cols: number,
  rng: LCG,
): void {
  // Z-shape: two horizontal segments connected by a vertical segment at midX
  // or two vertical segments connected by a horizontal segment at midY
  const useHorizontalFirst = Math.abs(bx - ax) >= Math.abs(by - ay);

  if (useHorizontalFirst) {
    const midX = Math.round((ax + bx) / 2 + (rng.float01() - 0.5) * Math.abs(bx - ax) * 0.4);
    carveLine(corridorGrid, ax, ay, midX, ay, halfW, rows, cols);
    carveLine(corridorGrid, midX, ay, midX, by, halfW, rows, cols);
    carveLine(corridorGrid, midX, by, bx, by, halfW, rows, cols);
  } else {
    const midY = Math.round((ay + by) / 2 + (rng.float01() - 0.5) * Math.abs(by - ay) * 0.4);
    carveLine(corridorGrid, ax, ay, ax, midY, halfW, rows, cols);
    carveLine(corridorGrid, ax, midY, bx, midY, halfW, rows, cols);
    carveLine(corridorGrid, bx, midY, bx, by, halfW, rows, cols);
  }
}

export function corridorConnect(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const srcGrid = input.grid as number[][] | undefined;
  if (!Array.isArray(srcGrid) || srcGrid.length === 0) {
    return { error: "grid is required" };
  }

  const rows = srcGrid.length;
  const cols = srcGrid[0].length;
  const corridorWidth = clamp(Math.floor(Number(input.corridorWidth) || 1), 1, 5);
  const corridorValueRaw = typeof input.corridorValue === "number" ? input.corridorValue : -1;
  const extraEdgeRatio = clamp(Number(input.extraEdgeRatio) ?? 0.15, 0, 1);
  const shape = typeof input.shape === "string" ? input.shape : "random";
  const seed = Math.floor(Number(input.seed) || 0);

  const rng = new LCG(seed);
  const halfW = Math.floor(corridorWidth / 2);

  const rooms = extractRooms(srcGrid);
  if (rooms.length < 2) {
    // Nothing to connect — return original grid
    const corridorGrid = Array.from({ length: rows }, () => new Array(cols).fill(0));
    return { grid: srcGrid, corridorGrid, connections: [], numConnections: 0 };
  }

  const allEdges = buildEdges(rooms);
  const selected = selectEdges(rooms, allEdges, extraEdgeRatio, rng);

  const corridorGrid: number[][] = Array.from({ length: rows }, () =>
    new Array(cols).fill(0),
  );

  const connections: { from: number; to: number }[] = [];

  for (const edge of selected) {
    const a = rooms[edge.from];
    const b = rooms[edge.to];

    let useShape = shape;
    if (useShape === "random") {
      useShape = rng.float01() < 0.5 ? "L" : "Z";
    }

    if (useShape === "Z") {
      carveZ(corridorGrid, a.cx, a.cy, b.cx, b.cy, halfW, rows, cols, rng);
    } else {
      const variant = rng.float01() < 0.5;
      carveL(corridorGrid, a.cx, a.cy, b.cx, b.cy, halfW, rows, cols, variant);
    }

    connections.push({ from: a.id, to: b.id });
  }

  // Remove corridor cells that overlap with rooms
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (corridorGrid[r][c] === 1 && srcGrid[r][c] !== 0) {
        corridorGrid[r][c] = 0;
      }
    }
  }

  // Determine corridor fill value: -1 → use max room ID + 1
  const maxRoomId = rooms.reduce((mx, r) => Math.max(mx, r.id), 0);
  const fillVal = corridorValueRaw === -1 ? maxRoomId + 1 : corridorValueRaw;

  // Compose output grid: copy source, overlay corridors where source is 0
  const outGrid: number[][] = srcGrid.map((row) => row.slice());
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (corridorGrid[r][c] === 1) {
        outGrid[r][c] = fillVal;
      }
    }
  }

  return {
    grid: outGrid,
    corridorGrid,
    connections,
    numConnections: connections.length,
  };
}
