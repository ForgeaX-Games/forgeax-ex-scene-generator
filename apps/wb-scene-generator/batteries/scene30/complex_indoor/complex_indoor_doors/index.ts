/**
 * complex_indoor_doors
 * Carves doors through shared walls between connected rooms.
 * This is the ONLY step where doors appear — all room placement
 * must be complete before this battery runs.
 */

function makeLCG(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function randInt(rng: () => number, lo: number, hi: number): number {
  if (lo > hi) { const t = lo; lo = hi; hi = t; }
  return Math.floor(rng() * (hi - lo + 1)) + lo;
}

export function complexIndoorDoors(
  input: Record<string, unknown>
): Record<string, unknown> {
  const inputGrid = input.inputGrid as number[][] | undefined;
  if (!inputGrid || inputGrid.length === 0) return { error: "inputGrid is required" };

  const grid = inputGrid.map(row => [...row]);
  const H = grid.length;
  const W = grid[0].length;

  const roomListRaw = input.roomList as any[] | undefined;
  const connectionListRaw = input.connectionList as any[] | undefined;
  const doorWidthMin = typeof input.doorWidthMin === "number" ? Math.max(2, input.doorWidthMin) : 2;
  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  const seed = seedRaw === 0 ? Date.now() : seedRaw;
  const rng = makeLCG(seed);

  let maxVal = 1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (grid[y][x] > maxVal) maxVal = grid[y][x];
    }
  }
  const doorVal = maxVal + 1;

  const doorWidthMax = typeof input.doorWidthMax === "number" ? input.doorWidthMax : 6;

  if (Array.isArray(connectionListRaw)) {
    for (const conn of connectionListRaw) {
      const cells = conn.sharedWallCells as [number, number][] | undefined;
      if (!cells || cells.length === 0) {
        tryFindAndCarveDoor(grid, conn.roomA as number, conn.roomB as number, doorVal, doorWidthMin, doorWidthMax, rng, H, W);
        continue;
      }

      const validCells = cells.filter(
        ([cy, cx]) => cy >= 0 && cy < H && cx >= 0 && cx < W && grid[cy][cx] === 1
      );
      if (validCells.length === 0) {
        tryFindAndCarveDoor(grid, conn.roomA as number, conn.roomB as number, doorVal, doorWidthMin, doorWidthMax, rng, H, W);
        continue;
      }

      const sortedCells = sortWallCells(validCells);
      const segments = splitIntoContiguousSegments(sortedCells);

      let carved = false;
      for (const seg of segments) {
        const w = carveDoorInSegment(grid, seg, doorVal, doorWidthMin, doorWidthMax, rng);
        if (w > 0) { carved = true; break; }
      }
      if (!carved && segments.length > 0) {
        carveDoorInSegment(grid, segments[0], doorVal, 1, doorWidthMax, rng);
      }
    }
  }

  verifyGridConnectivity(grid, doorVal, H, W);

  const usedVals = new Set<number>();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (grid[y][x] !== 0) usedVals.add(grid[y][x]);
    }
  }

  const nameList: { id: number; name: string }[] = [
    { id: 0, name: "空地" },
  ];

  if (usedVals.has(1)) nameList.push({ id: 1, name: "墙壁" });

  const roomMap = new Map<number, any>();
  if (Array.isArray(roomListRaw)) {
    for (const r of roomListRaw) roomMap.set(r.id as number, r);
  }

  const sortedVals = [...usedVals].sort((a, b) => a - b);
  for (const v of sortedVals) {
    if (v === 1) continue;
    if (v === doorVal) {
      nameList.push({ id: v, name: "门" });
    } else {
      const room = roomMap.get(v);
      if (room && room.isCorridor) {
        nameList.push({ id: v, name: `走廊${v}` });
      } else {
        nameList.push({ id: v, name: `房间${v}` });
      }
    }
  }

  return {
    outputGrid: grid,
    nameList,
  };
}

function sortWallCells(cells: [number, number][]): [number, number][] {
  return cells.slice().sort((a, b) => a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]);
}

function splitIntoContiguousSegments(sorted: [number, number][]): [number, number][][] {
  if (sorted.length === 0) return [];
  const segments: [number, number][][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const dy = Math.abs(cur[0] - prev[0]);
    const dx = Math.abs(cur[1] - prev[1]);
    if ((dy === 1 && dx === 0) || (dy === 0 && dx === 1)) {
      segments[segments.length - 1].push(cur);
    } else {
      segments.push([cur]);
    }
  }
  segments.sort((a, b) => b.length - a.length);
  return segments;
}

