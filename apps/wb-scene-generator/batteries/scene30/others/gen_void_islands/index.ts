/**
 * gen_void_islands: Void floating islands generator using Prim's MST bridge algorithm.
 * Places circular island seeds in a zone grid, connects all via minimum spanning tree bridges.
 * All special tiles (spawn, portal, decors) are encoded as mask IDs in the grid.
 *
 * Mask IDs:
 *   1 = 虚空       (VOID)
 *   2 = 平台       (PLATFORM)
 *   3 = 桥梁       (BRIDGE)
 *   4 = 记忆碎片   (FRAGMENT)
 *   5 = 边缘光晕   (EDGE)
 *   6 = 传送门     (PORTAL)
 *   7 = 出生点     (SPAWN)
 *   8 = 虚空方尖碑 (OBELISK)
 *   9 = 虚空晶体   (CRYSTAL)
 */

type NameEntry = { id: number; name: string };
type IslandSeed = { x: number; y: number; r: number };

const VOID = 1, PLATFORM = 2, BRIDGE = 3, FRAGMENT = 4, EDGE = 5,
  PORTAL = 6, SPAWN = 7, OBELISK = 8, CRYSTAL = 9;

function makeLCG(seed: number): () => number {
  let s = (seed | 0) >>> 0;
  return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 0x100000000; };
}

function lcgInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function carveCircularIsland(grid: number[][], s: IslandSeed, H: number, W: number) {
  for (let dy = -s.r; dy <= s.r; dy++) {
    for (let dx = -s.r; dx <= s.r; dx++) {
      const dist = Math.sqrt(dx * dx + dy * dy);
      const y = s.y + dy, x = s.x + dx;
      if (y >= 1 && y < H - 1 && x >= 1 && x < W - 1 && dist <= s.r)
        grid[y][x] = PLATFORM;
    }
  }
  // Edge glow ring
  for (let dy = -s.r - 1; dy <= s.r + 1; dy++) {
    for (let dx = -s.r - 1; dx <= s.r + 1; dx++) {
      const dist = Math.sqrt(dx * dx + dy * dy);
      const y = s.y + dy, x = s.x + dx;
      if (y >= 1 && y < H - 1 && x >= 1 && x < W - 1 && grid[y][x] === VOID)
        if (dist > s.r && dist <= s.r + 1.5) grid[y][x] = EDGE;
    }
  }
}

function carveMSTBridge(grid: number[][], a: IslandSeed, b: IslandSeed, H: number, W: number) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return;
  const nx = dx / len, ny = dy / len;
  const px = -ny, py = nx;
  for (let t = a.r; t <= len - b.r; t += 0.5) {
    for (const off of [0, 1]) {
      const bx = Math.round(a.x + nx * t + px * off);
      const by = Math.round(a.y + ny * t + py * off);
      if (bx >= 0 && bx < W && by >= 0 && by < H && grid[by][bx] === VOID)
        grid[by][bx] = BRIDGE;
    }
  }
}

export function genVoidIslands(input: Record<string, unknown>): Record<string, unknown> {
  const W = typeof input.width === "number" ? Math.max(40, input.width) : 68;
  const H = typeof input.height === "number" ? Math.max(40, input.height) : 68;
  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  const baseSeed = seedRaw === 0 ? Date.now() : seedRaw;
  const N = typeof input.islandCount === "number" ? Math.max(3, Math.min(20, input.islandCount)) : 10;
  const minR = typeof input.islandMinR === "number" ? Math.max(2, input.islandMinR) : 4;
  const maxR = typeof input.islandMaxR === "number" ? Math.max(minR, input.islandMaxR) : 8;
  const rng = makeLCG(baseSeed);

  // Initialize as VOID
  const grid: number[][] = Array.from({ length: H }, () => new Array(W).fill(VOID));

  // Place island seeds in a zone grid for guaranteed reachable spacing
  const zoneW = Math.floor((W - 12) / Math.ceil(Math.sqrt(N)));
  const zoneH = Math.floor((H - 12) / Math.ceil(N / Math.ceil(Math.sqrt(N))));
  const cols = Math.ceil(Math.sqrt(N));
  const rows = Math.ceil(N / cols);
  const seeds: IslandSeed[] = [];

  for (let zy = 0; zy < rows && seeds.length < N; zy++) {
    for (let zx = 0; zx < cols && seeds.length < N; zx++) {
      const baseX = 6 + zx * zoneW + lcgInt(rng, 2, Math.max(2, zoneW - 2));
      const baseY = 6 + zy * zoneH + lcgInt(rng, 2, Math.max(2, zoneH - 2));
      const r = lcgInt(rng, minR, maxR);
      seeds.push({ x: Math.min(baseX, W - r - 2), y: Math.min(baseY, H - r - 2), r });
    }
  }

  // Carve islands
  for (const s of seeds) carveCircularIsland(grid, s, H, W);

  // Prim's MST to connect all islands
  const inMST = new Array(seeds.length).fill(false);
  inMST[0] = true;
  for (let step = 0; step < seeds.length - 1; step++) {
    let bestDist = Infinity, bestA = -1, bestB = -1;
    for (let i = 0; i < seeds.length; i++) {
      if (!inMST[i]) continue;
      for (let j = 0; j < seeds.length; j++) {
        if (inMST[j]) continue;
        const d = Math.sqrt((seeds[i].x - seeds[j].x) ** 2 + (seeds[i].y - seeds[j].y) ** 2);
        if (d < bestDist) { bestDist = d; bestA = i; bestB = j; }
      }
    }
    if (bestB >= 0) {
      inMST[bestB] = true;
      carveMSTBridge(grid, seeds[bestA], seeds[bestB], H, W);
    }
  }

  // Memory fragments on platforms
  for (const s of seeds) {
    for (let i = 0; i < 3; i++) {
      const fx = s.x + lcgInt(rng, -s.r + 1, s.r - 1);
      const fy = s.y + lcgInt(rng, -s.r + 1, s.r - 1);
      if (fy >= 0 && fy < H && fx >= 0 && fx < W && grid[fy][fx] === PLATFORM)
        grid[fy][fx] = FRAGMENT;
    }
  }

  // Portal on last island, spawn on first
  const ps = seeds[seeds.length - 1];
  grid[ps.y][ps.x] = PORTAL;
  const first = seeds[0];
  grid[first.y][first.x] = SPAWN;

  // Decors written into grid: obelisk (top of island) and crystal (random platform cells)
  for (const s of seeds) {
    const oy = s.y - Math.max(1, s.r - 2), ox = s.x;
    if (oy >= 0 && oy < H && ox >= 0 && ox < W && grid[oy][ox] === PLATFORM)
      grid[oy][ox] = OBELISK;
    for (let i = 0; i < 2; i++) {
      const fx = s.x + lcgInt(rng, -s.r + 2, s.r - 2);
      const fy = s.y + lcgInt(rng, -s.r + 2, s.r - 2);
      if (fy >= 0 && fy < H && fx >= 0 && fx < W && grid[fy][fx] === PLATFORM)
        grid[fy][fx] = CRYSTAL;
    }
  }

  const outputNameList: NameEntry[] = [
    { id: VOID,     name: "虚空" },
    { id: PLATFORM, name: "平台" },
    { id: BRIDGE,   name: "桥梁" },
    { id: FRAGMENT, name: "记忆碎片" },
    { id: EDGE,     name: "边缘光晕" },
    { id: PORTAL,   name: "传送门" },
    { id: SPAWN,    name: "出生点" },
    { id: OBELISK,  name: "虚空方尖碑" },
    { id: CRYSTAL,  name: "虚空晶体" },
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
