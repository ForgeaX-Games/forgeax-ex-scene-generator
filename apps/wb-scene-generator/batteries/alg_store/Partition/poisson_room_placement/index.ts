/**
 * poisson_room_placement: Place non-overlapping rectangular rooms on a 2D grid
 * using Bridson's Poisson disk sampling for evenly-distributed candidate centers.
 * Input:  width, height, minRoomW/maxRoomW, minRoomH/maxRoomH, gap, radius, seed
 * Output: grid (room IDs), rooms (info array), numRooms
 */

interface RoomRect {
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
  float01(): number {
    return Number((this.next() >> 33n) % 1000000n) / 1000000;
  }
  intRange(min: number, max: number): number {
    if (max <= min) return min;
    return min + Math.floor(this.float01() * (max - min + 1));
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Bridson's algorithm — generates well-distributed sample points
 * with a guaranteed minimum distance of `radius` between any two points.
 */
function poissonDiskSample(
  w: number,
  h: number,
  radius: number,
  rng: LCG,
  k: number = 30,
): [number, number][] {
  const cell = radius / Math.SQRT2;
  const gw = Math.ceil(w / cell);
  const gridH = Math.ceil(h / cell);
  const bg: number[] = new Array(gw * gridH).fill(-1);
  const pts: [number, number][] = [];
  const active: number[] = [];

  const x0 = rng.float01() * w;
  const y0 = rng.float01() * h;
  pts.push([x0, y0]);
  active.push(0);
  bg[Math.floor(y0 / cell) * gw + Math.floor(x0 / cell)] = 0;

  while (active.length > 0) {
    const ai = Math.floor(rng.float01() * active.length);
    const si = active[ai];
    const [sx, sy] = pts[si];
    let found = false;

    for (let a = 0; a < k; a++) {
      const angle = rng.float01() * 2 * Math.PI;
      const dist = radius + rng.float01() * radius;
      const nx = sx + Math.cos(angle) * dist;
      const ny = sy + Math.sin(angle) * dist;

      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;

      const gi = Math.floor(nx / cell);
      const gj = Math.floor(ny / cell);
      let ok = true;

      outer: for (let di = -2; di <= 2; di++) {
        for (let dj = -2; dj <= 2; dj++) {
          const ci = gi + di;
          const cj = gj + dj;
          if (ci < 0 || ci >= gw || cj < 0 || cj >= gridH) continue;
          const nb = bg[cj * gw + ci];
          if (nb === -1) continue;
          const dx = nx - pts[nb][0];
          const dy = ny - pts[nb][1];
          if (dx * dx + dy * dy < radius * radius) {
            ok = false;
            break outer;
          }
        }
      }

      if (ok) {
        const ni = pts.length;
        pts.push([nx, ny]);
        active.push(ni);
        bg[gj * gw + gi] = ni;
        found = true;
        break;
      }
    }

    if (!found) active.splice(ai, 1);
  }

  return pts;
}

function rectsOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
  gap: number,
): boolean {
  return (
    ax < bx + bw + gap &&
    ax + aw + gap > bx &&
    ay < by + bh + gap &&
    ay + ah + gap > by
  );
}

function tryPlace(
  cx: number,
  cy: number,
  rw: number,
  rh: number,
  gridW: number,
  gridH: number,
  existing: RoomRect[],
  gap: number,
): RoomRect | null {
  const x = Math.round(cx - rw / 2);
  const y = Math.round(cy - rh / 2);

  if (x < 0 || y < 0 || x + rw > gridW || y + rh > gridH) return null;

  for (const r of existing) {
    if (rectsOverlap(x, y, rw, rh, r.x, r.y, r.w, r.h, gap)) return null;
  }

  return {
    id: 0,
    x,
    y,
    w: rw,
    h: rh,
    centerX: x + Math.floor(rw / 2),
    centerY: y + Math.floor(rh / 2),
  };
}

export function poissonRoomPlacement(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const width = clamp(Math.floor(Number(input.width) || 50), 8, 512);
  const height = clamp(Math.floor(Number(input.height) || 50), 8, 512);
  const minRoomW = clamp(Math.floor(Number(input.minRoomW) || 3), 2, 50);
  const maxRoomW = clamp(Math.floor(Number(input.maxRoomW) || 8), minRoomW, 100);
  const minRoomH = clamp(Math.floor(Number(input.minRoomH) || 3), 2, 50);
  const maxRoomH = clamp(Math.floor(Number(input.maxRoomH) || 8), minRoomH, 100);
  const gap = clamp(Math.floor(Number(input.gap) ?? 1), 0, 20);
  const radiusRaw = Math.floor(Number(input.radius) || 0);
  const seed = Math.floor(Number(input.seed) || 0);

  const rng = new LCG(seed);

  // Auto radius: half of largest possible room diagonal + gap, ensures reasonable spacing
  const autoRadius = Math.max(maxRoomW, maxRoomH) / 2 + gap + 1;
  const radius = radiusRaw > 0 ? clamp(radiusRaw, 2, 200) : autoRadius;

  const candidates = poissonDiskSample(width, height, radius, rng);

  const rooms: RoomRect[] = [];
  let nextId = 1;

  for (const [cx, cy] of candidates) {
    const rw = rng.intRange(minRoomW, maxRoomW);
    const rh = rng.intRange(minRoomH, maxRoomH);
    const placed = tryPlace(cx, cy, rw, rh, width, height, rooms, gap);
    if (placed) {
      placed.id = nextId++;
      rooms.push(placed);
    }
  }

  const grid: number[][] = Array.from({ length: height }, () =>
    new Array(width).fill(0),
  );
  for (const room of rooms) {
    for (let r = room.y; r < room.y + room.h; r++) {
      for (let c = room.x; c < room.x + room.w; c++) {
        grid[r][c] = room.id;
      }
    }
  }

  return { grid, rooms, numRooms: rooms.length };
}
