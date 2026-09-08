/**
 * rule_indoor_room_doors
 *
 * Phase 1  — Build walls: room cells (>=10) touching corridor (1) → wall (0).
 * Phase 1b — Fix corner notches:
 *            Pass A: wall cell with 3+ same-room 4-neighbours → fill into room.
 *            Pass B: wall cell with 2 perpendicular same-room 4-neighbours,
 *                    NOT adjacent to corridor → fill (inner-corner notch).
 * Phase 1c — Patch corridor notches: a room cell with 2 perpendicular
 *            wall(0) neighbours whose diagonal is corridor(1) forms a
 *            convex step → convert it to wall(0). This smooths the 1-cell
 *            notch left by buildRoomWalls at corridor corners.
 * Phase 2  — Normal rooms: open doorWidth gaps, but ONLY on segments long
 *            enough (>= doorWidth + 2). Door is placed at least 1 cell from
 *            each end of the segment.
 * Phase 3  — Enclosed rooms: open doors into neighbour rooms with same rules.
 * Phase 4  — Fallback BFS for normal rooms still lacking corridor access.
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

const DIRS4: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];

function findRoomIds(grid: number[][], rows: number, cols: number): Set<number> {
  const ids = new Set<number>();
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (grid[r][c] >= 10) ids.add(grid[r][c]);
  return ids;
}

function buildRoomWalls(grid: number[][], rows: number, cols: number): void {
  const toWall: [number, number][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] < 10) continue;
      for (const [dr, dc] of DIRS4) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && grid[nr][nc] === 1) {
          toWall.push([r, c]);
          break;
        }
      }
    }
  }
  for (const [r, c] of toWall) grid[r][c] = 0;
}

function fixCornerNotches(grid: number[][], rows: number, cols: number): void {
  // Pass A: 4-neighbour majority fill (>=3 same-room, not adj corridor)
  let changed = true;
  while (changed) {
    changed = false;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c] !== 0) continue;
        let adjCorridor = false;
        for (const [dr, dc] of DIRS4) {
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && grid[nr][nc] === 1) {
            adjCorridor = true; break;
          }
        }
        if (adjCorridor) continue;
        const counts = new Map<number, number>();
        for (const [dr, dc] of DIRS4) {
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && grid[nr][nc] >= 10) {
            const id = grid[nr][nc];
            counts.set(id, (counts.get(id) || 0) + 1);
          }
        }
        for (const [id, cnt] of counts) {
          if (cnt >= 3) { grid[r][c] = id; changed = true; break; }
        }
      }
    }
  }

  // Pass B: inner-corner notch.
  // A wall cell (0) is a notch when two of its 4-neighbours that are
  // PERPENDICULAR to each other (i.e. not opposite) belong to the same room,
  // AND neither 4-neighbour is a corridor.
  // The four perpendicular pairs: (up,left) (up,right) (down,left) (down,right)
  const perpPairs: [[number,number],[number,number]][] = [
    [[-1, 0], [ 0,-1]],  // up + left
    [[-1, 0], [ 0, 1]],  // up + right
    [[ 1, 0], [ 0,-1]],  // down + left
    [[ 1, 0], [ 0, 1]],  // down + right
  ];

  changed = true;
  while (changed) {
    changed = false;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c] !== 0) continue;

        // Must not be adjacent to corridor
        let adjCorridor = false;
        for (const [dr, dc] of DIRS4) {
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && grid[nr][nc] === 1) {
            adjCorridor = true; break;
          }
        }
        if (adjCorridor) continue;

        // Check each perpendicular pair
        let filled = false;
        for (const [[dr1, dc1], [dr2, dc2]] of perpPairs) {
          const nr1 = r + dr1, nc1 = c + dc1;
          const nr2 = r + dr2, nc2 = c + dc2;
          const v1 = (nr1 >= 0 && nr1 < rows && nc1 >= 0 && nc1 < cols) ? grid[nr1][nc1] : -1;
          const v2 = (nr2 >= 0 && nr2 < rows && nc2 >= 0 && nc2 < cols) ? grid[nr2][nc2] : -1;
          if (v1 >= 10 && v1 === v2) {
            grid[r][c] = v1;
            changed = true;
            filled = true;
            break;
          }
        }
        if (filled) continue;
      }
    }
  }
}

function patchCorridorNotches(grid: number[][], rows: number, cols: number): void {
  const perpPairs: [[number,number],[number,number]][] = [
    [[-1, 0], [ 0,-1]],
    [[-1, 0], [ 0, 1]],
    [[ 1, 0], [ 0,-1]],
    [[ 1, 0], [ 0, 1]],
  ];

  let changed = true;
  while (changed) {
    changed = false;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c] < 10) continue;

        for (const [[dr1, dc1], [dr2, dc2]] of perpPairs) {
          const nr1 = r + dr1, nc1 = c + dc1;
          const nr2 = r + dr2, nc2 = c + dc2;
          if (nr1 < 0 || nr1 >= rows || nc1 < 0 || nc1 >= cols) continue;
          if (nr2 < 0 || nr2 >= rows || nc2 < 0 || nc2 >= cols) continue;
          if (grid[nr1][nc1] !== 0 || grid[nr2][nc2] !== 0) continue;

          const diagR = r + dr1 + dr2, diagC = c + dc1 + dc2;
          if (diagR < 0 || diagR >= rows || diagC < 0 || diagC >= cols) continue;
          if (grid[diagR][diagC] === 1) {
            grid[r][c] = 0;
            changed = true;
            break;
          }
        }
      }
    }
  }
}

interface WallSeg { cells: [number, number][]; }

function buildSegments(wallCells: [number, number][]): WallSeg[] {
  const rawSegs: WallSeg[] = [];
  const byRow = new Map<number, number[]>();
  const byCol = new Map<number, number[]>();
  for (const [r, c] of wallCells) {
    if (!byRow.has(r)) byRow.set(r, []);
    byRow.get(r)!.push(c);
    if (!byCol.has(c)) byCol.set(c, []);
    byCol.get(c)!.push(r);
  }
  for (const [row, cs] of byRow) {
    cs.sort((a, b) => a - b);
    let cur: [number, number][] = [[row, cs[0]]];
    for (let i = 1; i < cs.length; i++) {
      if (cs[i] - cs[i - 1] === 1) { cur.push([row, cs[i]]); }
      else { rawSegs.push({ cells: [...cur] }); cur = [[row, cs[i]]]; }
    }
    rawSegs.push({ cells: [...cur] });
  }
  for (const [col, rs] of byCol) {
    rs.sort((a, b) => a - b);
    let cur: [number, number][] = [[rs[0], col]];
    for (let i = 1; i < rs.length; i++) {
      if (rs[i] - rs[i - 1] === 1) { cur.push([rs[i], col]); }
      else { if (cur.length >= 2) rawSegs.push({ cells: [...cur] }); cur = [[rs[i], col]]; }
    }
    if (cur.length >= 2) rawSegs.push({ cells: [...cur] });
  }
  rawSegs.sort((a, b) => b.cells.length - a.cells.length);
  const usedCells = new Set<string>();
  const deduped: WallSeg[] = [];
  for (const seg of rawSegs) {
    const filtered = seg.cells.filter(([r, c]) => !usedCells.has(`${r},${c}`));
    if (filtered.length === 0) continue;
    for (const [r, c] of filtered) usedCells.add(`${r},${c}`);
    deduped.push({ cells: filtered });
  }
  deduped.sort((a, b) => b.cells.length - a.cells.length);
  return deduped;
}

function findDoorableWalls(
  grid: number[][], rows: number, cols: number, roomId: number
): WallSeg[] {
  const wallCells: [number, number][] = [];
  const seen = new Set<string>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== 0) continue;
      let touchRoom = false, touchCorr = false;
      for (const [dr, dc] of DIRS4) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        if (grid[nr][nc] === roomId) touchRoom = true;
        if (grid[nr][nc] === 1) touchCorr = true;
      }
      if (touchRoom && touchCorr) {
        const k = `${r},${c}`;
        if (!seen.has(k)) { seen.add(k); wallCells.push([r, c]); }
      }
    }
  }
  if (wallCells.length === 0) return [];
  return buildSegments(wallCells);
}

function findSharedWalls(
  grid: number[][], rows: number, cols: number,
  roomId: number, neighborId: number
): WallSeg[] {
  const wallCells: [number, number][] = [];
  const seen = new Set<string>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== 0) continue;
      let touchSelf = false, touchNeighbor = false;
      for (const [dr, dc] of DIRS4) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        if (grid[nr][nc] === roomId) touchSelf = true;
        if (grid[nr][nc] === neighborId) touchNeighbor = true;
      }
      if (touchSelf && touchNeighbor) {
        const k = `${r},${c}`;
        if (!seen.has(k)) { seen.add(k); wallCells.push([r, c]); }
      }
    }
  }
  if (wallCells.length === 0) return [];
  return buildSegments(wallCells);
}

function getNeighborRooms(
  grid: number[][], rows: number, cols: number, roomId: number
): Set<number> {
  const neighbors = new Set<number>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== 0) continue;
      let touchSelf = false;
      const adjRooms: number[] = [];
      for (const [dr, dc] of DIRS4) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        const v = grid[nr][nc];
        if (v === roomId) touchSelf = true;
        else if (v >= 10) adjRooms.push(v);
      }
      if (touchSelf) for (const id of adjRooms) neighbors.add(id);
    }
  }
  return neighbors;
}

function isEnclosedRoom(
  grid: number[][], rows: number, cols: number, roomId: number
): boolean {
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== 0) continue;
      let touchSelf = false, touchCorr = false;
      for (const [dr, dc] of DIRS4) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        if (grid[nr][nc] === roomId) touchSelf = true;
        if (grid[nr][nc] === 1) touchCorr = true;
      }
      if (touchSelf && touchCorr) return false;
    }
  return true;
}

// Open a door in a segment.
// minMargin: minimum cells to keep intact at each end of the segment.
// Returns false if the segment is too short.
function openDoorInSeg(
  grid: number[][], seg: WallSeg, doorWidth: number,
  minMargin: number, rng: () => number, doorValue: number
): boolean {
  const len = seg.cells.length;
  // Segment must be at least doorWidth + 2*minMargin long
  const minLen = doorWidth + 2 * minMargin;
  if (len < minLen) return false;

  const lo = minMargin;
  const hi = len - minMargin - doorWidth;
  const st = lo >= hi ? lo : randInt(rng, lo, hi);
  for (let i = st; i < st + doorWidth; i++) {
    const [wr, wc] = seg.cells[i];
    grid[wr][wc] = doorValue;
  }
  return true;
}

function hasCorridorAccess(
  grid: number[][], rows: number, cols: number, roomId: number
): boolean {
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== roomId) continue;
      for (const [dr, dc] of DIRS4) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && grid[nr][nc] === 1)
          return true;
      }
    }
  return false;
}

function forceDoorBFS(
  grid: number[][], rows: number, cols: number, roomId: number, doorValue: number
): void {
  const visited = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));
  const parent = new Map<number, number>();
  const queue: number[] = [];

  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (grid[r][c] === roomId) {
        const k = r * cols + c;
        visited[r][c] = true;
        queue.push(k);
      }

  let target = -1, head = 0;
  while (head < queue.length && target < 0) {
    const k = queue[head++];
    const r = Math.floor(k / cols), c = k % cols;
    for (const [dr, dc] of DIRS4) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      if (visited[nr][nc]) continue;
      const nk = nr * cols + nc;
      parent.set(nk, k);
      if (grid[nr][nc] === 1) { target = nk; break; }
      if (grid[nr][nc] === 0) { visited[nr][nc] = true; queue.push(nk); }
    }
  }
  if (target < 0) return;

  let cur: number | undefined = target;
  while (cur !== undefined) {
    const r = Math.floor(cur / cols), c = cur % cols;
    if (grid[r][c] === 0) grid[r][c] = doorValue;
    cur = parent.get(cur);
  }
}

export function ruleIndoorRoomDoors(
  input: Record<string, unknown>
): Record<string, unknown> {
  const inputGrid = input.inputGrid as number[][] | undefined;
  if (!inputGrid || !inputGrid.length || !inputGrid[0]?.length)
    return { error: "inputGrid is required" };

  const rows = inputGrid.length, cols = inputGrid[0].length;
  const doorWidth = typeof input.doorWidth === "number"
    ? Math.max(1, Math.min(6, Math.floor(input.doorWidth))) : 3;
  const maxDoorsPerRoom = typeof input.maxDoorsPerRoom === "number"
    ? Math.max(1, Math.floor(input.maxDoorsPerRoom)) : 4;
  const doorProbability = typeof input.doorProbability === "number"
    ? Math.max(0, Math.min(1, input.doorProbability)) : 0.5;
  // Minimum wall cells to keep intact at each end of a segment (margin).
  const doorMargin = 1;
  const doorValue = typeof input.doorValue === "number"
    ? Math.max(2, Math.floor(input.doorValue)) : 2;
  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  const rng = mulberry32(seedRaw === 0 ? Date.now() : seedRaw);

  const outputGrid: number[][] = inputGrid.map(row => [...row]);

  buildRoomWalls(outputGrid, rows, cols);
  fixCornerNotches(outputGrid, rows, cols);
  patchCorridorNotches(outputGrid, rows, cols);

  const roomIds = findRoomIds(outputGrid, rows, cols);

  const enclosedRooms = new Set<number>();
  for (const roomId of roomIds)
    if (isEnclosedRoom(outputGrid, rows, cols, roomId))
      enclosedRooms.add(roomId);

  // Phase 2: normal rooms → doors to corridor
  for (const roomId of roomIds) {
    if (enclosedRooms.has(roomId)) continue;
    const segs = findDoorableWalls(outputGrid, rows, cols, roomId);
    if (segs.length === 0) continue;

    // Try segments in order (longest first); first SUCCESSFUL open is mandatory.
    let openedFirst = false;
    for (let d = 0; d < Math.min(maxDoorsPerRoom, segs.length); d++) {
      if (!openedFirst) {
        if (openDoorInSeg(outputGrid, segs[d], doorWidth, doorMargin, rng, doorValue))
          openedFirst = true;
      } else if (rng() < doorProbability) {
        openDoorInSeg(outputGrid, segs[d], doorWidth, doorMargin, rng, doorValue);
      }
    }
  }

  // Phase 3: enclosed rooms → doors into neighbouring rooms
  for (const roomId of enclosedRooms) {
    const neighbors = Array.from(getNeighborRooms(outputGrid, rows, cols, roomId));
    if (neighbors.length === 0) continue;

    const shuffled = [...neighbors];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    let openedFirst = false;
    for (const neighborId of shuffled) {
      const segs = findSharedWalls(outputGrid, rows, cols, roomId, neighborId);
      if (segs.length === 0) continue;
      if (!openedFirst) {
        if (openDoorInSeg(outputGrid, segs[0], doorWidth, doorMargin, rng, doorValue))
          openedFirst = true;
      } else if (rng() < doorProbability) {
        openDoorInSeg(outputGrid, segs[0], doorWidth, doorMargin, rng, doorValue);
      }
    }
  }

  // Phase 4: fallback BFS for normal rooms still cut off from corridor
  for (const roomId of roomIds) {
    if (enclosedRooms.has(roomId)) continue;
    if (!hasCorridorAccess(outputGrid, rows, cols, roomId))
      forceDoorBFS(outputGrid, rows, cols, roomId, doorValue);
  }

  return { outputGrid };
}
