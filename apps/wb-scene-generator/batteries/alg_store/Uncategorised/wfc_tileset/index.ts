/**
 * wfc_tileset — WFC 瓦片模板生成器
 *
 * 生成多值瓦片模板集，可直接连接 wfc_tile_solver 进行地图拼装。
 * 单元格值：0=背景  1=墙壁  2=地板(房间/走廊)  3=资源点  4=柱子/掩体
 *
 * 输出：templates (number[][][]), adjacency ({N,E,S,W}[]), weights (number[])
 */

class LCG {
  private s: bigint;
  constructor(seed: number) {
    this.s = BigInt(seed > 0 ? seed : 31337);
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
}

/* ── Cell values ──
 * 0 = background  (空地/背景)
 * 1 = wall        (墙壁)
 * 2 = floor       (房间/走廊地板)
 * 3 = resource    (资源点/拾取物)
 * 4 = pillar      (柱子/掩体/障碍物)
 */
const BG = 0;
const WALL = 1;
const FLOOR = 2;
const RESOURCE = 3;
const PILLAR = 4;

/* ── Edge socket types ──
 * 0 = solid wall (no opening)
 * 1 = narrow centered door (corridorWidth wide)
 * 2 = wide opening (full edge minus corner posts)
 */
type Edges = [number, number, number, number]; // [N, E, S, W]

interface TileDef {
  edges: Edges;
  variant: string;
  weight: number;
}

// ── Helpers ──

function num(v: unknown, def: number): number {
  const n = Number(v);
  return isNaN(n) ? def : n;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.floor(v)));
}

