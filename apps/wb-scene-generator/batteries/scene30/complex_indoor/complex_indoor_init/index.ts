/**
 * complex_indoor_init
 * Creates the grid and places the initial square room with wall outline.
 * Grid encoding: 0=void, 1=wall, 2=room interior.
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

function paintRoomRect(
  grid: number[][],
  ox: number, oy: number, ow: number, oh: number,
  roomId: number
): void {
  const rows = grid.length;
  const cols = grid[0].length;
  for (let ry = oy; ry < oy + oh && ry < rows; ry++) {
    for (let rx = ox; rx < ox + ow && rx < cols; rx++) {
      if (ry < 0 || rx < 0) continue;
      const isBorder = ry === oy || ry === oy + oh - 1 || rx === ox || rx === ox + ow - 1;
      grid[ry][rx] = isBorder ? 1 : roomId;
    }
  }
}

export function complexIndoorInit(
  input: Record<string, unknown>
): Record<string, unknown> {
  const width = typeof input.width === "number" ? Math.max(40, input.width) : 300;
  const height = typeof input.height === "number" ? Math.max(40, input.height) : 220;
  const roomMinSize = typeof input.roomMinSize === "number" ? Math.max(4, input.roomMinSize) : 10;
  const roomMaxSize = typeof input.roomMaxSize === "number" ? Math.max(roomMinSize, input.roomMaxSize) : 20;
  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  const seed = seedRaw === 0 ? Date.now() : seedRaw;

  const rng = makeLCG(seed);

  const grid: number[][] = Array.from({ length: height }, () => new Array(width).fill(0));

  const innerW = randInt(rng, roomMinSize, roomMaxSize);
  const innerH = randInt(rng, roomMinSize, roomMaxSize);

  const outerW = innerW + 2;
  const outerH = innerH + 2;

  const ox = Math.floor((width - outerW) / 2);
  const oy = Math.floor((height - outerH) / 2);

  const roomId = 2;
  paintRoomRect(grid, ox, oy, outerW, outerH, roomId);

  const roomList = [
    {
      id: roomId,
      rects: [{ x: ox, y: oy, w: outerW, h: outerH }],
      innerArea: innerW * innerH,
      parentId: -1,
      isCorridor: false,
    },
  ];

  return {
    outputGrid: grid,
    roomList,
    nextRoomId: roomId + 1,
  };
}
