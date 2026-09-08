/**
 * Core algorithm for complex indoor layout generation.
 * Growth-based approach: start with an initial room, iteratively attach
 * new rooms (direct or via corridor), with contour complexity control
 * and connectivity validation.
 */

// ===== Types =====

export interface Room {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  area: number;
  parentId: number;
  isCorridor: boolean;
}

interface Connection {
  fromId: number;
  toId: number;
  wallCells: [number, number][];
}

type Direction = "up" | "down" | "left" | "right";

interface EdgeSegment {
  direction: Direction;
  cells: [number, number][];
}

export interface LayoutConfig {
  width: number;
  height: number;
  targetRoomCount: number;
  initRoomMinSize: number;
  initRoomMaxSize: number;
  corridorProb: number;
  roomAreaRatioMin: number;
  roomAreaRatioMax: number;
  rareLargeRoomProb: number;
  rareLargeRoomRatioMax: number;
  corridorWidthMin: number;
  corridorWidthMax: number;
  corridorLenMin: number;
  corridorLenMax: number;
  doorWidthMin: number;
  maxAttemptsPerRoom: number;
  silhouetteRMax: number;
  roomMinDim: number;
}

export interface LayoutResult {
  grid: number[][];
  rooms: Room[];
  doorPositions: [number, number][];
}

interface Placement {
  x: number;
  y: number;
  w: number;
  h: number;
  wallCells: [number, number][];
}

interface GrowthResult {
  rooms: Room[];
  connections: Connection[];
}

// ===== RNG =====