function ensureOdd(v: number): number {
  return v % 2 === 0 ? v + 1 : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ── Tile grid builders ──

function punchOpening(
  grid: number[][],
  ts: number,
  center: number,
  hw: number,
  wt: number,
  dir: string,
  edgeType: number,
): void {
  if (edgeType === 0) return;

  if (edgeType === 1) {
    if (dir === "N")
      for (let y = 0; y < wt; y++)
        for (let x = center - hw; x <= center + hw; x++) grid[y][x] = FLOOR;
    if (dir === "S")
      for (let y = ts - wt; y < ts; y++)
        for (let x = center - hw; x <= center + hw; x++) grid[y][x] = FLOOR;
    if (dir === "W")
      for (let y = center - hw; y <= center + hw; y++)
        for (let x = 0; x < wt; x++) grid[y][x] = FLOOR;
    if (dir === "E")
      for (let y = center - hw; y <= center + hw; y++)
        for (let x = ts - wt; x < ts; x++) grid[y][x] = FLOOR;
  } else if (edgeType === 2) {
    if (dir === "N")
      for (let y = 0; y < wt; y++)
        for (let x = wt; x < ts - wt; x++) grid[y][x] = FLOOR;
    if (dir === "S")
      for (let y = ts - wt; y < ts; y++)
        for (let x = wt; x < ts - wt; x++) grid[y][x] = FLOOR;
    if (dir === "W")
      for (let y = wt; y < ts - wt; y++)
        for (let x = 0; x < wt; x++) grid[y][x] = FLOOR;
    if (dir === "E")
      for (let y = wt; y < ts - wt; y++)
        for (let x = ts - wt; x < ts; x++) grid[y][x] = FLOOR;
  }
}

function inDoorPath(
  y: number,
  x: number,
  edges: Edges,
  ts: number,
  center: number,
  hw: number,
  wt: number,
  margin: number,
): boolean {
  const [eN, eE, eS, eW] = edges;
  if (eN && y < wt + margin && x >= center - hw - 1 && x <= center + hw + 1) return true;
  if (eS && y > ts - 1 - wt - margin && x >= center - hw - 1 && x <= center + hw + 1) return true;
  if (eW && x < wt + margin && y >= center - hw - 1 && y <= center + hw + 1) return true;
  if (eE && x > ts - 1 - wt - margin && y >= center - hw - 1 && y <= center + hw + 1) return true;
  return false;
}

function addPillars(
  grid: number[][],
  ts: number,
  wt: number,
  ps: number,
  center: number,
  hw: number,
  edges: Edges,
): void {
  const off = Math.max(2, Math.floor((ts - 2 * wt) / 4));
  const anchors = [
    [wt + off, wt + off],
    [wt + off, ts - wt - off - ps],
    [ts - wt - off - ps, wt + off],
    [ts - wt - off - ps, ts - wt - off - ps],
  ];

  for (const [py, px] of anchors) {
    let safe = true;
    for (let dy = 0; dy < ps && safe; dy++)
      for (let dx = 0; dx < ps && safe; dx++) {
        const y = py + dy, x = px + dx;
        if (y <= wt || y >= ts - 1 - wt || x <= wt || x >= ts - 1 - wt) safe = false;
        if (inDoorPath(y, x, edges, ts, center, hw, wt, 1)) safe = false;
      }
    if (safe)
      for (let dy = 0; dy < ps; dy++)
        for (let dx = 0; dx < ps; dx++) grid[py + dy][px + dx] = PILLAR;
  }
}

function addCover(
  grid: number[][],
  ts: number,
  wt: number,
  center: number,
  hw: number,
  edges: Edges,
  rng: LCG,
): void {
  const count = 2 + Math.floor(rng.float01() * 3);
  for (let i = 0; i < count; i++) {
    const bw = 2;
    const bh = 2 + Math.floor(rng.float01() * 2);
    const rangeY = ts - 2 * wt - 2 - bh;
    const rangeX = ts - 2 * wt - 2 - bw;
    if (rangeY <= 0 || rangeX <= 0) continue;

    for (let attempt = 0; attempt < 30; attempt++) {
      const by = wt + 1 + Math.floor(rng.float01() * rangeY);
      const bx = wt + 1 + Math.floor(rng.float01() * rangeX);

      let safe = true;
      for (let dy = 0; dy < bh && safe; dy++)
        for (let dx = 0; dx < bw && safe; dx++) {
          if (inDoorPath(by + dy, bx + dx, edges, ts, center, hw, wt, 1)) safe = false;
          if (grid[by + dy][bx + dx] !== FLOOR) safe = false;
        }
      if (safe) {
        for (let dy = 0; dy < bh; dy++)
          for (let dx = 0; dx < bw; dx++) grid[by + dy][bx + dx] = PILLAR;
        break;
      }
    }
  }
}

function addAlcoves(
  grid: number[][],
  ts: number,
  wt: number,
  center: number,
  hw: number,
  edges: Edges,
  rng: LCG,
): void {
  const depth = Math.max(1, Math.floor((ts - 2 * wt) / 5));
  const width = Math.max(3, Math.floor((ts - 2 * wt) / 3));
  const sides: Array<{ wall: "N" | "E" | "S" | "W"; edge: number }> = [
    { wall: "N", edge: edges[0] },
    { wall: "E", edge: edges[1] },
    { wall: "S", edge: edges[2] },
    { wall: "W", edge: edges[3] },
  ];

  const solidSides = sides.filter((s) => s.edge === 0);
  if (solidSides.length === 0) return;

  const pick = solidSides[Math.floor(rng.float01() * solidSides.length)];
  const halfW = Math.floor(width / 2);
  const offset = Math.floor(rng.float01() * 3) - 1;
  const cx = center + offset;
  const cy = center + offset;

  if (pick.wall === "N") {
    for (let dy = 0; dy < depth; dy++)
      for (let x = cx - halfW; x <= cx + halfW; x++)
        if (x > wt && x < ts - 1 - wt) grid[wt + 1 + dy][x] = WALL;
  } else if (pick.wall === "S") {
    for (let dy = 0; dy < depth; dy++)
      for (let x = cx - halfW; x <= cx + halfW; x++)
        if (x > wt && x < ts - 1 - wt) grid[ts - 2 - wt - dy][x] = WALL;
  } else if (pick.wall === "W") {
    for (let dx = 0; dx < depth; dx++)
      for (let y = cy - halfW; y <= cy + halfW; y++)
        if (y > wt && y < ts - 1 - wt) grid[y][wt + 1 + dx] = WALL;
  } else if (pick.wall === "E") {
    for (let dx = 0; dx < depth; dx++)
      for (let y = cy - halfW; y <= cy + halfW; y++)
        if (y > wt && y < ts - 1 - wt) grid[y][ts - 2 - wt - dx] = WALL;
  }
}

function addResources(
  grid: number[][],
  ts: number,
  wt: number,
  center: number,
  hw: number,
  edges: Edges,
  rng: LCG,
): void {
  const count = 1 + Math.floor(rng.float01() * 3);
  for (let i = 0; i < count; i++) {
    const rangeY = ts - 2 * wt - 4;
    const rangeX = ts - 2 * wt - 4;
    if (rangeY <= 0 || rangeX <= 0) continue;

    for (let attempt = 0; attempt < 40; attempt++) {
      const ry = wt + 2 + Math.floor(rng.float01() * rangeY);
      const rx = wt + 2 + Math.floor(rng.float01() * rangeX);
      if (grid[ry][rx] !== FLOOR) continue;
      if (inDoorPath(ry, rx, edges, ts, center, hw, wt, 2)) continue;
      grid[ry][rx] = RESOURCE;
      break;
    }
  }
}

function addDivider(
  grid: number[][],
  ts: number,
  wt: number,
  center: number,
  hw: number,
  edges: Edges,
  rng: LCG,
): void {
  const horiz = rng.float01() < 0.5;
  if (horiz) {
    for (let x = wt; x < ts - wt; x++)
      if (x < center - hw || x > center + hw) grid[center][x] = WALL;
  } else {
    for (let y = wt; y < ts - wt; y++)
      if (y < center - hw || y > center + hw) grid[y][center] = WALL;
  }
}

function addBarricade(
  grid: number[][],
  ts: number,
  wt: number,
  center: number,
  hw: number,
  edges: Edges,
  rng: LCG,
): void {
  const count = 1 + (rng.float01() < 0.4 ? 1 : 0);
  for (let i = 0; i < count; i++) {
    const horiz = rng.float01() < 0.5;
    const len = 2 + Math.floor(rng.float01() * 3);
    for (let attempt = 0; attempt < 20; attempt++) {
      const py = wt + 2 + Math.floor(rng.float01() * Math.max(1, ts - 2 * wt - 4));
      const px = wt + 2 + Math.floor(rng.float01() * Math.max(1, ts - 2 * wt - 4));
      let safe = true;
      for (let k = 0; k < len && safe; k++) {
        const y = horiz ? py : py + k;
        const x = horiz ? px + k : px;
        if (y < wt || y >= ts - wt || x < wt || x >= ts - wt) { safe = false; break; }
        if (inDoorPath(y, x, edges, ts, center, hw, wt, 1)) safe = false;
        if (grid[y][x] !== FLOOR) safe = false;
      }
      if (safe) {
        for (let k = 0; k < len; k++) {
          const y = horiz ? py : py + k;
          const x = horiz ? px + k : px;
          if (y >= wt && y < ts - wt && x >= wt && x < ts - wt) grid[y][x] = WALL;
        }
        break;
      }
    }
  }
}

function addCrossShape(
  grid: number[][],
  ts: number,
  wt: number,
  rng: LCG,
): void {
  const inner = ts - 2 * wt;
  const sz = Math.max(1, 1 + Math.floor(rng.float01() * Math.floor(inner / 4)));
  for (let d = 0; d < sz; d++) {
    for (let k = 0; k <= sz - 1 - d; k++) {
      const nw_r = wt + d, nw_c = wt + k;
      const ne_r = wt + d, ne_c = ts - 1 - wt - k;
      const sw_r = ts - 1 - wt - d, sw_c = wt + k;
      const se_r = ts - 1 - wt - d, se_c = ts - 1 - wt - k;
      if (grid[nw_r][nw_c] === FLOOR) grid[nw_r][nw_c] = WALL;
      if (grid[ne_r][ne_c] === FLOOR) grid[ne_r][ne_c] = WALL;
      if (grid[sw_r][sw_c] === FLOOR) grid[sw_r][sw_c] = WALL;
      if (grid[se_r][se_c] === FLOOR) grid[se_r][se_c] = WALL;
    }
  }
}

/**
 * Replace a rectangle with BG and seal adjacent FLOOR cells with WALL
 * to maintain room boundary integrity.
 */
function cutRectToBg(
  grid: number[][],
  ts: number,
  r0: number,
  r1: number,
  c0: number,
  c1: number,
): void {
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) grid[r][c] = BG;

  for (let r = r0; r <= r1; r++) {
    if (c0 > 0 && grid[r][c0 - 1] === FLOOR) grid[r][c0 - 1] = WALL;
    if (c1 < ts - 1 && grid[r][c1 + 1] === FLOOR) grid[r][c1 + 1] = WALL;
  }
  for (let c = Math.max(0, c0 - 1); c <= Math.min(ts - 1, c1 + 1); c++) {
    if (r0 > 0 && grid[r0 - 1][c] === FLOOR) grid[r0 - 1][c] = WALL;
    if (r1 < ts - 1 && grid[r1 + 1][c] === FLOOR) grid[r1 + 1][c] = WALL;
  }
}

