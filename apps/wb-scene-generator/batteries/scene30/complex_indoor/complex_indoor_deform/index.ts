/**
 * complex_indoor_deform
 * Post-growth battery that extends rectangular rooms into adjacent void
 * pockets, creating L/T/U-shaped irregular rooms. This dramatically
 * reduces gaps and increases layout compactness.
 *
 * Algorithm per room (with probability deformProb):
 *  1. Find wall edges facing void (not shared with another room)
 *  2. Group into contiguous segments
 *  3. Probe void depth beyond each segment
 *  4. Paint a rectangular extension (wall border + room interior)
 *  5. Convert the old shared wall to room interior (merging the spaces)
 *  6. Detect new adjacencies created by the extension
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

const VOID = 0;
const WALL = 1;

type Direction = "up" | "down" | "left" | "right";

interface EdgeSeg {
  dir: Direction;
  wallCells: [number, number][];
}

interface ExtResult {
  rect: { x: number; y: number; w: number; h: number };
  addedInnerArea: number;
  newConnections: { roomA: number; roomB: number; sharedWallCells: [number, number][] }[];
}

export function complexIndoorDeform(
  input: Record<string, unknown>
): Record<string, unknown> {
  const inputGrid = input.inputGrid as number[][] | undefined;
  if (!inputGrid || inputGrid.length === 0) return { error: "inputGrid is required" };

  const grid = inputGrid.map(row => [...row]);
  const H = grid.length;
  const W = grid[0].length;

  const roomListRaw = input.roomList as any[] | undefined;
  const roomList = Array.isArray(roomListRaw)
    ? roomListRaw.map((r: any) => ({ ...r, rects: Array.isArray(r.rects) ? [...r.rects] : [] }))
    : [];

  const connListRaw = input.connectionList as any[] | undefined;
  const connectionList = Array.isArray(connListRaw) ? connListRaw.map((c: any) => ({ ...c })) : [];

  const deformProb = typeof input.deformProb === "number" ? input.deformProb : 0.5;
  const maxExtPerRoom = typeof input.maxExtPerRoom === "number" ? input.maxExtPerRoom : 2;
  const minExtDim = typeof input.minExtDim === "number" ? input.minExtDim : 2;
  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  const seed = seedRaw === 0 ? Date.now() : seedRaw;
  const rng = makeLCG(seed);

  const shuffled = [...roomList].sort(() => rng() - 0.5);

  for (const room of shuffled) {
    if (room.isCorridor) continue;
    if (rng() >= deformProb) continue;

    for (let ext = 0; ext < maxExtPerRoom; ext++) {
      const result = tryExtendRoom(grid, room.id as number, H, W, rng, minExtDim);
      if (result) {
        room.rects.push(result.rect);
        room.innerArea = ((room.innerArea as number) || 0) + result.addedInnerArea;
        for (const nc of result.newConnections) {
          connectionList.push(nc);
        }
      }
    }
  }

  return { outputGrid: grid, roomList, connectionList };
}

function tryExtendRoom(
  grid: number[][], roomId: number, H: number, W: number,
  rng: () => number, minDim: number
): ExtResult | null {
  const segs = findExpandableEdges(grid, roomId, H, W);
  if (segs.length === 0) return null;

  segs.sort(() => rng() - 0.5);

  for (const seg of segs) {
    const r = tryExtendFromSegment(grid, roomId, seg, H, W, rng, minDim);
    if (r) return r;
  }
  return null;
}

/**
 * Find contiguous wall segments on the room boundary that face void
 * and are NOT shared with another room.
 */
function findExpandableEdges(
  grid: number[][], roomId: number, H: number, W: number
): EdgeSeg[] {
  const dirVecs: [Direction, number, number][] = [
    ["up", -1, 0], ["down", 1, 0], ["left", 0, -1], ["right", 0, 1]
  ];

  const results: EdgeSeg[] = [];

  for (const [dir, dy, dx] of dirVecs) {
    const wallSet = new Set<string>();
    const wallCells: [number, number][] = [];

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (grid[y][x] !== roomId) continue;

        const wy = y + dy, wx = x + dx;
        if (wy < 0 || wy >= H || wx < 0 || wx >= W) continue;
        if (grid[wy][wx] !== WALL) continue;

        let shared = false;
        for (const [ny, nx] of [[wy - 1, wx], [wy + 1, wx], [wy, wx - 1], [wy, wx + 1]]) {
          if (ny >= 0 && ny < H && nx >= 0 && nx < W && grid[ny][nx] > WALL && grid[ny][nx] !== roomId) {
            shared = true;
            break;
          }
        }
        if (shared) continue;

        const vy = wy + dy, vx = wx + dx;
        if (vy < 0 || vy >= H || vx < 0 || vx >= W) continue;
        if (grid[vy][vx] !== VOID) continue;

        const key = `${wy},${wx}`;
        if (!wallSet.has(key)) {
          wallSet.add(key);
          wallCells.push([wy, wx]);
        }
      }
    }

    if (wallCells.length < 2) continue;

    const isH = dir === "up" || dir === "down";
    wallCells.sort((a, b) => isH ? a[1] - b[1] : a[0] - b[0]);

    let cur: [number, number][] = [wallCells[0]];
    for (let i = 1; i < wallCells.length; i++) {
      const prev = wallCells[i - 1];
      const c = wallCells[i];
      const diff = isH ? c[1] - prev[1] : c[0] - prev[0];
      if (diff === 1) {
        cur.push(c);
      } else {
        if (cur.length >= 2) results.push({ dir, wallCells: cur });
        cur = [c];
      }
    }
    if (cur.length >= 2) results.push({ dir, wallCells: cur });
  }

  results.sort((a, b) => b.wallCells.length - a.wallCells.length);
  return results;
}