function makeLCG(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function randInt(rng: () => number, lo: number, hi: number): number {
  if (lo > hi) {
    const t = lo;
    lo = hi;
    hi = t;
  }
  return Math.floor(rng() * (hi - lo + 1)) + lo;
}

function randFloat(rng: () => number, lo: number, hi: number): number {
  return rng() * (hi - lo) + lo;
}

// ===== Grid helpers =====

function createGrid(w: number, h: number): number[][] {
  return Array.from({ length: h }, () => new Array(w).fill(0));
}

function paintRect(
  grid: number[][],
  x: number,
  y: number,
  w: number,
  h: number,
  val: number
): void {
  for (let ry = y; ry < y + h; ry++)
    for (let rx = x; rx < x + w; rx++) grid[ry][rx] = val;
}

function clearRect(
  grid: number[][],
  x: number,
  y: number,
  w: number,
  h: number
): void {
  paintRect(grid, x, y, w, h, 0);
}

// Checks that all cells inside [x..x+w-1, y..y+h-1] AND the 1-cell
// margin around them are empty (value 0). This enforces a minimum
// 1-cell wall gap between any two rooms.
function canPlaceRect(
  grid: number[][],
  x: number,
  y: number,
  w: number,
  h: number
): boolean {
  const H = grid.length,
    W = grid[0].length;
  for (let ry = y - 1; ry <= y + h; ry++) {
    for (let rx = x - 1; rx <= x + w; rx++) {
      if (ry < 0 || ry >= H || rx < 0 || rx >= W) return false;
      if (grid[ry][rx] !== 0) return false;
    }
  }
  return true;
}

// ===== Edge segment detection =====
// An edge segment is a contiguous run (>= 2 cells) of room boundary cells
// whose adjacent cell in the outward direction is empty.

function findEdgeSegments(grid: number[][], room: Room): EdgeSegment[] {
  const H = grid.length,
    W = grid[0].length;
  const results: EdgeSegment[] = [];

  const flush = (dir: Direction, run: [number, number][]) => {
    if (run.length >= 2) results.push({ direction: dir, cells: [...run] });
  };

  // Top edge
  let run: [number, number][] = [];
  for (let x = room.x; x < room.x + room.w; x++) {
    if (room.y - 1 >= 0 && grid[room.y - 1][x] === 0) run.push([room.y, x]);
    else {
      flush("up", run);
      run = [];
    }
  }
  flush("up", run);

  // Bottom edge
  run = [];
  const botY = room.y + room.h - 1;
  for (let x = room.x; x < room.x + room.w; x++) {
    if (botY + 1 < H && grid[botY + 1][x] === 0) run.push([botY, x]);
    else {
      flush("down", run);
      run = [];
    }
  }
  flush("down", run);

  // Left edge
  run = [];
  for (let y = room.y; y < room.y + room.h; y++) {
    if (room.x - 1 >= 0 && grid[y][room.x - 1] === 0) run.push([y, room.x]);
    else {
      flush("left", run);
      run = [];
    }
  }
  flush("left", run);

  // Right edge
  run = [];
  const rightX = room.x + room.w - 1;
  for (let y = room.y; y < room.y + room.h; y++) {
    if (rightX + 1 < W && grid[y][rightX + 1] === 0) run.push([y, rightX]);
    else {
      flush("right", run);
      run = [];
    }
  }
  flush("right", run);

  return results;
}

function segRange(seg: EdgeSegment): { min: number; max: number } {
  const isH = seg.direction === "up" || seg.direction === "down";
  const vals = seg.cells.map((c) => (isH ? c[1] : c[0]));
  return { min: Math.min(...vals), max: Math.max(...vals) };
}

// ===== Room sizing =====

function genRoomArea(
  parentArea: number,
  cfg: LayoutConfig,
  rng: () => number
): number {
  const roll = rng();
  let ratio: number;
  if (roll < cfg.rareLargeRoomProb) {
    ratio = randFloat(rng, 2.0, cfg.rareLargeRoomRatioMax);
  } else {
    // Skewed distribution: rng()*rng() peaks near 0, producing more small rooms
    const t = rng() * rng();
    ratio = cfg.roomAreaRatioMin + t * (cfg.roomAreaRatioMax - cfg.roomAreaRatioMin);
  }
  return Math.max(cfg.roomMinDim * cfg.roomMinDim, Math.round(parentArea * ratio));
}

function areaToWH(
  area: number,
  minDim: number,
  rng: () => number
): [number, number] {
  const aspect = randFloat(rng, 0.5, 2.0);
  let w = Math.round(Math.sqrt(area * aspect));
  let h = Math.round(area / Math.max(1, w));
  w = Math.max(minDim, Math.min(40, w));
  h = Math.max(minDim, Math.min(40, h));
  return [w, h];
}

// ===== Placement core =====
// Computes position of a new rectangle (depth x breadth) adjacent to parent
// in the given direction, with a 1-cell wall gap. Returns null if invalid.

function computePlacement(
  parent: Room,
  dir: Direction,
  sr: { min: number; max: number },
  depth: number,
  breadth: number,
  gridW: number,
  gridH: number,
  doorMin: number,
  rng: () => number
): Placement | null {
  let nx: number, ny: number, nw: number, nh: number;

  if (dir === "up" || dir === "down") {
    nw = breadth;
    nh = depth;
    const minNX = Math.max(1, sr.min - breadth + doorMin);
    const maxNX = Math.min(gridW - breadth - 1, sr.max - doorMin + 1);
    if (minNX > maxNX) return null;
    nx = randInt(rng, minNX, maxNX);
    ny = dir === "up" ? parent.y - depth - 1 : parent.y + parent.h + 1;
    if (ny < 1 || ny + nh >= gridH - 1) return null;
  } else {
    nw = depth;
    nh = breadth;
    const minNY = Math.max(1, sr.min - breadth + doorMin);
    const maxNY = Math.min(gridH - breadth - 1, sr.max - doorMin + 1);
    if (minNY > maxNY) return null;
    ny = randInt(rng, minNY, maxNY);
    nx = dir === "left" ? parent.x - depth - 1 : parent.x + parent.w + 1;
    if (nx < 1 || nx + nw >= gridW - 1) return null;
  }

  // Compute wall cells at the 1-cell gap between parent and new rect
  const wallCells: [number, number][] = [];
  if (dir === "up") {
    const wy = parent.y - 1;
    const lo = Math.max(nx, sr.min),
      hi = Math.min(nx + nw - 1, sr.max);
    for (let x = lo; x <= hi; x++) wallCells.push([wy, x]);
  } else if (dir === "down") {
    const wy = parent.y + parent.h;
    const lo = Math.max(nx, sr.min),
      hi = Math.min(nx + nw - 1, sr.max);
    for (let x = lo; x <= hi; x++) wallCells.push([wy, x]);
  } else if (dir === "left") {
    const wx = parent.x - 1;
    const lo = Math.max(ny, sr.min),
      hi = Math.min(ny + nh - 1, sr.max);
    for (let y = lo; y <= hi; y++) wallCells.push([y, wx]);
  } else {
    const wx = parent.x + parent.w;
    const lo = Math.max(ny, sr.min),
      hi = Math.min(ny + nh - 1, sr.max);
    for (let y = lo; y <= hi; y++) wallCells.push([y, wx]);
  }

  if (wallCells.length < doorMin) return null;
  return { x: nx, y: ny, w: nw, h: nh, wallCells };
}

// ===== Growth: direct attach =====

function tryDirectAttach(
  grid: number[][],
  parent: Room,
  seg: EdgeSegment,
  nextId: number,
  cfg: LayoutConfig,
  rng: () => number
): GrowthResult | null {
  const area = genRoomArea(parent.area, cfg, rng);
  const [rawW, rawH] = areaToWH(area, cfg.roomMinDim, rng);
  const isH = seg.direction === "up" || seg.direction === "down";
  const breadth = isH ? rawW : rawH;
  const depth = isH ? rawH : rawW;
  const sr = segRange(seg);

  const p = computePlacement(
    parent,
    seg.direction,
    sr,
    depth,
    breadth,
    grid[0].length,
    grid.length,
    cfg.doorWidthMin,
    rng
  );
  if (!p) return null;
  if (!canPlaceRect(grid, p.x, p.y, p.w, p.h)) return null;

  const room: Room = {
    id: nextId,
    x: p.x,
    y: p.y,
    w: p.w,
    h: p.h,
    area: p.w * p.h,
    parentId: parent.id,
    isCorridor: false,
  };
  paintRect(grid, p.x, p.y, p.w, p.h, nextId);

  return {
    rooms: [room],
    connections: [{ fromId: parent.id, toId: nextId, wallCells: p.wallCells }],
  };
}

// ===== Growth: corridor link =====

function farEdgeSegment(room: Room, growDir: Direction): EdgeSegment {
  const cells: [number, number][] = [];
  if (growDir === "up") {
    for (let x = room.x; x < room.x + room.w; x++)
      cells.push([room.y, x]);
    return { direction: "up", cells };
  }
  if (growDir === "down") {
    for (let x = room.x; x < room.x + room.w; x++)
      cells.push([room.y + room.h - 1, x]);
    return { direction: "down", cells };
  }
  if (growDir === "left") {
    for (let y = room.y; y < room.y + room.h; y++)
      cells.push([y, room.x]);
    return { direction: "left", cells };
  }
  for (let y = room.y; y < room.y + room.h; y++)
    cells.push([y, room.x + room.w - 1]);
  return { direction: "right", cells };
}

function tryCorridorLink(
  grid: number[][],
  parent: Room,
  seg: EdgeSegment,
  nextId: number,
  cfg: LayoutConfig,
  rng: () => number
): GrowthResult | null {
  const sr = segRange(seg);
  const segLen = sr.max - sr.min + 1;
  const cBreadth = randInt(
    rng,
    cfg.corridorWidthMin,
    Math.min(segLen, cfg.corridorWidthMax)
  );
  const cDepth = randInt(rng, cfg.corridorLenMin, cfg.corridorLenMax);

  const cp = computePlacement(
    parent,
    seg.direction,
    sr,
    cDepth,
    cBreadth,
    grid[0].length,
    grid.length,
    cfg.doorWidthMin,
    rng
  );
  if (!cp) return null;
  if (!canPlaceRect(grid, cp.x, cp.y, cp.w, cp.h)) return null;

  const corridorId = nextId;
  const corridor: Room = {
    id: corridorId,
    x: cp.x,
    y: cp.y,
    w: cp.w,
    h: cp.h,
    area: cp.w * cp.h,
    parentId: parent.id,
    isCorridor: true,
  };
  paintRect(grid, cp.x, cp.y, cp.w, cp.h, corridorId);

  // Place a room at the far end of the corridor
  const farSeg = farEdgeSegment(corridor, seg.direction);
  if (farSeg.cells.length < cfg.doorWidthMin) {
    clearRect(grid, cp.x, cp.y, cp.w, cp.h);
    return null;
  }

  const area = genRoomArea(parent.area, cfg, rng);
  const [rawW, rawH] = areaToWH(area, cfg.roomMinDim, rng);
  const isH = seg.direction === "up" || seg.direction === "down";
  const rBreadth = isH ? rawW : rawH;
  const rDepth = isH ? rawH : rawW;
  const farSR = segRange(farSeg);

  const rp = computePlacement(
    corridor,
    seg.direction,
    farSR,
    rDepth,
    rBreadth,
    grid[0].length,
    grid.length,
    cfg.doorWidthMin,
    rng
  );
  if (!rp) {
    clearRect(grid, cp.x, cp.y, cp.w, cp.h);
    return null;
  }
  if (!canPlaceRect(grid, rp.x, rp.y, rp.w, rp.h)) {
    clearRect(grid, cp.x, cp.y, cp.w, cp.h);
    return null;
  }

  const roomId = nextId + 1;
  const room: Room = {
    id: roomId,
    x: rp.x,
    y: rp.y,
    w: rp.w,
    h: rp.h,
    area: rp.w * rp.h,
    parentId: corridorId,
    isCorridor: false,
  };
  paintRect(grid, rp.x, rp.y, rp.w, rp.h, roomId);

  return {
    rooms: [corridor, room],
    connections: [
      { fromId: parent.id, toId: corridorId, wallCells: cp.wallCells },
      { fromId: corridorId, toId: roomId, wallCells: rp.wallCells },
    ],
  };
}

// ===== Contour complexity =====
// Counts corners in the building silhouette using 2x2 block scanning.
// A 2x2 block with exactly 1 or 3 occupied cells indicates a corner.

function countCorners(grid: number[][]): number {
  const H = grid.length,
    W = grid[0].length;
  let n = 0;
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const s =
        (grid[y][x] > 0 ? 1 : 0) +
        (grid[y][x + 1] > 0 ? 1 : 0) +
        (grid[y + 1][x] > 0 ? 1 : 0) +
        (grid[y + 1][x + 1] > 0 ? 1 : 0);
      if (s === 1 || s === 3) n++;
    }
  }
  return n;
}

