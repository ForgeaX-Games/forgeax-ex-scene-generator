/**
 * 房间走廊漫步 (room_corridor_walk)
 * Alternately places rectangular rooms and corridors in a random walk,
 * with optional branching. Inspired by Terraria-style dungeon generation.
 * Self-contained — no external imports.
 */

interface RoomInfo {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  centerX: number;
  centerY: number;
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
  intn(n: number): number {
    if (n <= 0) return 0;
    return Number((this.next() >> 33n) % BigInt(n));
  }
  float01(): number {
    return Number((this.next() >> 33n) % 1000000n) / 1000000;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function shuffle(arr: number[], rng: LCG): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.intn(i + 1);
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
}

// 0=right, 1=down, 2=left, 3=up
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

function canPlaceRoom(
  roomGrid: number[][],
  x: number,
  y: number,
  w: number,
  h: number,
  gridW: number,
  gridH: number,
  padding: number,
): boolean {
  const x0 = x - padding;
  const y0 = y - padding;
  const x1 = x + w + padding;
  const y1 = y + h + padding;
  if (x0 < 0 || y0 < 0 || x1 > gridW || y1 > gridH) return false;
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      if (roomGrid[py][px] !== 0) return false;
    }
  }
  return true;
}

function canPlaceCorridor(
  roomGrid: number[][],
  corridorGrid: number[][],
  cells: { x: number; y: number }[],
  gridW: number,
  gridH: number,
): boolean {
  for (const c of cells) {
    if (c.x < 0 || c.x >= gridW || c.y < 0 || c.y >= gridH) return false;
    if (roomGrid[c.y][c.x] !== 0 || corridorGrid[c.y][c.x] !== 0)
      return false;
  }
  return true;
}

/**
 * Compute corridor cells and the position for the new room given a source
 * room, direction, corridor length, and new room dimensions.
 */
function computePlacement(
  src: RoomInfo,
  dir: number,
  corrLen: number,
  halfCW: number,
  newW: number,
  newH: number,
): { cells: { x: number; y: number }[]; roomX: number; roomY: number } {
  const cells: { x: number; y: number }[] = [];
  let roomX = 0;
  let roomY = 0;

  if (dir === 0) {
    const sx = src.x + src.w;
    const cy = src.centerY;
    for (let x = sx; x < sx + corrLen; x++)
      for (let dy = -halfCW; dy <= halfCW; dy++)
        cells.push({ x, y: cy + dy });
    roomX = sx + corrLen;
    roomY = cy - Math.floor(newH / 2);
  } else if (dir === 1) {
    const sy = src.y + src.h;
    const cx = src.centerX;
    for (let y = sy; y < sy + corrLen; y++)
      for (let dx = -halfCW; dx <= halfCW; dx++)
        cells.push({ x: cx + dx, y });
    roomX = cx - Math.floor(newW / 2);
    roomY = sy + corrLen;
  } else if (dir === 2) {
    const ex = src.x - 1;
    const cy = src.centerY;
    for (let x = ex; x > ex - corrLen; x--)
      for (let dy = -halfCW; dy <= halfCW; dy++)
        cells.push({ x, y: cy + dy });
    roomX = src.x - corrLen - newW;
    roomY = cy - Math.floor(newH / 2);
  } else {
    const ey = src.y - 1;
    const cx = src.centerX;
    for (let y = ey; y > ey - corrLen; y--)
      for (let dx = -halfCW; dx <= halfCW; dx++)
        cells.push({ x: cx + dx, y });
    roomX = cx - Math.floor(newW / 2);
    roomY = src.y - corrLen - newH;
  }

  return { cells, roomX, roomY };
}