function tryExtendFromSegment(
  grid: number[][], roomId: number, seg: EdgeSeg,
  H: number, W: number, rng: () => number, minDim: number
): ExtResult | null {
  const { dir, wallCells } = seg;
  const isH = dir === "up" || dir === "down";
  const dy = dir === "up" ? -1 : dir === "down" ? 1 : 0;
  const dx = dir === "left" ? -1 : dir === "right" ? 1 : 0;

  const segLen = wallCells.length;
  const extWidth = Math.max(minDim, randInt(rng, Math.max(minDim, Math.floor(segLen * 0.3)), segLen));
  const startIdx = segLen - extWidth <= 0 ? 0 : randInt(rng, 0, segLen - extWidth);
  const selected = wallCells.slice(startIdx, startIdx + extWidth);

  // Probe max void depth beyond the wall cells
  let maxDepth = 0;
  for (let d = 1; d <= 25; d++) {
    let ok = true;
    for (const [wy, wx] of selected) {
      const py = wy + dy * d, px = wx + dx * d;
      if (py < 0 || py >= H || px < 0 || px >= W || grid[py][px] !== VOID) {
        ok = false;
        break;
      }
    }
    if (ok) maxDepth = d;
    else break;
  }

  // Need at least minDim interior depth + 1 for far wall
  if (maxDepth < minDim + 1) return null;

  const innerDepth = randInt(rng, minDim, maxDepth - 1);

  // Compute outer extension rectangle
  let rx: number, ry: number, rw: number, rh: number;

  if (isH) {
    const minWx = selected[0][1];
    const maxWx = selected[selected.length - 1][1];
    const wallY = selected[0][0];

    rx = minWx - 1;
    rw = (maxWx - minWx + 1) + 2;

    if (dir === "up") {
      ry = wallY - innerDepth - 1;
      rh = innerDepth + 2;
    } else {
      ry = wallY;
      rh = innerDepth + 2;
    }
  } else {
    const minWy = selected[0][0];
    const maxWy = selected[selected.length - 1][0];
    const wallX = selected[0][1];

    ry = minWy - 1;
    rh = (maxWy - minWy + 1) + 2;

    if (dir === "left") {
      rx = wallX - innerDepth - 1;
      rw = innerDepth + 2;
    } else {
      rx = wallX;
      rw = innerDepth + 2;
    }
  }

  if (rx < 0 || ry < 0 || rx + rw > W || ry + rh > H) return null;

  // Validate: border cells allow VOID/WALL/roomId; interior cells allow only VOID/roomId
  for (let y = ry; y < ry + rh; y++) {
    for (let x = rx; x < rx + rw; x++) {
      const v = grid[y][x];
      const border = y === ry || y === ry + rh - 1 || x === rx || x === rx + rw - 1;
      if (border) {
        if (v !== VOID && v !== WALL && v !== roomId) return null;
      } else {
        if (v !== VOID && v !== roomId) return null;
      }
    }
  }

  // === Paint ===
  for (let y = ry; y < ry + rh; y++) {
    for (let x = rx; x < rx + rw; x++) {
      const border = y === ry || y === ry + rh - 1 || x === rx || x === rx + rw - 1;
      if (border) {
        if (grid[y][x] === VOID) grid[y][x] = WALL;
      } else {
        grid[y][x] = roomId;
      }
    }
  }

  // Convert old wall between room and extension → room interior
  for (const [wy, wx] of selected) {
    if (grid[wy][wx] === WALL) grid[wy][wx] = roomId;
  }

  // === Detect new adjacencies ===
  const newConnections: ExtResult["newConnections"] = [];
  const touchedRooms = new Map<number, [number, number][]>();

  for (let y = ry; y < ry + rh; y++) {
    for (let x = rx; x < rx + rw; x++) {
      if (grid[y][x] !== WALL) continue;
      for (const [ny, nx] of [[y - 1, x], [y + 1, x], [y, x - 1], [y, x + 1]]) {
        if (ny >= 0 && ny < H && nx >= 0 && nx < W) {
          const v = grid[ny][nx];
          if (v > WALL && v !== roomId) {
            if (!touchedRooms.has(v)) touchedRooms.set(v, []);
            touchedRooms.get(v)!.push([y, x]);
          }
        }
      }
    }
  }

  for (const [otherId, walls] of touchedRooms) {
    const sharedWalls: [number, number][] = [];
    const seen = new Set<string>();
    for (const [wy, wx] of walls) {
      const key = `${wy},${wx}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let touchesRoom = false;
      for (const [ny, nx] of [[wy - 1, wx], [wy + 1, wx], [wy, wx - 1], [wy, wx + 1]]) {
        if (ny >= 0 && ny < H && nx >= 0 && nx < W && grid[ny][nx] === roomId) {
          touchesRoom = true;
          break;
        }
      }
      if (touchesRoom) sharedWalls.push([wy, wx]);
    }
    if (sharedWalls.length > 0) {
      newConnections.push({ roomA: roomId, roomB: otherId, sharedWallCells: sharedWalls });
    }
  }

  const addedInnerArea = Math.max(0, (rw - 2) * (rh - 2));

  return { rect: { x: rx, y: ry, w: rw, h: rh }, addedInnerArea, newConnections };
}