function shouldRejectComplexity(
  grid: number[][],
  roomCount: number,
  cfg: LayoutConfig,
  rng: () => number
): boolean {
  if (roomCount <= 4) return false;
  const r = countCorners(grid) / roomCount;
  if (r <= cfg.silhouetteRMax) return false;
  const excess = (r - cfg.silhouetteRMax) / cfg.silhouetteRMax;
  return rng() < Math.min(0.9, excess * 2);
}

// ===== Connectivity =====

function graphReachable(rooms: Room[], conns: Connection[]): Set<number> {
  const adj = new Map<number, number[]>();
  for (const r of rooms) adj.set(r.id, []);
  for (const c of conns) {
    adj.get(c.fromId)?.push(c.toId);
    adj.get(c.toId)?.push(c.fromId);
  }
  const vis = new Set<number>();
  const q = [rooms[0].id];
  vis.add(rooms[0].id);
  while (q.length > 0) {
    const cur = q.shift()!;
    for (const nb of adj.get(cur) ?? []) {
      if (!vis.has(nb)) {
        vis.add(nb);
        q.push(nb);
      }
    }
  }
  return vis;
}

function carveLine(
  grid: number[][],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  w: number,
  val: number
): void {
  const H = grid.length,
    W = grid[0].length,
    half = Math.floor(w / 2);
  if (y1 === y2) {
    const lo = Math.min(x1, x2),
      hi = Math.max(x1, x2);
    for (let x = lo; x <= hi; x++)
      for (let d = -half; d < w - half; d++) {
        const py = y1 + d;
        if (x >= 1 && x < W - 1 && py >= 1 && py < H - 1 && grid[py][x] === 0)
          grid[py][x] = val;
      }
  } else {
    const lo = Math.min(y1, y2),
      hi = Math.max(y1, y2);
    for (let y = lo; y <= hi; y++)
      for (let d = -half; d < w - half; d++) {
        const px = x1 + d;
        if (px >= 1 && px < W - 1 && y >= 1 && y < H - 1 && grid[y][px] === 0)
          grid[y][px] = val;
      }
  }
}

