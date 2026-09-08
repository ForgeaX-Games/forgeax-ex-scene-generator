/**
 * BSP房间生成 (bsp_room_generator)
 * Recursively partitions a 2D space using Binary Space Partition
 * and places rectangular rooms in leaf nodes.
 * Self-contained — no external imports.
 */

interface BSPNode {
  x: number;
  y: number;
  w: number;
  h: number;
  left: BSPNode | null;
  right: BSPNode | null;
}

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

function splitBSP(
  node: BSPNode,
  minSize: number,
  minRatio: number,
  maxRatio: number,
  rng: LCG,
): void {
  const minPartition = minSize * 2;
  if (node.w < minPartition && node.h < minPartition) return;

  let splitH: boolean;
  if (node.w < minPartition) {
    splitH = true;
  } else if (node.h < minPartition) {
    splitH = false;
  } else {
    const ratio = node.w / node.h;
    if (ratio > 1.25) splitH = false;
    else if (ratio < 0.8) splitH = true;
    else splitH = rng.float01() < 0.5;
  }

  const r = minRatio + rng.float01() * (maxRatio - minRatio);

  if (splitH) {
    const split = Math.floor(node.h * r);
    if (split < minSize || node.h - split < minSize) return;
    node.left = { x: node.x, y: node.y, w: node.w, h: split, left: null, right: null };
    node.right = { x: node.x, y: node.y + split, w: node.w, h: node.h - split, left: null, right: null };
  } else {
    const split = Math.floor(node.w * r);
    if (split < minSize || node.w - split < minSize) return;
    node.left = { x: node.x, y: node.y, w: split, h: node.h, left: null, right: null };
    node.right = { x: node.x + split, y: node.y, w: node.w - split, h: node.h, left: null, right: null };
  }

  splitBSP(node.left, minSize, minRatio, maxRatio, rng);
  splitBSP(node.right, minSize, minRatio, maxRatio, rng);
}

function createRooms(
  node: BSPNode,
  minSize: number,
  maxSize: number,
  padding: number,
  rooms: RoomInfo[],
  nextId: { v: number },
  rng: LCG,
): void {
  if (node.left && node.right) {
    createRooms(node.left, minSize, maxSize, padding, rooms, nextId, rng);
    createRooms(node.right, minSize, maxSize, padding, rooms, nextId, rng);
    return;
  }

  const availW = node.w - padding * 2;
  const availH = node.h - padding * 2;
  if (availW < 3 || availH < 3) return;

  let roomW = minSize + rng.intn(Math.max(1, maxSize - minSize + 1));
  let roomH = minSize + rng.intn(Math.max(1, maxSize - minSize + 1));
  roomW = clamp(roomW, 3, availW);
  roomH = clamp(roomH, 3, availH);

  const roomX = node.x + padding + rng.intn(Math.max(1, availW - roomW + 1));
  const roomY = node.y + padding + rng.intn(Math.max(1, availH - roomH + 1));

  const room: RoomInfo = {
    id: nextId.v,
    x: roomX,
    y: roomY,
    w: roomW,
    h: roomH,
    centerX: roomX + Math.floor(roomW / 2),
    centerY: roomY + Math.floor(roomH / 2),
  };
  rooms.push(room);
  nextId.v++;
}

export function bspRoomGenerator(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const width = clamp(Math.floor(Number(input.width) || 50), 16, 512);
  const height = clamp(Math.floor(Number(input.height) || 50), 16, 512);
  const minRoomSize = clamp(Math.floor(Number(input.minRoomSize) || 5), 3, 50);
  const maxRoomSize = clamp(
    Math.floor(Number(input.maxRoomSize) || 12),
    minRoomSize,
    100,
  );
  const minSplitRatio = clamp(Number(input.minSplitRatio) || 0.4, 0.2, 0.5);
  const maxSplitRatio = clamp(
    Number(input.maxSplitRatio) || 0.6,
    minSplitRatio,
    0.8,
  );
  const wallPadding = clamp(Math.floor(Number(input.wallPadding) ?? 1), 0, 5);
  const seed = Math.floor(Number(input.seed) || 0);

  const rng = new LCG(seed);

  const grid: number[][] = Array.from({ length: height }, () =>
    new Array(width).fill(0),
  );

  const root: BSPNode = {
    x: 0,
    y: 0,
    w: width,
    h: height,
    left: null,
    right: null,
  };

  splitBSP(root, minRoomSize, minSplitRatio, maxSplitRatio, rng);

  const rooms: RoomInfo[] = [];
  const nextId = { v: 1 };
  createRooms(root, minRoomSize, maxRoomSize, wallPadding, rooms, nextId, rng);

  for (const room of rooms) {
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        if (y >= 0 && y < height && x >= 0 && x < width) {
          grid[y][x] = room.id;
        }
      }
    }
  }

  return {
    grid,
    rooms,
    numRooms: rooms.length,
  };
}
