/**
 * gen_hospital_dungeon: BSP binary space partitioning dungeon generator.
 * Produces a grid with rooms connected by L-shaped corridors.
 * All special tiles (spawn, portal, decors) are encoded as mask IDs in the grid.
 *
 * Mask IDs:
 *   1 = 墙体     (WALL)
 *   2 = 地板     (FLOOR)
 *   3 = 走廊     (CORRIDOR)
 *   4 = 传送门   (PORTAL)
 *   5 = 出生点   (SPAWN)
 *   6 = 病床     (BED)
 *   7 = 监护仪   (MONITOR)
 *   8 = 手术椅   (CHAIR)
 *   9 = 走廊灯   (LIGHT)
 */

type NameEntry = { id: number; name: string };
type Rect = { x: number; y: number; w: number; h: number };
type Leaf = { x: number; y: number; w: number; h: number; left?: Leaf; right?: Leaf; room?: Rect };

const WALL = 1, FLOOR = 2, CORRIDOR = 3, PORTAL = 4, SPAWN = 5,
  BED = 6, MONITOR = 7, CHAIR = 8, LIGHT = 9;

function makeLCG(seed: number): () => number {
  let s = (seed | 0) >>> 0;
  return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 0x100000000; };
}

function lcgInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function carveRoom(grid: number[][], r: Rect, H: number, W: number) {
  for (let y = r.y; y < r.y + r.h; y++)
    for (let x = r.x; x < r.x + r.w; x++)
      if (y >= 0 && y < H && x >= 0 && x < W) grid[y][x] = FLOOR;
}

function carveCorridor(
  grid: number[][], rng: () => number,
  x1: number, y1: number, x2: number, y2: number,
  H: number, W: number
) {
  if (rng() > 0.5) {
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
      if (y1 >= 0 && y1 < H && x >= 0 && x < W && grid[y1][x] === WALL) grid[y1][x] = CORRIDOR;
      if (y1 + 1 < H && grid[y1 + 1][x] === WALL) grid[y1 + 1][x] = CORRIDOR;
    }
    for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
      if (y >= 0 && y < H && x2 >= 0 && x2 < W && grid[y][x2] === WALL) grid[y][x2] = CORRIDOR;
      if (x2 + 1 < W && grid[y][x2 + 1] === WALL) grid[y][x2 + 1] = CORRIDOR;
    }
  } else {
    for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
      if (y >= 0 && y < H && x1 >= 0 && x1 < W && grid[y][x1] === WALL) grid[y][x1] = CORRIDOR;
      if (x1 + 1 < W && grid[y][x1 + 1] === WALL) grid[y][x1 + 1] = CORRIDOR;
    }
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
      if (y2 >= 0 && y2 < H && x >= 0 && x < W && grid[y2][x] === WALL) grid[y2][x] = CORRIDOR;
      if (y2 + 1 < H && grid[y2 + 1][x] === WALL) grid[y2 + 1][x] = CORRIDOR;
    }
  }
}

function getRoom(l: Leaf, rng: () => number): Rect | null {
  if (l.room) return l.room;
  const a = l.left ? getRoom(l.left, rng) : null;
  const b = l.right ? getRoom(l.right, rng) : null;
  if (!a) return b;
  if (!b) return a;
  return rng() > 0.5 ? a : b;
}