function repairConnectivity(
  grid: number[][],
  rooms: Room[],
  conns: Connection[],
  nextId: { val: number },
  rng: () => number
): void {
  const reachable = graphReachable(rooms, conns);
  const unreachableRooms = rooms.filter((r) => !reachable.has(r.id));
  if (unreachableRooms.length === 0) return;

  for (const ur of unreachableRooms) {
    const ucx = ur.x + ur.w / 2,
      ucy = ur.y + ur.h / 2;
    let bestDist = Infinity,
      bestRoom: Room | null = null;
    for (const r of rooms) {
      if (!reachable.has(r.id)) continue;
      const d =
        Math.abs(r.x + r.w / 2 - ucx) + Math.abs(r.y + r.h / 2 - ucy);
      if (d < bestDist) {
        bestDist = d;
        bestRoom = r;
      }
    }
    if (!bestRoom) continue;

    const repairId = nextId.val++;
    const ax = Math.floor(ucx),
      ay = Math.floor(ucy);
    const bx = Math.floor(bestRoom.x + bestRoom.w / 2),
      by = Math.floor(bestRoom.y + bestRoom.h / 2);
    carveLine(grid, ax, ay, bx, ay, 2, repairId);
    carveLine(grid, bx, ay, bx, by, 2, repairId);

    rooms.push({
      id: repairId,
      x: Math.min(ax, bx),
      y: Math.min(ay, by),
      w: Math.abs(bx - ax) + 2,
      h: Math.abs(by - ay) + 2,
      area: 0,
      parentId: ur.id,
      isCorridor: true,
    });
    conns.push({ fromId: ur.id, toId: bestRoom.id, wallCells: [] });
    reachable.add(ur.id);
  }
}