/**
 * Cut 1–2 rectangular chunks from closed edges of a room, replacing with BG.
 * Preserves wall borders on sides that have doors (socket > 0) to avoid leaks.
 */
function applyIrregularCuts(
  grid: number[][],
  ts: number,
  wt: number,
  center: number,
  hw: number,
  edges: Edges,
  rng: LCG,
): void {
  const [eN, eE, eS, eW] = edges;
  const maxDepth = Math.max(2, center - hw - 1);

  const closed: Array<"N" | "E" | "S" | "W"> = [];
  if (!eN) closed.push("N");
  if (!eE) closed.push("E");
  if (!eS) closed.push("S");
  if (!eW) closed.push("W");
  if (closed.length === 0) return;

  for (let i = closed.length - 1; i > 0; i--) {
    const j = Math.floor(rng.float01() * (i + 1));
    [closed[i], closed[j]] = [closed[j], closed[i]];
  }

  const numCuts = Math.min(1 + (rng.float01() < 0.35 ? 1 : 0), closed.length);

  for (let ci = 0; ci < numCuts; ci++) {
    const side = closed[ci];
    const depth = 2 + Math.floor(rng.float01() * (maxDepth - 1));
    const partial = rng.float01() < 0.55;

    if (side === "N" || side === "S") {
      const safeC0 = eW ? wt : 0;
      const safeC1 = eE ? ts - 1 - wt : ts - 1;
      if (safeC0 > safeC1) continue;

      let c0: number, c1: number;
      if (partial) {
        const maxSpan = safeC1 - safeC0 + 1;
        const span = Math.max(2, Math.floor(maxSpan * 0.4) +
          Math.floor(rng.float01() * Math.floor(maxSpan * 0.35)));
        if (rng.float01() < 0.5) {
          c0 = safeC0;
          c1 = Math.min(safeC0 + span - 1, safeC1);
        } else {
          c1 = safeC1;
          c0 = Math.max(safeC1 - span + 1, safeC0);
        }
      } else {
        c0 = safeC0;
        c1 = safeC1;
      }

      if (side === "N") {
        cutRectToBg(grid, ts, 0, depth - 1, c0, c1);
      } else {
        cutRectToBg(grid, ts, ts - depth, ts - 1, c0, c1);
      }
    } else {
      const safeR0 = eN ? wt : 0;
      const safeR1 = eS ? ts - 1 - wt : ts - 1;
      if (safeR0 > safeR1) continue;

      let r0: number, r1: number;
      if (partial) {
        const maxSpan = safeR1 - safeR0 + 1;
        const span = Math.max(2, Math.floor(maxSpan * 0.4) +
          Math.floor(rng.float01() * Math.floor(maxSpan * 0.35)));
        if (rng.float01() < 0.5) {
          r0 = safeR0;
          r1 = Math.min(safeR0 + span - 1, safeR1);
        } else {
          r1 = safeR1;
          r0 = Math.max(safeR1 - span + 1, safeR0);
        }
      } else {
        r0 = safeR0;
        r1 = safeR1;
      }

      if (side === "W") {
        cutRectToBg(grid, ts, r0, r1, 0, depth - 1);
      } else {
        cutRectToBg(grid, ts, r0, r1, ts - depth, ts - 1);
      }
    }
  }
}

