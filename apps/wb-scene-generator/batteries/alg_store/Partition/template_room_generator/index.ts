/**
 * 模板房间生成 (template_room_generator)
 * Places predefined room templates on a regular grid, connects adjacent
 * rooms with corridors, and ensures full connectivity via flood-fill
 * region detection and L-shaped corridor carving.
 * Self-contained — no external imports.
 */

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

interface RoomTemplate {
  tiles: string[];
  maxUses: number; // -1 = unlimited
}

const TMPL_SIZE = 10;

/**
 * Built-in 10×10 room templates.
 * '.' = floor (passable), '#' = pillar / interior obstacle.
 */
const TEMPLATES: RoomTemplate[] = [
  {
    // 0: Open room — fully empty
    tiles: [
      "..........",
      "..........",
      "..........",
      "..........",
      "..........",
      "..........",
      "..........",
      "..........",
      "..........",
      "..........",
    ],
    maxUses: 3,
  },
  {
    // 1: Central pillar block
    tiles: [
      "..........",
      "..........",
      "...####...",
      "...####...",
      "...####...",
      "...####...",
      "...####...",
      "...####...",
      "..........",
      "..........",
    ],
    maxUses: -1,
  },
  {
    // 2: Pillar grid — evenly spaced columns
    tiles: [
      "..........",
      ".#.#.#.#.#",
      "..........",
      ".#.#.#.#.#",
      "..........",
      ".#.#.#.#.#",
      "..........",
      ".#.#.#.#.#",
      "..........",
      "..........",
    ],
    maxUses: -1,
  },
  {
    // 3: F-shaped partition walls
    tiles: [
      "..........",
      "..........",
      "...#####..",
      "...#......",
      "...#####..",
      "...#......",
      "...#......",
      "..........",
      "..........",
      "..........",
    ],
    maxUses: 2,
  },
  {
    // 4: Ring / frame room
    tiles: [
      "..........",
      "..........",
      "..######..",
      "..#....#..",
      "....##....",
      "..#....#..",
      "..######..",
      "..........",
      "..........",
      "..........",
    ],
    maxUses: -1,
  },
  {
    // 5: Horizontal stripe corridors
    tiles: [
      "..........",
      "##########",
      "..........",
      "##########",
      "..........",
      "##########",
      "..........",
      "##########",
      "..........",
      "##########",
    ],
    maxUses: -1,
  },
  {
    // 6: Double room with passage
    tiles: [
      "##########",
      "#........#",
      "#........#",
      "######.###",
      "..........",
      "######.###",
      "#........#",
      "#........#",
      "##########",
      "##########",
    ],
    maxUses: -1,
  },
];

function rotateTiles(src: string[], rot: number): string[] {
  if (rot === 0) return src;
  const n = TMPL_SIZE;
  const out: string[] = [];
  for (let y = 0; y < n; y++) {
    let row = "";
    for (let x = 0; x < n; x++) {
      switch (rot) {
        case 90:
          row += src[n - 1 - x][y];
          break;
        case 180:
          row += src[n - 1 - y][n - 1 - x];
          break;
        case 270:
          row += src[x][n - 1 - y];
          break;
        default:
          row += src[y][x];
          break;
      }
    }
    out.push(row);
  }
  return out;
}

const FLOOR = 0;
const WALL = 1;
const PILLAR = 2;