// ===== Doors =====

function carveDoors(
  grid: number[][],
  conns: Connection[],
  cfg: LayoutConfig,
  rng: () => number
): [number, number][] {
  const doors: [number, number][] = [];
  for (const conn of conns) {
    const wc = conn.wallCells;
    if (wc.length < cfg.doorWidthMin) continue;
    const dw = randInt(rng, cfg.doorWidthMin, wc.length);
    const start = randInt(rng, 0, wc.length - dw);
    for (let i = start; i < start + dw; i++) {
      doors.push(wc[i]);
    }
  }
  return doors;
}

// ===== Grid connectivity verification =====
// After doors are carved on the output grid, BFS to ensure all walkable
// cells are reachable. If not, punch additional openings.

function verifyAndRepairGridConnectivity(grid: number[][]): void {
  const H = grid.length,
    W = grid[0].length;
  let sy = -1,
    sx = -1;
  for (let y = 0; y < H && sy < 0; y++)
    for (let x = 0; x < W && sy < 0; x++)
      if (grid[y][x] > 0) {
        sy = y;
        sx = x;
      }
  if (sy < 0) return;

  const vis = Array.from({ length: H }, () => new Array(W).fill(false));
  const q: [number, number][] = [[sy, sx]];
  vis[sy][sx] = true;
  while (q.length > 0) {
    const [cy, cx] = q.shift()!;
    for (const [dy, dx] of [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ]) {
      const ny = cy + dy,
        nx = cx + dx;
      if (
        ny >= 0 &&
        ny < H &&
        nx >= 0 &&
        nx < W &&
        !vis[ny][nx] &&
        grid[ny][nx] > 0
      ) {
        vis[ny][nx] = true;
        q.push([ny, nx]);
      }
    }
  }

  // For each unreachable walkable cell, try to open an adjacent wall
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (grid[y][x] > 0 && !vis[y][x]) {
        for (const [dy, dx] of [
          [0, 1],
          [0, -1],
          [1, 0],
          [-1, 0],
        ]) {
          const wy = y + dy,
            wx = x + dx;
          const by = y + dy * 2,
            bx = x + dx * 2;
          if (
            by >= 0 &&
            by < H &&
            bx >= 0 &&
            bx < W &&
            grid[wy][wx] === 0 &&
            grid[by][bx] > 0 &&
            vis[by][bx]
          ) {
            grid[wy][wx] = 3; // door
            vis[y][x] = true;
            vis[wy][wx] = true;
            break;
          }
        }
      }
    }
  }
}