function buildTile(
  def: TileDef,
  ts: number,
  cw: number,
  wt: number,
  ps: number,
  center: number,
  hw: number,
  rng: LCG,
): number[][] {
  const grid: number[][] = Array.from({ length: ts }, () =>
    new Array(ts).fill(WALL),
  );
  const [eN, eE, eS, eW] = def.edges;

  if (def.variant === "wall") return grid;

  if (def.variant === "background") {
    for (let y = 0; y < ts; y++)
      for (let x = 0; x < ts; x++) grid[y][x] = BG;
    return grid;
  }

  if (def.variant === "corridor") {
    if (eN || eS) {
      const yStart = eN ? 0 : wt;
      const yEnd = eS ? ts - 1 : ts - 1 - wt;
      for (let y = yStart; y <= yEnd; y++)
        for (let x = center - hw; x <= center + hw; x++) grid[y][x] = FLOOR;
    }
    if (eE || eW) {
      const xStart = eW ? 0 : wt;
      const xEnd = eE ? ts - 1 : ts - 1 - wt;
      for (let y = center - hw; y <= center + hw; y++)
        for (let x = xStart; x <= xEnd; x++) grid[y][x] = FLOOR;
    }
    return grid;
  }

  // Room: carve floor interior inside walls
  for (let y = wt; y < ts - wt; y++)
    for (let x = wt; x < ts - wt; x++) grid[y][x] = FLOOR;

  punchOpening(grid, ts, center, hw, wt, "N", eN);
  punchOpening(grid, ts, center, hw, wt, "E", eE);
  punchOpening(grid, ts, center, hw, wt, "S", eS);
  punchOpening(grid, ts, center, hw, wt, "W", eW);

  if (def.variant === "pillar") {
    addPillars(grid, ts, wt, ps, center, hw, def.edges);
  } else if (def.variant === "cover") {
    addCover(grid, ts, wt, center, hw, def.edges, rng);
  } else if (def.variant === "alcove") {
    addAlcoves(grid, ts, wt, center, hw, def.edges, rng);
  } else if (def.variant === "resource") {
    addResources(grid, ts, wt, center, hw, def.edges, rng);
  } else if (def.variant === "divided") {
    addDivider(grid, ts, wt, center, hw, def.edges, rng);
  } else if (def.variant === "barricade") {
    addBarricade(grid, ts, wt, center, hw, def.edges, rng);
  } else if (def.variant === "cross") {
    addCrossShape(grid, ts, wt, rng);
  } else if (def.variant === "irregular") {
    applyIrregularCuts(grid, ts, wt, center, hw, def.edges, rng);
  } else if (def.variant === "open") {
    for (let y = 0; y < ts; y++)
      for (let x = 0; x < ts; x++) grid[y][x] = FLOOR;
    const objs = 2 + Math.floor(rng.float01() * 3);
    for (let i = 0; i < objs; i++) {
      const py = 1 + Math.floor(rng.float01() * (ts - 2));
      const px = 1 + Math.floor(rng.float01() * (ts - 2));
      if (grid[py][px] === FLOOR) grid[py][px] = rng.float01() < 0.5 ? PILLAR : RESOURCE;
    }
  }

  return grid;
}

