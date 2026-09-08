/**
 * rule_indoor_room_slice
 * Finds connected room zones (value=2) and recursively slices them into
 * individual rooms by cutting perpendicular to each zone's long axis.
 * Assigns unique IDs (10+) to each resulting room.
 *
 * Input:  inputGrid (grid) — 0=exterior/wall, 1=corridor, 2=room zone
 * Output: outputGrid (grid) — 0=wall, 1=corridor, 10+=room IDs
 */

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, lo: number, hi: number): number {
  return Math.floor(rng() * (hi - lo + 1)) + lo;
}

interface BBox {
  minR: number; maxR: number; minC: number; maxC: number;
}

function floodFillValue(
  grid: number[][], rows: number, cols: number,
  visited: boolean[][], startR: number, startC: number, target: number
): [number, number][] {
  const cells: [number, number][] = [];
  const queue: [number, number][] = [[startR, startC]];
  visited[startR][startC] = true;
  let head = 0;
  while (head < queue.length) {
    const [r, c] = queue[head++];
    cells.push([r, c]);
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !visited[nr][nc] && grid[nr][nc] === target) {
        visited[nr][nc] = true;
        queue.push([nr, nc]);
      }
    }
  }
  return cells;
}

function getCellBBox(cells: [number, number][]): BBox {
  let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
  for (const [r, c] of cells) {
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    if (c < minC) minC = c;
    if (c > maxC) maxC = c;
  }
  return { minR, maxR, minC, maxC };
}

interface SliceResult {
  rooms: [number, number][][];
}

function recursiveSlice(
  grid: number[][], rows: number, cols: number,
  zoneCells: [number, number][], zoneValue: number,
  minSize: number, maxSize: number, wallThickness: number,
  rng: () => number, depth: number
): [number, number][][] {
  const bbox = getCellBBox(zoneCells);
  const bboxH = bbox.maxR - bbox.minR + 1;
  const bboxW = bbox.maxC - bbox.minC + 1;

  if (bboxH <= maxSize && bboxW <= maxSize) {
    return [zoneCells];
  }

  if (bboxH < minSize * 2 + wallThickness && bboxW < minSize * 2 + wallThickness) {
    return [zoneCells];
  }

  const cutHorizontal = bboxH >= bboxW;

  if (cutHorizontal) {
    if (bboxH < minSize * 2 + wallThickness) return [zoneCells];

    const cutMin = bbox.minR + minSize;
    const cutMax = bbox.maxR - minSize - wallThickness + 1;
    if (cutMin > cutMax) return [zoneCells];

    const cutRow = randInt(rng, cutMin, cutMax);

    const cellSetA: [number, number][] = [];
    const cellSetB: [number, number][] = [];

    for (const [r, c] of zoneCells) {
      if (r < cutRow) {
        cellSetA.push([r, c]);
      } else if (r >= cutRow + wallThickness) {
        cellSetB.push([r, c]);
      } else {
        grid[r][c] = 0;
      }
    }

    if (cellSetA.length < minSize * minSize || cellSetB.length < minSize * minSize) {
      for (const [r, c] of zoneCells) {
        if (r >= cutRow && r < cutRow + wallThickness) {
          grid[r][c] = zoneValue;
        }
      }
      return [zoneCells];
    }

    const roomsA = recursiveSlice(grid, rows, cols, cellSetA, zoneValue, minSize, maxSize, wallThickness, rng, depth + 1);
    const roomsB = recursiveSlice(grid, rows, cols, cellSetB, zoneValue, minSize, maxSize, wallThickness, rng, depth + 1);
    return [...roomsA, ...roomsB];
  } else {
    if (bboxW < minSize * 2 + wallThickness) return [zoneCells];

    const cutMin = bbox.minC + minSize;
    const cutMax = bbox.maxC - minSize - wallThickness + 1;
    if (cutMin > cutMax) return [zoneCells];

    const cutCol = randInt(rng, cutMin, cutMax);

    const cellSetA: [number, number][] = [];
    const cellSetB: [number, number][] = [];

    for (const [r, c] of zoneCells) {
      if (c < cutCol) {
        cellSetA.push([r, c]);
      } else if (c >= cutCol + wallThickness) {
        cellSetB.push([r, c]);
      } else {
        grid[r][c] = 0;
      }
    }

    if (cellSetA.length < minSize * minSize || cellSetB.length < minSize * minSize) {
      for (const [r, c] of zoneCells) {
        if (c >= cutCol && c < cutCol + wallThickness) {
          grid[r][c] = zoneValue;
        }
      }
      return [zoneCells];
    }

    const roomsA = recursiveSlice(grid, rows, cols, cellSetA, zoneValue, minSize, maxSize, wallThickness, rng, depth + 1);
    const roomsB = recursiveSlice(grid, rows, cols, cellSetB, zoneValue, minSize, maxSize, wallThickness, rng, depth + 1);
    return [...roomsA, ...roomsB];
  }
}

export function ruleIndoorRoomSlice(
  input: Record<string, unknown>
): Record<string, unknown> {
  const inputGrid = input.inputGrid as number[][] | undefined;
  if (!inputGrid || inputGrid.length === 0 || !inputGrid[0] || inputGrid[0].length === 0) {
    return { error: "inputGrid is required" };
  }

  const rows = inputGrid.length;
  const cols = inputGrid[0].length;
  const minRoomSize = typeof input.minRoomSize === "number" ? Math.max(3, Math.floor(input.minRoomSize)) : 8;
  const maxRoomSize = typeof input.maxRoomSize === "number" ? Math.max(minRoomSize + 1, Math.floor(input.maxRoomSize)) : 25;
  const wallThickness = typeof input.wallThickness === "number" ? Math.max(1, Math.min(2, Math.floor(input.wallThickness))) : 1;
  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  const baseSeed = seedRaw === 0 ? Date.now() : seedRaw;
  const rng = mulberry32(baseSeed);

  const outputGrid: number[][] = inputGrid.map(row => [...row]);

  const visited = Array.from({ length: rows }, () => new Array(cols).fill(false));
  const zones: [number, number][][] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (outputGrid[r][c] === 2 && !visited[r][c]) {
        zones.push(floodFillValue(outputGrid, rows, cols, visited, r, c, 2));
      }
    }
  }

  let nextRoomId = 10;

  for (const zone of zones) {
    const rooms = recursiveSlice(outputGrid, rows, cols, zone, 2, minRoomSize, maxRoomSize, wallThickness, rng, 0);

    for (const roomCells of rooms) {
      const reVisited = Array.from({ length: rows }, () => new Array(cols).fill(false));
      const subComponents: [number, number][][] = [];

      for (const [r, c] of roomCells) {
        if (outputGrid[r][c] === 2 && !reVisited[r][c]) {
          subComponents.push(floodFillValue(outputGrid, rows, cols, reVisited, r, c, 2));
        }
      }

      for (const comp of subComponents) {
        if (comp.length < 4) {
          for (const [r, c] of comp) outputGrid[r][c] = 0;
          continue;
        }
        const roomId = nextRoomId++;
        for (const [r, c] of comp) {
          outputGrid[r][c] = roomId;
        }
      }
    }
  }

  return { outputGrid };
}
