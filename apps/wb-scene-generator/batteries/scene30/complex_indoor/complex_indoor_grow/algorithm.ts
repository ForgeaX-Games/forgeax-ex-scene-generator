/**
 * Core growth algorithm for complex indoor layout.
 * Wall-outline model: each room has 1-cell wall border + interior.
 * When rooms attach, their walls overlap (share 1 row/col of wall).
 * 80% direct attach (rooms share wall), 20% corridor link.
 * Supports irregular (L-shaped) rooms that fill gaps.
 */

// ===== Types =====

export type Direction = "up" | "down" | "left" | "right";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RoomEntry {
  id: number;
  rects: Rect[];
  innerArea: number;
  parentId: number;
  isCorridor: boolean;
}

export interface Connection {
  roomA: number;
  roomB: number;
  sharedWallCells: [number, number][];
}

interface EdgeSegment {
  direction: Direction;
  cells: [number, number][];
  roomId: number;
}

export interface GrowConfig {
  targetRoomCount: number;
  corridorProb: number;
  areaRatioMin: number;
  areaRatioMax: number;
  rareLargeProb: number;
  rareLargeMax: number;
  corridorWidthMin: number;
  corridorWidthMax: number;
  corridorLenMin: number;
  corridorLenMax: number;
  irregularProb: number;
  silhouetteRMax: number;
  maxAttempts: number;
  roomMinDim: number;
}

// ===== RNG =====