export function roomCorridorWalk(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const gridW = clamp(Math.floor(Number(input.width) || 50), 32, 512);
  const gridH = clamp(Math.floor(Number(input.height) || 50), 32, 512);
  const maxRooms = clamp(Math.floor(Number(input.maxRooms) || 6), 1, 100);
  const minRoom = clamp(Math.floor(Number(input.minRoomSize) || 4), 3, 30);
  const maxRoom = clamp(
    Math.floor(Number(input.maxRoomSize) || 8),
    minRoom,
    50,
  );
  const minCorrLen = clamp(
    Math.floor(Number(input.minCorridorLen) || 2),
    1,
    20,
  );
  const maxCorrLen = clamp(
    Math.floor(Number(input.maxCorridorLen) || 5),
    minCorrLen,
    40,
  );
  const corrWidth = clamp(
    Math.floor(Number(input.corridorWidth) || 2),
    1,
    5,
  );
  const branchProb = clamp(Number(input.branchProb) ?? 0.3, 0, 1);
  const seed = Math.floor(Number(input.seed) || 0);

  const rng = new LCG(seed);
  const halfCW = Math.floor(corrWidth / 2);

  const roomGrid: number[][] = Array.from({ length: gridH }, () =>
    new Array(gridW).fill(0),
  );
  const corridorGrid: number[][] = Array.from({ length: gridH }, () =>
    new Array(gridW).fill(0),
  );

  const rooms: RoomInfo[] = [];
  const randRoomW = () =>
    minRoom + rng.intn(Math.max(1, maxRoom - minRoom + 1));
  const randRoomH = () =>
    minRoom + rng.intn(Math.max(1, maxRoom - minRoom + 1));
  const randCorrLen = () =>
    minCorrLen + rng.intn(Math.max(1, maxCorrLen - minCorrLen + 1));

  // --- Place first room near center ---
  const fw = clamp(randRoomW(), 3, gridW - 4);
  const fh = clamp(randRoomH(), 3, gridH - 4);
  const fx = Math.floor((gridW - fw) / 2);
  const fy = Math.floor((gridH - fh) / 2);

  const firstRoom: RoomInfo = {
    id: 1,
    x: fx,
    y: fy,
    w: fw,
    h: fh,
    centerX: fx + Math.floor(fw / 2),
    centerY: fy + Math.floor(fh / 2),
  };
  for (let y = firstRoom.y; y < firstRoom.y + firstRoom.h; y++)
    for (let x = firstRoom.x; x < firstRoom.x + firstRoom.w; x++)
      roomGrid[y][x] = firstRoom.id;
  rooms.push(firstRoom);

  // --- Walk loop ---
  let current = firstRoom;
  const branchStack: RoomInfo[] = [];
  const dirs = [0, 1, 2, 3];
  const maxAttempts = maxRooms * 10;
  let attempts = 0;

  while (rooms.length < maxRooms && attempts < maxAttempts) {
    attempts++;
    shuffle(dirs, rng);

    let placed = false;

    for (const dir of dirs) {
      const cl = randCorrLen();
      const nw = randRoomW();
      const nh = randRoomH();

      const { cells, roomX, roomY } = computePlacement(
        current,
        dir,
        cl,
        halfCW,
        nw,
        nh,
      );

      if (!canPlaceCorridor(roomGrid, corridorGrid, cells, gridW, gridH))
        continue;
      if (!canPlaceRoom(roomGrid, roomX, roomY, nw, nh, gridW, gridH, 1))
        continue;

      for (const c of cells) corridorGrid[c.y][c.x] = 1;

      const newRoom: RoomInfo = {
        id: rooms.length + 1,
        x: roomX,
        y: roomY,
        w: nw,
        h: nh,
        centerX: roomX + Math.floor(nw / 2),
        centerY: roomY + Math.floor(nh / 2),
      };
      for (let y = newRoom.y; y < newRoom.y + newRoom.h; y++)
        for (let x = newRoom.x; x < newRoom.x + newRoom.w; x++)
          roomGrid[y][x] = newRoom.id;
      rooms.push(newRoom);

      if (rng.float01() < branchProb) {
        branchStack.push(newRoom);
      } else {
        current = newRoom;
      }
      placed = true;
      break;
    }

    if (!placed) {
      if (branchStack.length > 0) {
        current = branchStack.pop()!;
      } else {
        break;
      }
    }
  }

  return {
    grid: roomGrid,
    corridorGrid,
    rooms,
    numRooms: rooms.length,
  };
}