export function templateRoomGenerator(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const W = clamp(Math.floor(Number(input.width) || 100), 30, 512);
  const H = clamp(Math.floor(Number(input.height) || 100), 30, 512);
  const cellSize = clamp(Math.floor(Number(input.cellSize) || 12), 10, 40);
  const emptyChance = clamp(Number(input.emptyChance) ?? 0.1, 0, 0.5);
  const corridorWidth = clamp(
    Math.floor(Number(input.corridorWidth) || 3),
    1,
    7,
  );
  const minRegionSize = clamp(
    Math.floor(Number(input.minRegionSize) || 10),
    1,
    100,
  );
  const seed = Math.floor(Number(input.seed) || 0);

  const rng = new LCG(seed);
  const roomCols = Math.max(2, Math.floor((W - 1) / cellSize));
  const roomRows = Math.max(2, Math.floor((H - 1) / cellSize));
  const corrHalf = Math.floor(corridorWidth / 2);

  const grid: number[][] = Array.from({ length: H }, () =>
    new Array(W).fill(WALL),
  );

  const usage = new Array(TEMPLATES.length).fill(0);
  const placed: number[][] = Array.from({ length: roomRows }, () =>
    new Array(roomCols).fill(-1),
  );

  /* ── Phase 1: Place room templates ───────────────────────────────── */

  for (let ry = 0; ry < roomRows; ry++) {
    for (let rx = 0; rx < roomCols; rx++) {
      if (rng.float01() < emptyChance) continue;

      let idx = -1;
      for (let t = 0; t < 20; t++) {
        const c = rng.intn(TEMPLATES.length);
        if (TEMPLATES[c].maxUses !== -1 && usage[c] >= TEMPLATES[c].maxUses)
          continue;
        if (
          (rx > 0 && placed[ry][rx - 1] === c) ||
          (ry > 0 && placed[ry - 1][rx] === c)
        )
          continue;
        idx = c;
        break;
      }
      if (idx === -1) continue;

      placed[ry][rx] = idx;
      usage[idx]++;

      const rot = rng.intn(4) * 90;
      const tiles = rotateTiles(TEMPLATES[idx].tiles, rot);
      const ox = rx * cellSize + 1;
      const oy = ry * cellSize + 1;

      if (ox + TMPL_SIZE > W || oy + TMPL_SIZE > H) continue;

      for (let py = 0; py < TMPL_SIZE; py++)
        for (let px = 0; px < TMPL_SIZE; px++)
          grid[oy + py][ox + px] =
            tiles[py][px] === "." ? FLOOR : PILLAR;

      /* ── Phase 2: Short corridors to neighbors ─────────────────── */
      //
      // Each room occupies TMPL_SIZE (10) cells within a `cellSize` stride,
      // leaving `cellSize - TMPL_SIZE` wall cells between adjacent templates.
      // We carve a corridor that spans the full gap and penetrates 1 cell into
      // each adjacent template, ensuring the two rooms become connected
      // regardless of cellSize. Width is driven by `corridorWidth`.

      const gapSpan = Math.max(0, cellSize - TMPL_SIZE);

      if (rx > 0 && placed[ry][rx - 1] !== -1) {
        const my = oy + Math.floor(cellSize / 2);
        const startX = ox - gapSpan - 1; // 1 cell into previous room's template
        const endX = ox + 1;             // 1 cell into current room's template
        for (let cx = startX; cx <= endX; cx++)
          for (let i = 0; i < corridorWidth; i++) {
            const cy = my + i - corrHalf;
            if (cx >= 0 && cy >= 0 && cx < W && cy < H)
              grid[cy][cx] = FLOOR;
          }
      }

      if (ry > 0 && placed[ry - 1][rx] !== -1) {
        const mx = ox + Math.floor(cellSize / 2);
        const startY = oy - gapSpan - 1;
        const endY = oy + 1;
        for (let cy = startY; cy <= endY; cy++)
          for (let i = 0; i < corridorWidth; i++) {
            const cx = mx + i - corrHalf;
            if (cx >= 0 && cy >= 0 && cx < W && cy < H)
              grid[cy][cx] = FLOOR;
          }
      }
    }
  }

  /* ── Phase 3: Flood fill → detect connected regions ──────────────── */

  const reg: number[][] = Array.from({ length: H }, () =>
    new Array(W).fill(-1),
  );

  function flood(sx: number, sy: number, id: number): number {
    const st = [sx, sy];
    let sz = 0;
    while (st.length) {
      const y = st.pop()!;
      const x = st.pop()!;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      if (grid[y][x] !== FLOOR || reg[y][x] !== -1) continue;
      reg[y][x] = id;
      sz++;
      st.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
    }
    return sz;
  }

  let nReg = 0;
  const regSize: number[] = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (grid[y][x] === FLOOR && reg[y][x] === -1) {
        regSize.push(flood(x, y, nReg));
        nReg++;
      }

  /* ── Phase 4: Connect isolated regions via L-shaped corridors ────── */
  //
  // Pick the LARGEST region as the main region (not region 0 — that was a
  // bug: if region 0 is small, other regions were left disconnected).
  // Every other region of size >= minRegionSize is then connected to the
  // main region with an L-shaped corridor carved at full `corridorWidth`.

  const DX = [1, -1, 0, 0];
  const DY = [0, 0, 1, -1];

  let mainReg = 0;
  let mainSize = regSize[0] ?? 0;
  for (let r = 1; r < nReg; r++) {
    if (regSize[r] > mainSize) {
      mainSize = regSize[r];
      mainReg = r;
    }
  }

  const carveBrush = (cx: number, cy: number): void => {
    for (let dy = -corrHalf; dy <= corrHalf; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= H) continue;
      for (let dx = -corrHalf; dx <= corrHalf; dx++) {
        const x = cx + dx;
        if (x < 0 || x >= W) continue;
        grid[y][x] = FLOOR;
      }
    }
  };

  for (let r = 0; r < nReg; r++) {
    if (r === mainReg) continue;
    if (regSize[r] < minRegionSize) continue;

    const vis = new Uint8Array(H * W);
    const src = new Int32Array(H * W).fill(-1);
    const q: number[] = [];

    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (reg[y][x] === r) {
          const k = y * W + x;
          vis[k] = 1;
          src[k] = k;
          q.push(x, y);
        }

    let ax = -1;
    let ay = -1;
    let bx = -1;
    let by = -1;
    let qi = 0;

    while (qi < q.length) {
      const x = q[qi++];
      const y = q[qi++];

      if (reg[y][x] === mainReg) {
        const sk = src[y * W + x];
        ax = sk % W;
        ay = (sk - ax) / W;
        bx = x;
        by = y;
        break;
      }

      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const nk = ny * W + nx;
        if (vis[nk]) continue;
        vis[nk] = 1;
        src[nk] = src[y * W + x];
        q.push(nx, ny);
      }
    }

    if (ax < 0) continue;

    const span = Math.abs(bx - ax);
    const pivotX =
      span > 0 ? ax + rng.intn(span + 1) * (bx > ax ? 1 : -1) : ax;

    let cx = ax;
    while (cx !== pivotX) {
      carveBrush(cx, ay);
      cx += pivotX > cx ? 1 : -1;
    }
    let cy = ay;
    while (cy !== by) {
      carveBrush(pivotX, cy);
      cy += by > cy ? 1 : -1;
    }
    cx = pivotX;
    while (cx !== bx) {
      carveBrush(cx, by);
      cx += bx > cx ? 1 : -1;
    }
    carveBrush(bx, by);
  }

  /* ── Phase 5: Enforce solid borders ──────────────────────────────── */

  for (let y = 0; y < H; y++) {
    grid[y][0] = WALL;
    grid[y][W - 1] = WALL;
  }
  for (let x = 0; x < W; x++) {
    grid[0][x] = WALL;
    grid[H - 1][x] = WALL;
  }

  return { grid, gridWidth: W, gridHeight: H };
}