// ===== Main =====

export function generateLayout(cfg: LayoutConfig, seed: number): LayoutResult {
  const rng = makeLCG(seed);
  const grid = createGrid(cfg.width, cfg.height);
  const rooms: Room[] = [];
  const conns: Connection[] = [];
  let nextId = 1;

  // Step 1: Initial room at center
  const iw = randInt(rng, cfg.initRoomMinSize, cfg.initRoomMaxSize);
  const ih = randInt(rng, cfg.initRoomMinSize, cfg.initRoomMaxSize);
  const ix = Math.floor(cfg.width / 2 - iw / 2);
  const iy = Math.floor(cfg.height / 2 - ih / 2);
  const initRoom: Room = {
    id: nextId++,
    x: ix,
    y: iy,
    w: iw,
    h: ih,
    area: iw * ih,
    parentId: -1,
    isCorridor: false,
  };
  paintRect(grid, ix, iy, iw, ih, initRoom.id);
  rooms.push(initRoom);

  // Step 2: Iterative growth
  let realRooms = 1;
  const maxRounds = cfg.targetRoomCount * 4;

  for (let round = 0; round < maxRounds && realRooms < cfg.targetRoomCount; round++) {
    let placed = false;

    for (let att = 0; att < cfg.maxAttemptsPerRoom; att++) {
      const candidates = rooms.filter((r) => !r.isCorridor);
      if (candidates.length === 0) break;
      const parent = candidates[Math.floor(rng() * candidates.length)];

      const segs = findEdgeSegments(grid, parent);
      if (segs.length === 0) continue;
      const seg = segs[Math.floor(rng() * segs.length)];

      const useCorridor = rng() < cfg.corridorProb;
      const result = useCorridor
        ? tryCorridorLink(grid, parent, seg, nextId, cfg, rng)
        : tryDirectAttach(grid, parent, seg, nextId, cfg, rng);
      if (!result) continue;

      // Soft contour complexity check
      const totalCount = rooms.length + result.rooms.length;
      if (shouldRejectComplexity(grid, totalCount, cfg, rng)) {
        for (const r of result.rooms) clearRect(grid, r.x, r.y, r.w, r.h);
        continue;
      }

      for (const r of result.rooms) {
        rooms.push(r);
        if (r.id >= nextId) nextId = r.id + 1;
        if (!r.isCorridor) realRooms++;
      }
      conns.push(...result.connections);
      placed = true;
      break;
    }

    if (!placed && round > cfg.targetRoomCount * 2) break;
  }

  // Step 3: Graph connectivity repair
  const idRef = { val: nextId };
  repairConnectivity(grid, rooms, conns, idRef, rng);
  nextId = idRef.val;

  // Step 4: Carve doors at wall cells between connected rooms
  const doorPos = carveDoors(grid, conns, cfg, rng);

  // Step 5: Remap grid to output values (0=wall, 1=room, 2=corridor, 3=door)
  const roomMap = new Map<number, Room>();
  for (const r of rooms) roomMap.set(r.id, r);
  const doorSet = new Set(doorPos.map(([y, x]) => y * cfg.width + x));

  const outGrid = grid.map((row, y) =>
    row.map((val, x) => {
      if (doorSet.has(y * cfg.width + x)) return 3;
      if (val === 0) return 0;
      const rm = roomMap.get(val);
      if (!rm) return val > 0 ? 2 : 0;
      return rm.isCorridor ? 2 : 1;
    })
  );

  // Step 6: Grid-level connectivity verification and repair
  verifyAndRepairGridConnectivity(outGrid);

  return { grid: outGrid, rooms, doorPositions: doorPos };
}