export function makeLCG(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export function randInt(rng: () => number, lo: number, hi: number): number {
  if (lo > hi) { const t = lo; lo = hi; hi = t; }
  return Math.floor(rng() * (hi - lo + 1)) + lo;
}

export function randFloat(rng: () => number, lo: number, hi: number): number {
  return rng() * (hi - lo) + lo;
}

// ===== Grid helpers =====

function rows(grid: number[][]): number { return grid.length; }
function cols(grid: number[][]): number { return grid[0].length; }

function inBounds(grid: number[][], y: number, x: number): boolean {
  return y >= 0 && y < rows(grid) && x >= 0 && x < cols(grid);
}

/**
 * Paint a room rectangle: border as wall(1), interior as roomId.
 * If a cell is already wall(1) from another room, that's fine (shared wall).
 */
function paintRoomRect(
  grid: number[][],
  ox: number, oy: number, ow: number, oh: number,
  roomId: number
): void {
  for (let ry = oy; ry < oy + oh; ry++) {
    for (let rx = ox; rx < ox + ow; rx++) {
      if (!inBounds(grid, ry, rx)) continue;
      const isBorder = ry === oy || ry === oy + oh - 1 || rx === ox || rx === ox + ow - 1;
      if (isBorder) {
        if (grid[ry][rx] === 0) grid[ry][rx] = 1;
      } else {
        grid[ry][rx] = roomId;
      }
    }
  }
}

/**
 * Check if an outer rect can be placed. The rect itself must only overlap
 * void(0) or wall(1) cells. Additionally, the interior cells (1-cell inset)
 * must ALL be void(0) — we don't allow overlapping another room's interior.
 * The 1-row/col overlap with parent wall is expected and allowed.
 */
function canPlaceOuterRect(
  grid: number[][],
  ox: number, oy: number, ow: number, oh: number
): boolean {
  if (ow < 3 || oh < 3) return false;
  if (ox < 0 || oy < 0 || ox + ow > cols(grid) || oy + oh > rows(grid)) return false;
  for (let ry = oy; ry < oy + oh; ry++) {
    for (let rx = ox; rx < ox + ow; rx++) {
      const v = grid[ry][rx];
      const isBorder = ry === oy || ry === oy + oh - 1 || rx === ox || rx === ox + ow - 1;
      if (isBorder) {
        if (v !== 0 && v !== 1) return false;
      } else {
        if (v !== 0) return false;
      }
    }
  }
  return true;
}

// ===== Edge segment detection =====

/**
 * For a given room, find wall cells (value=1) that belong to the room's
 * outer rects and face void(0) in the outward direction.
 * Groups consecutive cells into edge segments.
 */
function findEdgeSegments(
  grid: number[][],
  room: RoomEntry
): EdgeSegment[] {
  const wallSet = new Set<string>();
  for (const r of room.rects) {
    for (let ry = r.y; ry < r.y + r.h; ry++) {
      for (let rx = r.x; rx < r.x + r.w; rx++) {
        const isBorder = ry === r.y || ry === r.y + r.h - 1 || rx === r.x || rx === r.x + r.w - 1;
        if (isBorder && inBounds(grid, ry, rx) && grid[ry][rx] === 1) {
          wallSet.add(`${ry},${rx}`);
        }
      }
    }
  }

  const dirs: { d: Direction; dy: number; dx: number }[] = [
    { d: "up", dy: -1, dx: 0 },
    { d: "down", dy: 1, dx: 0 },
    { d: "left", dy: 0, dx: -1 },
    { d: "right", dy: 0, dx: 1 },
  ];

  const candidates: { d: Direction; y: number; x: number }[] = [];
  for (const key of wallSet) {
    const [cy, cx] = key.split(",").map(Number);
    for (const { d, dy, dx } of dirs) {
      const ny = cy + dy;
      const nx = cx + dx;
      if (inBounds(grid, ny, nx) && grid[ny][nx] === 0) {
        candidates.push({ d, y: cy, x: cx });
      }
    }
  }

  const grouped = new Map<string, [number, number][]>();
  for (const c of candidates) {
    const key = c.d;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push([c.y, c.x]);
  }

  const results: EdgeSegment[] = [];
  for (const [dir, cells] of grouped) {
    const isH = dir === "up" || dir === "down";
    cells.sort((a, b) => isH ? (a[0] - b[0] || a[1] - b[1]) : (a[1] - b[1] || a[0] - b[0]));

    let run: [number, number][] = [cells[0]];
    for (let i = 1; i < cells.length; i++) {
      const prev = run[run.length - 1];
      const cur = cells[i];
      const isConsecutive = isH
        ? (cur[0] === prev[0] && cur[1] === prev[1] + 1)
        : (cur[1] === prev[1] && cur[0] === prev[0] + 1);
      if (isConsecutive) {
        run.push(cur);
      } else {
        if (run.length >= 2) results.push({ direction: dir as Direction, cells: [...run], roomId: room.id });
        run = [cur];
      }
    }
    if (run.length >= 2) results.push({ direction: dir as Direction, cells: [...run], roomId: room.id });
  }

  return results;
}

// ===== Room area generation =====

function genRoomArea(
  parentArea: number,
  cfg: GrowConfig,
  rng: () => number
): number {
  const roll = rng();
  let ratio: number;
  if (roll < cfg.rareLargeProb) {
    ratio = randFloat(rng, 2.0, cfg.rareLargeMax);
  } else {
    const t = rng() * rng();
    ratio = cfg.areaRatioMin + t * (cfg.areaRatioMax - cfg.areaRatioMin);
  }
  const minArea = cfg.roomMinDim * cfg.roomMinDim;
  return Math.max(minArea, Math.round(parentArea * ratio));
}

function areaToInnerWH(
  area: number,
  minDim: number,
  rng: () => number
): [number, number] {
  const aspect = randFloat(rng, 0.5, 2.0);
  let w = Math.round(Math.sqrt(area * aspect));
  let h = Math.round(area / Math.max(1, w));
  w = Math.max(minDim, w);
  h = Math.max(minDim, h);
  return [w, h];
}

// ===== Contour complexity =====

function countCorners(grid: number[][]): number {
  let corners = 0;
  for (let y = 0; y < rows(grid) - 1; y++) {
    for (let x = 0; x < cols(grid) - 1; x++) {
      let occupied = 0;
      if (grid[y][x] !== 0) occupied++;
      if (grid[y][x + 1] !== 0) occupied++;
      if (grid[y + 1][x] !== 0) occupied++;
      if (grid[y + 1][x + 1] !== 0) occupied++;
      if (occupied === 1 || occupied === 3) corners++;
    }
  }
  return corners;
}

function shouldRejectComplexity(
  grid: number[][],
  roomCount: number,
  maxRatio: number
): boolean {
  if (roomCount <= 3) return false;
  const c = countCorners(grid);
  return c / roomCount > maxRatio;
}

// ===== Placement computation =====

/**
 * Compute placement for a new outer rect adjacent to a parent via an edge segment.
 * The new rect's wall overlaps the parent's wall by 1 row/col.
 * Returns the outer rect position and the shared wall cells.
 */
function computeAttachPlacement(
  seg: EdgeSegment,
  outerW: number, outerH: number,
  rng: () => number
): { rect: Rect; sharedWallCells: [number, number][] } | null {
  const dir = seg.direction;
  const isH = dir === "up" || dir === "down";

  const segCoords = seg.cells;

  const attachDim = isH ? outerW : outerH;

  const segMin = isH
    ? Math.min(...segCoords.map(c => c[1]))
    : Math.min(...segCoords.map(c => c[0]));
  const segMax = isH
    ? Math.max(...segCoords.map(c => c[1]))
    : Math.max(...segCoords.map(c => c[0]));

  const fixedCoord = isH ? segCoords[0][0] : segCoords[0][1];

  // Allow the new room to extend beyond the segment.
  // Require at least 2 cells of overlap between the new room's interior
  // and the segment range.
  const rangeStart = segMin - (attachDim - 2);
  const rangeEnd = segMax;

  if (rangeEnd < rangeStart) return null;

  const attachStart = randInt(rng, rangeStart, rangeEnd);

  let ox: number, oy: number;
  if (dir === "up") {
    ox = attachStart;
    oy = fixedCoord - outerH + 1;
  } else if (dir === "down") {
    ox = attachStart;
    oy = fixedCoord;
  } else if (dir === "left") {
    oy = attachStart;
    ox = fixedCoord - outerW + 1;
  } else {
    oy = attachStart;
    ox = fixedCoord;
  }

  const sharedWallCells: [number, number][] = [];
  if (dir === "up" || dir === "down") {
    const wallY = fixedCoord;
    const overlapStart = Math.max(ox + 1, segMin);
    const overlapEnd = Math.min(ox + outerW - 2, segMax);
    for (let wx = overlapStart; wx <= overlapEnd; wx++) {
      sharedWallCells.push([wallY, wx]);
    }
  } else {
    const wallX = fixedCoord;
    const overlapStart = Math.max(oy + 1, segMin);
    const overlapEnd = Math.min(oy + outerH - 2, segMax);
    for (let wy = overlapStart; wy <= overlapEnd; wy++) {
      sharedWallCells.push([wy, wallX]);
    }
  }

  if (sharedWallCells.length < 2) return null;

  return { rect: { x: ox, y: oy, w: outerW, h: outerH }, sharedWallCells };
}

// ===== Irregular room extension =====

/**
 * Try to extend a placed room into an adjacent void gap,
 * creating an L-shaped room by adding a second sub-rect.
 */
function tryIrregularExtension(
  grid: number[][],
  baseRect: Rect,
  roomId: number,
  maxExtraArea: number,
  rng: () => number,
  minDim: number
): Rect | null {
  const dirs: Direction[] = ["up", "down", "left", "right"];
  const shuffled = dirs.sort(() => rng() - 0.5);

  for (const dir of shuffled) {
    let scanRects: Rect[] = [];
    if (dir === "right") {
      const extW = randInt(rng, minDim + 2, Math.min(minDim + 8, Math.round(Math.sqrt(maxExtraArea))));
      const extH = randInt(rng, minDim + 2, Math.min(baseRect.h - 2, Math.round(maxExtraArea / extW) + 2));
      if (extH < minDim + 2) continue;
      const maxOff = baseRect.h - extH;
      if (maxOff < 0) continue;
      const offY = randInt(rng, 0, maxOff);
      scanRects.push({ x: baseRect.x + baseRect.w - 1, y: baseRect.y + offY, w: extW, h: extH });
    } else if (dir === "left") {
      const extW = randInt(rng, minDim + 2, Math.min(minDim + 8, Math.round(Math.sqrt(maxExtraArea))));
      const extH = randInt(rng, minDim + 2, Math.min(baseRect.h - 2, Math.round(maxExtraArea / extW) + 2));
      if (extH < minDim + 2) continue;
      const maxOff = baseRect.h - extH;
      if (maxOff < 0) continue;
      const offY = randInt(rng, 0, maxOff);
      scanRects.push({ x: baseRect.x - extW + 1, y: baseRect.y + offY, w: extW, h: extH });
    } else if (dir === "down") {
      const extH = randInt(rng, minDim + 2, Math.min(minDim + 8, Math.round(Math.sqrt(maxExtraArea))));
      const extW = randInt(rng, minDim + 2, Math.min(baseRect.w - 2, Math.round(maxExtraArea / extH) + 2));
      if (extW < minDim + 2) continue;
      const maxOff = baseRect.w - extW;
      if (maxOff < 0) continue;
      const offX = randInt(rng, 0, maxOff);
      scanRects.push({ x: baseRect.x + offX, y: baseRect.y + baseRect.h - 1, w: extW, h: extH });
    } else {
      const extH = randInt(rng, minDim + 2, Math.min(minDim + 8, Math.round(Math.sqrt(maxExtraArea))));
      const extW = randInt(rng, minDim + 2, Math.min(baseRect.w - 2, Math.round(maxExtraArea / extH) + 2));
      if (extW < minDim + 2) continue;
      const maxOff = baseRect.w - extW;
      if (maxOff < 0) continue;
      const offX = randInt(rng, 0, maxOff);
      scanRects.push({ x: baseRect.x + offX, y: baseRect.y - extH + 1, w: extW, h: extH });
    }

    for (const ext of scanRects) {
      if (canPlaceOuterRectAllowShared(grid, ext.x, ext.y, ext.w, ext.h, roomId)) {
        return ext;
      }
    }
  }
  return null;
}

/**
 * Like canPlaceOuterRect but also allows cells that already belong to roomId.
 * Used for extensions that overlap with the base rect of the same room.
 */
function canPlaceOuterRectAllowShared(
  grid: number[][],
  ox: number, oy: number, ow: number, oh: number,
  allowId: number
): boolean {
  if (ow < 3 || oh < 3) return false;
  if (ox < 0 || oy < 0 || ox + ow > cols(grid) || oy + oh > rows(grid)) return false;
  for (let ry = oy; ry < oy + oh; ry++) {
    for (let rx = ox; rx < ox + ow; rx++) {
      const v = grid[ry][rx];
      const isBorder = ry === oy || ry === oy + oh - 1 || rx === ox || rx === ox + ow - 1;
      if (isBorder) {
        if (v !== 0 && v !== 1 && v !== allowId) return false;
      } else {
        if (v !== 0 && v !== allowId) return false;
      }
    }
  }
  return true;
}

// ===== Main growth loop =====

function roomCenter(room: RoomEntry): [number, number] {
  let sy = 0, sx = 0, n = 0;
  for (const r of room.rects) {
    sy += r.y + r.h / 2;
    sx += r.x + r.w / 2;
    n++;
  }
  return n > 0 ? [sy / n, sx / n] : [0, 0];
}

function selectParentBiased(rooms: RoomEntry[], rng: () => number): RoomEntry {
  if (rooms.length <= 2) return rooms[randInt(rng, 0, rooms.length - 1)];

  let centY = 0, centX = 0;
  for (const r of rooms) {
    const [cy, cx] = roomCenter(r);
    centY += cy; centX += cx;
  }
  centY /= rooms.length;
  centX /= rooms.length;

  const dists = rooms.map(r => {
    const [cy, cx] = roomCenter(r);
    return Math.abs(cy - centY) + Math.abs(cx - centX);
  });
  const maxDist = Math.max(...dists, 1);
  const weights = dists.map(d => maxDist - d + 1);
  const total = weights.reduce((a, b) => a + b, 0);
  let pick = rng() * total;
  for (let i = 0; i < rooms.length; i++) {
    pick -= weights[i];
    if (pick <= 0) return rooms[i];
  }
  return rooms[rooms.length - 1];
}

export function growRooms(
  grid: number[][],
  initialRoomList: RoomEntry[],
  startId: number,
  cfg: GrowConfig,
  rng: () => number
): { roomList: RoomEntry[]; connectionList: Connection[]; nextRoomId: number } {
  const roomList: RoomEntry[] = [...initialRoomList];
  const connectionList: Connection[] = [];
  let nextId = startId;

  const getNonCorridorRooms = () => roomList.filter(r => !r.isCorridor);

  let roomCount = getNonCorridorRooms().length;
  let totalAttempts = 0;
  const maxTotalAttempts = cfg.targetRoomCount * cfg.maxAttempts * 3;

  while (roomCount < cfg.targetRoomCount && totalAttempts < maxTotalAttempts) {
    totalAttempts++;

    const nonCorridorRooms = getNonCorridorRooms();
    const parent = selectParentBiased(nonCorridorRooms, rng);
    const segments = findEdgeSegments(grid, parent);
    if (segments.length === 0) continue;

    const seg = segments[randInt(rng, 0, segments.length - 1)];
    const useCorridor = rng() < cfg.corridorProb;

    if (useCorridor) {
      const placed = tryCorridorLink(grid, parent, seg, nextId, cfg, rng);
      if (placed) {
        roomList.push(placed.corridor, placed.room);
        connectionList.push(placed.connParentCorridor, placed.connCorridorRoom);
        nextId = placed.nextId;
        roomCount++;
        if (shouldRejectComplexity(grid, roomCount, cfg.silhouetteRMax)) {
          undoRoom(grid, placed.room);
          undoRoom(grid, placed.corridor);
          roomList.pop();
          roomList.pop();
          connectionList.pop();
          connectionList.pop();
          nextId = placed.corridor.id;
          roomCount--;
        }
      }
    } else {
      const placed = tryDirectAttach(grid, parent, seg, nextId, cfg, rng);
      if (placed) {
        roomList.push(placed.room);
        connectionList.push(placed.connection);
        nextId = placed.nextId;
        roomCount++;
        if (shouldRejectComplexity(grid, roomCount, cfg.silhouetteRMax)) {
          undoRoom(grid, placed.room);
          roomList.pop();
          connectionList.pop();
          nextId = placed.room.id;
          roomCount--;
        }
      }
    }
  }

  return { roomList, connectionList, nextRoomId: nextId };
}

function undoRoom(grid: number[][], room: RoomEntry): void {
  for (const r of room.rects) {
    for (let ry = r.y; ry < r.y + r.h; ry++) {
      for (let rx = r.x; rx < r.x + r.w; rx++) {
        if (inBounds(grid, ry, rx)) {
          const v = grid[ry][rx];
          if (v === room.id) grid[ry][rx] = 0;
          if (v === 1) {
            const isBorder = ry === r.y || ry === r.y + r.h - 1 || rx === r.x || rx === r.x + r.w - 1;
            if (isBorder) {
              let hasOtherNeighbor = false;
              for (const [dy, dx] of [[-1,0],[1,0],[0,-1],[0,1]]) {
                const ny = ry+dy, nx = rx+dx;
                if (inBounds(grid, ny, nx) && grid[ny][nx] > 1) {
                  hasOtherNeighbor = true;
                  break;
                }
              }
              if (!hasOtherNeighbor) grid[ry][rx] = 0;
            }
          }
        }
      }
    }
  }
}

// ===== Direct attach =====

function tryDirectAttach(
  grid: number[][],
  parent: RoomEntry,
  seg: EdgeSegment,
  nextId: number,
  cfg: GrowConfig,
  rng: () => number
): { room: RoomEntry; connection: Connection; nextId: number } | null {
  for (let attempt = 0; attempt < cfg.maxAttempts; attempt++) {
    const area = genRoomArea(parent.innerArea, cfg, rng);
    const [innerW, innerH] = areaToInnerWH(area, cfg.roomMinDim, rng);
    const outerW = innerW + 2;
    const outerH = innerH + 2;

    const placement = computeAttachPlacement(seg, outerW, outerH, rng);
    if (!placement) continue;

    const { rect, sharedWallCells } = placement;
    if (!canPlaceOuterRect(grid, rect.x, rect.y, rect.w, rect.h)) continue;
    if (sharedWallCells.length < 2) continue;

    const roomId = nextId;
    paintRoomRect(grid, rect.x, rect.y, rect.w, rect.h, roomId);

    const rects: Rect[] = [rect];
    let totalInner = (rect.w - 2) * (rect.h - 2);

    if (rng() < cfg.irregularProb) {
      const ext = tryIrregularExtension(
        grid, rect, roomId,
        Math.round(totalInner * 0.6), rng, cfg.roomMinDim
      );
      if (ext) {
        paintRoomRect(grid, ext.x, ext.y, ext.w, ext.h, roomId);
        rects.push(ext);
        totalInner += (ext.w - 2) * (ext.h - 2);
      }
    }

    const room: RoomEntry = {
      id: roomId,
      rects,
      innerArea: totalInner,
      parentId: parent.id,
      isCorridor: false,
    };

    return {
      room,
      connection: { roomA: parent.id, roomB: roomId, sharedWallCells },
      nextId: nextId + 1,
    };
  }
  return null;
}

// ===== Corridor link =====

function tryCorridorLink(
  grid: number[][],
  parent: RoomEntry,
  seg: EdgeSegment,
  nextId: number,
  cfg: GrowConfig,
  rng: () => number
): {
  corridor: RoomEntry;
  room: RoomEntry;
  connParentCorridor: Connection;
  connCorridorRoom: Connection;
  nextId: number;
} | null {
  const isH = seg.direction === "up" || seg.direction === "down";
  const segLen = seg.cells.length;

  const maxCorridorW = Math.min(cfg.corridorWidthMax, segLen);
  if (maxCorridorW < cfg.corridorWidthMin) return null;

  const corridorBreadth = randInt(rng, cfg.corridorWidthMin, maxCorridorW);
  const corridorLength = randInt(rng, cfg.corridorLenMin, cfg.corridorLenMax);

  const cOuterW = isH ? corridorBreadth + 2 : corridorLength + 2;
  const cOuterH = isH ? corridorLength + 2 : corridorBreadth + 2;

  for (let attempt = 0; attempt < cfg.maxAttempts; attempt++) {
    const cPlace = computeAttachPlacement(seg, cOuterW, cOuterH, rng);
    if (!cPlace) continue;
    if (!canPlaceOuterRect(grid, cPlace.rect.x, cPlace.rect.y, cPlace.rect.w, cPlace.rect.h)) continue;
    if (cPlace.sharedWallCells.length < 2) continue;

    const corridorId = nextId;
    paintRoomRect(grid, cPlace.rect.x, cPlace.rect.y, cPlace.rect.w, cPlace.rect.h, corridorId);

    const corridorEntry: RoomEntry = {
      id: corridorId,
      rects: [cPlace.rect],
      innerArea: (cPlace.rect.w - 2) * (cPlace.rect.h - 2),
      parentId: parent.id,
      isCorridor: true,
    };

    const farSegs = findEdgeSegments(grid, corridorEntry);
    const oppDir: Direction =
      seg.direction === "up" ? "up" :
      seg.direction === "down" ? "down" :
      seg.direction === "left" ? "left" : "right";
    const farCandidates = farSegs.filter(s => s.direction === oppDir);

    if (farCandidates.length === 0) {
      undoRoom(grid, corridorEntry);
      continue;
    }

    const farSeg = farCandidates[randInt(rng, 0, farCandidates.length - 1)];

    const area = genRoomArea(parent.innerArea, cfg, rng);
    const [innerW, innerH] = areaToInnerWH(area, cfg.roomMinDim, rng);
    const rOuterW = innerW + 2;
    const rOuterH = innerH + 2;

    let roomPlaced = false;
    let roomEntry: RoomEntry | null = null;
    let connCR: Connection | null = null;

    for (let ra = 0; ra < 10; ra++) {
      const rPlace = computeAttachPlacement(farSeg, rOuterW, rOuterH, rng);
      if (!rPlace) continue;
      if (!canPlaceOuterRect(grid, rPlace.rect.x, rPlace.rect.y, rPlace.rect.w, rPlace.rect.h)) continue;
      if (rPlace.sharedWallCells.length < 2) continue;

      const roomId = nextId + 1;
      paintRoomRect(grid, rPlace.rect.x, rPlace.rect.y, rPlace.rect.w, rPlace.rect.h, roomId);

      roomEntry = {
        id: roomId,
        rects: [rPlace.rect],
        innerArea: (rPlace.rect.w - 2) * (rPlace.rect.h - 2),
        parentId: corridorId,
        isCorridor: false,
      };

      connCR = { roomA: corridorId, roomB: roomId, sharedWallCells: rPlace.sharedWallCells };
      roomPlaced = true;
      break;
    }

    if (!roomPlaced || !roomEntry || !connCR) {
      undoRoom(grid, corridorEntry);
      continue;
    }

    return {
      corridor: corridorEntry,
      room: roomEntry,
      connParentCorridor: { roomA: parent.id, roomB: corridorId, sharedWallCells: cPlace.sharedWallCells },
      connCorridorRoom: connCR,
      nextId: nextId + 2,
    };
  }
  return null;
}