/**
 * Carves a door of appropriate width in a contiguous wall segment.
 * Always leaves at least 1 wall cell on each end of the segment (when possible).
 * Returns the actual door width carved (0 if segment too short).
 */
function carveDoorInSegment(
  grid: number[][],
  seg: [number, number][],
  doorVal: number,
  minW: number, maxW: number,
  rng: () => number,
): number {
  const len = seg.length;
  if (len < minW) return 0;

  // Leave at least 1 wall cell on each end when segment is long enough
  const availableForDoor = len >= minW + 2 ? len - 2 : len;
  const doorWidth = Math.min(availableForDoor, Math.max(minW, randInt(rng, minW, Math.min(maxW, availableForDoor))));
  const margin = len >= minW + 2 ? 1 : 0;
  const range = len - doorWidth - margin * 2;
  const startIdx = margin + (range <= 0 ? 0 : randInt(rng, 0, range));

  for (let i = startIdx; i < startIdx + doorWidth; i++) {
    const [dy, dx] = seg[i];
    grid[dy][dx] = doorVal;
  }
  return doorWidth;
}

function tryFindAndCarveDoor(
  grid: number[][],
  roomA: number, roomB: number,
  doorVal: number, doorWidthMin: number, doorWidthMax: number,
  rng: () => number,
  H: number, W: number
): void {
  const wallCells: [number, number][] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (grid[y][x] !== 1) continue;
      let touchA = false, touchB = false;
      for (const [dy, dx] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const ny = y + dy, nx = x + dx;
        if (ny >= 0 && ny < H && nx >= 0 && nx < W) {
          if (grid[ny][nx] === roomA) touchA = true;
          if (grid[ny][nx] === roomB) touchB = true;
        }
      }
      if (touchA && touchB) wallCells.push([y, x]);
    }
  }

  if (wallCells.length === 0) return;

  const sorted = sortWallCells(wallCells);
  const segments = splitIntoContiguousSegments(sorted);

  for (const seg of segments) {
    if (carveDoorInSegment(grid, seg, doorVal, doorWidthMin, doorWidthMax, rng) > 0) return;
  }

  if (segments.length > 0) {
    carveDoorInSegment(grid, segments[0], doorVal, 1, doorWidthMax, rng);
  }
}

function verifyGridConnectivity(
  grid: number[][],
  doorVal: number,
  H: number, W: number
): void {
  const visited: boolean[][] = Array.from({ length: H }, () => new Array(W).fill(false));

  let startY = -1, startX = -1;
  outer: for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (grid[y][x] > 1) { startY = y; startX = x; break outer; }
    }
  }
  if (startY < 0) return;

  const queue: [number, number][] = [[startY, startX]];
  visited[startY][startX] = true;
  const mainComponent = new Set<string>();
  mainComponent.add(`${startY},${startX}`);

  while (queue.length > 0) {
    const [cy, cx] = queue.shift()!;
    for (const [dy, dx] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const ny = cy + dy, nx = cx + dx;
      if (ny >= 0 && ny < H && nx >= 0 && nx < W && !visited[ny][nx] && grid[ny][nx] > 1) {
        visited[ny][nx] = true;
        queue.push([ny, nx]);
        mainComponent.add(`${ny},${nx}`);
      }
    }
  }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (grid[y][x] > 1 && !visited[y][x]) {
        for (const [dy, dx] of [[-1,0],[1,0],[0,-1],[0,1]]) {
          const ny = y + dy, nx = x + dx;
          if (ny >= 0 && ny < H && nx >= 0 && nx < W && grid[ny][nx] === 1) {
            for (const [dy2, dx2] of [[-1,0],[1,0],[0,-1],[0,1]]) {
              const ny2 = ny + dy2, nx2 = nx + dx2;
              if (ny2 >= 0 && ny2 < H && nx2 >= 0 && nx2 < W && mainComponent.has(`${ny2},${nx2}`)) {
                grid[ny][nx] = doorVal;
                visited[y][x] = true;
                mainComponent.add(`${y},${x}`);
                break;
              }
            }
            if (visited[y][x]) break;
          }
        }
      }
    }
  }
}