// ── Main export ──

export function wfcTileset(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const tileSize = ensureOdd(clamp(num(input.tileSize, 11), 7, 21));
  const corridorWidth = ensureOdd(
    clamp(num(input.corridorWidth, 3), 1, Math.floor(tileSize / 2)),
  );
  const wallThk = clamp(num(input.wallThickness, 1), 1, 3);
  const pillarSize = clamp(num(input.pillarSize, 2), 1, 4);
  const bgW = Math.max(0, Math.min(10, num(input.backgroundWeight, 3)));
  const irregRatio = Math.max(0, Math.min(1, num(input.irregularRatio, 0.3)));
  const lrW = Math.max(0, Math.min(10, num(input.largeRoomWeight, 2)));
  const density = Math.max(0, Math.min(1, num(input.densityBias, 0.5)));
  const seedRaw = num(input.seed, 0);
  // seed=0 → 当前时间戳（与 meta/README 描述一致：0=自动随机）。
  const baseSeed = seedRaw > 0 ? Math.floor(seedRaw) : (Date.now() & 0x7fffffff);
  const rng = new LCG(baseSeed);

  // bgW drives background density:
  //   bgTileWeight — absolute weight of the [0,0,0,0] background tile
  //   roomScale    — dampens ALL non-irregular room variants
  const bgTileWeight = bgW > 0 ? bgW * bgW : 0;
  const roomScale = 1 / (1 + bgW * 0.4);

  // irregRatio independently controls irregular variant proportion
  const irregFactor = irregRatio * 3.0;

  // lrW scales all type-2 (wide opening) tile weights
  const lrScale = 0.3 + lrW * 0.35;

  const center = Math.floor(tileSize / 2);
  const hw = Math.floor(corridorWidth / 2);

  // ── Build tile definitions ──
  const defs: TileDef[] = [];

  for (let mask = 0; mask < 16; mask++) {
    const edges: Edges = [
      (mask >> 3) & 1,
      (mask >> 2) & 1,
      (mask >> 1) & 1,
      mask & 1,
    ];
    const oc = edges[0] + edges[1] + edges[2] + edges[3];
    const isOpp =
      edges[0] === edges[2] &&
      edges[1] === edges[3] &&
      edges[0] !== edges[1];

    const rawW =
      oc === 0
        ? lerp(0.1, 0.5, density)
        : oc === 1
          ? lerp(0.8, 2.0, density)
          : oc === 2
            ? lerp(2.0, 4.0, density)
            : oc === 3
              ? lerp(2.5, 3.5, density)
              : lerp(1.5, 3.0, density);
    const baseW = rawW * roomScale;

    if (oc === 0) {
      const wallW = rawW * Math.max(0, 1 - bgW / 10);
      if (wallW > 0.01) defs.push({ edges, variant: "wall", weight: wallW });
      if (bgTileWeight > 0) defs.push({ edges, variant: "background", weight: bgTileWeight });
    } else {
      defs.push({ edges, variant: "room", weight: baseW });
    }

    if (oc === 2 && isOpp) {
      defs.push({ edges, variant: "corridor", weight: baseW * 0.7 });
    }

    if (oc >= 1) {
      defs.push({ edges, variant: "pillar", weight: baseW * 0.7 });
      defs.push({ edges, variant: "cover", weight: baseW * 0.6 });
      defs.push({ edges, variant: "resource", weight: baseW * 0.5 });
    }

    if (oc >= 2) {
      defs.push({ edges, variant: "barricade", weight: baseW * 0.35 });
    }

    if (oc >= 2 && oc < 4) {
      defs.push({ edges, variant: "alcove", weight: baseW * 0.25 });
    }

    if (oc >= 2) {
      defs.push({ edges, variant: "divided", weight: baseW * 0.3 });
    }

    if (oc >= 3) {
      defs.push({ edges, variant: "cross", weight: baseW * 0.25 });
    }

    if (oc >= 1 && oc <= 3 && irregFactor > 0.01) {
      defs.push({ edges, variant: "irregular", weight: rawW * irregFactor });
    }
  }

  // ── Large room tiles (edge type 2) ──
  const wideEdges: Edges[] = [
    [2, 2, 2, 2],
    [0, 2, 2, 0], [0, 0, 2, 2], [2, 0, 0, 2], [2, 2, 0, 0],
    [0, 2, 0, 2], [2, 0, 2, 0],
    [1, 2, 0, 0], [0, 1, 2, 0], [0, 0, 1, 2], [2, 0, 0, 1],
    [1, 0, 2, 0], [0, 1, 0, 2], [2, 0, 1, 0], [0, 2, 0, 1],
    [1, 2, 2, 0], [0, 1, 2, 2], [2, 0, 1, 2], [2, 2, 0, 1],
    [1, 2, 0, 2], [2, 1, 2, 0], [0, 2, 1, 2], [2, 0, 2, 1],
    [0, 2, 2, 2], [2, 0, 2, 2], [2, 2, 0, 2], [2, 2, 2, 0],
  ];
  const lw = lerp(0.8, 2.0, density) * roomScale * lrScale;
  for (const e of wideEdges) {
    defs.push({ edges: e, variant: "room", weight: lw });
    defs.push({ edges: e, variant: "pillar", weight: lw * 0.6 });
    defs.push({ edges: e, variant: "resource", weight: lw * 0.5 });
  }

  const coverWide: Edges[] = [
    [2, 2, 2, 2],
    [0, 2, 2, 0], [0, 0, 2, 2], [2, 0, 0, 2], [2, 2, 0, 0],
    [0, 2, 0, 2], [2, 0, 2, 0],
    [0, 2, 2, 2], [2, 0, 2, 2], [2, 2, 0, 2], [2, 2, 2, 0],
  ];
  for (const e of coverWide) {
    defs.push({ edges: e, variant: "cover", weight: lw * 0.5 });
    defs.push({ edges: e, variant: "divided", weight: lw * 0.3 });
  }

  // "open" variant: nearly all-floor with scattered pillars/resources
  const openEdges: Edges[] = [
    [2, 2, 2, 2],
    [0, 2, 2, 0], [0, 0, 2, 2], [2, 0, 0, 2], [2, 2, 0, 0],
    [0, 2, 2, 2], [2, 0, 2, 2], [2, 2, 0, 2], [2, 2, 2, 0],
  ];
  for (const e of openEdges) {
    defs.push({ edges: e, variant: "open", weight: lw * 0.8 });
  }

  const irregWide: Edges[] = [
    [0, 2, 2, 0], [0, 0, 2, 2], [2, 0, 0, 2], [2, 2, 0, 0],
    [1, 2, 0, 0], [0, 1, 2, 0], [0, 0, 1, 2], [2, 0, 0, 1],
  ];
  if (irregFactor > 0.01) {
    const ilw = lerp(0.8, 2.0, density) * irregFactor * lrScale;
    for (const e of irregWide) {
      defs.push({ edges: e, variant: "irregular", weight: ilw });
    }
  }

  // ── Generate tile grids ──
  const templates = defs.map((def) =>
    buildTile(def, tileSize, corridorWidth, wallThk, pillarSize, center, hw, rng),
  );

  // ── Compute adjacency (socket matching) ──
  const n = defs.length;
  const adjacency = defs.map((me) => {
    const rule: { N: number[]; S: number[]; E: number[]; W: number[] } = {
      N: [], S: [], E: [], W: [],
    };
    for (let j = 0; j < n; j++) {
      const them = defs[j].edges;
      if (me.edges[0] === them[2]) rule.N.push(j);
      if (me.edges[1] === them[3]) rule.E.push(j);
      if (me.edges[2] === them[0]) rule.S.push(j);
      if (me.edges[3] === them[1]) rule.W.push(j);
    }
    return rule;
  });

  const weights = defs.map((d) => d.weight);

  return { templates, adjacency, weights };
}