function split(
  l: Leaf, depth: number, rng: () => number,
  rooms: Rect[], grid: number[][], H: number, W: number
) {
  const MIN_SPLIT = 18;
  if (depth === 0 || l.w < MIN_SPLIT || l.h < MIN_SPLIT) {
    const maxW = Math.min(l.w - 4, 14), maxH = Math.min(l.h - 4, 10);
    if (maxW < 7 || maxH < 6) return;
    const rw = lcgInt(rng, 7, maxW), rh = lcgInt(rng, 6, maxH);
    const rx = l.x + 2 + lcgInt(rng, 0, l.w - rw - 3);
    const ry = l.y + 2 + lcgInt(rng, 0, l.h - rh - 3);
    l.room = { x: rx, y: ry, w: rw, h: rh };
    rooms.push(l.room);
    carveRoom(grid, l.room, H, W);
    return;
  }
  const horiz = l.h > l.w ? true : l.w > l.h ? false : rng() > 0.5;
  if (horiz) {
    const s = lcgInt(rng, Math.floor(l.h * 0.4), Math.floor(l.h * 0.6));
    l.left = { x: l.x, y: l.y, w: l.w, h: s };
    l.right = { x: l.x, y: l.y + s, w: l.w, h: l.h - s };
  } else {
    const s = lcgInt(rng, Math.floor(l.w * 0.4), Math.floor(l.w * 0.6));
    l.left = { x: l.x, y: l.y, w: s, h: l.h };
    l.right = { x: l.x + s, y: l.y, w: l.w - s, h: l.h };
  }
  split(l.left!, depth - 1, rng, rooms, grid, H, W);
  split(l.right!, depth - 1, rng, rooms, grid, H, W);
  const a = getRoom(l.left!, rng), b = getRoom(l.right!, rng);
  if (a && b) carveCorridor(
    grid, rng,
    a.x + Math.floor(a.w / 2), a.y + Math.floor(a.h / 2),
    b.x + Math.floor(b.w / 2), b.y + Math.floor(b.h / 2),
    H, W
  );
}

export function genHospitalDungeon(input: Record<string, unknown>): Record<string, unknown> {
  const W = typeof input.width === "number" ? Math.max(40, input.width) : 72;
  const H = typeof input.height === "number" ? Math.max(30, input.height) : 54;
  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  const baseSeed = seedRaw === 0 ? Date.now() : seedRaw;
  const rng = makeLCG(baseSeed);

  // Initialize as WALL
  const grid: number[][] = Array.from({ length: H }, () => new Array(W).fill(WALL));
  const rooms: Rect[] = [];

  split({ x: 1, y: 1, w: W - 2, h: H - 2 }, 4, rng, rooms, grid, H, W);
  if (rooms.length === 0) {
    rooms.push({ x: 3, y: 3, w: 10, h: 8 });
    carveRoom(grid, rooms[0], H, W);
  }

  // Portal in last room center
  const last = rooms[rooms.length - 1];
  const ptx = last.x + Math.floor(last.w / 2);
  const pty = last.y + Math.floor(last.h / 2);
  grid[pty][ptx] = PORTAL;

  // Spawn in first room
  const first = rooms[0];
  grid[first.y + 1][first.x + 1] = SPAWN;

  // Decors written into grid
  for (const r of rooms) {
    // Beds along top row of room
    for (let x = r.x + 1; x < r.x + r.w - 1; x += 3)
      if (grid[r.y + 1]?.[x] === FLOOR) grid[r.y + 1][x] = BED;
    // Monitor on left side of wider rooms
    if (r.w >= 6) {
      const cx = r.x + 2, cy = r.y + Math.floor(r.h / 2);
      if (grid[cy]?.[cx] === FLOOR) grid[cy][cx] = MONITOR;
    }
    // Chair near portal room
    if (r === last && grid[pty]?.[ptx - 1] === FLOOR) grid[pty][ptx - 1] = CHAIR;
  }
  // Lights along corridors (every 5 steps)
  for (let y = 2; y < H - 2; y += 5)
    for (let x = 2; x < W - 2; x += 5)
      if (grid[y][x] === CORRIDOR) grid[y][x] = LIGHT;

  const outputNameList: NameEntry[] = [
    { id: WALL,    name: "墙体" },
    { id: FLOOR,   name: "地板" },
    { id: CORRIDOR, name: "走廊" },
    { id: PORTAL,  name: "传送门" },
    { id: SPAWN,   name: "出生点" },
    { id: BED,     name: "病床" },
    { id: MONITOR, name: "监护仪" },
    { id: CHAIR,   name: "手术椅" },
    { id: LIGHT,   name: "走廊灯" },
  ];

  // Only keep entries that actually appear in the grid
  const usedIds = new Set<number>();
  for (const row of grid) for (const v of row) usedIds.add(v);
  const filteredNameList = outputNameList.filter(e => usedIds.has(e.id));

  return {
    outputGrid: grid,
    outputNameList: filteredNameList,
  };
}
