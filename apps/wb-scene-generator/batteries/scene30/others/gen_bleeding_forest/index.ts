/**
 * gen_bleeding_forest: Cellular automata forest generator with random-walk path carving.
 * Produces dense forest with organic clearings, bioluminescent spots, dark pools, paths,
 * decors (mushrooms / glow plants), spawn point and portal — all encoded in the grid.
 *
 * Mask IDs:
 *   1 = 森林   (DENSE)
 *   2 = 地面   (CLEARING)
 *   3 = 土路   (PATH)
 *   4 = 发光区   (GLOW)
 *   5 = 暗池     (POOL)
 *   6 = 传送门   (PORTAL)
 *   7 = 营火   (SPAWN)
 *   8 = 蘑菇   (MUSHROOM)
 *   9 = 月光花 (GLOW_PLANT)
 *
 * Input:
 *   inputGrid — a single grid (number[][]) or a list of grids (number[][][]).
 *               Width and height are derived from the first grid in the list.
 *               When absent or empty, defaults to 72×72.
 * Output:
 *   outputGridList — list of single-value grids, one per mask ID present in the map.
 *   outputNameList — [{id, name, type}] with type "tile" or "asset".
 */

type NameEntry = { id: number; name: string; type: "tile" | "asset" };

const DENSE = 1, CLEARING = 2, PATH = 3, GLOW = 4, POOL = 5, PORTAL = 6, SPAWN = 7,
  MUSHROOM = 8, GLOW_PLANT = 9;

function makeLCG(seed: number): () => number {
  let s = (seed | 0) >>> 0;
  return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 0x100000000; };
}

function lcgInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function lcgPick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function countNeighbors(g: number[][], y: number, x: number, id: number, H: number, W: number): number {
  let c = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const ny = y + dy, nx = x + dx;
      if (ny < 0 || ny >= H || nx < 0 || nx >= W) c++;
      else if (g[ny][nx] === id) c++;
    }
  }
  return c;
}

/** Resolve width and height from inputGrid input.
 *  Accepts: single grid (number[][]) or list of grids (number[][][]).
 *  Returns [W, H] when a valid grid is found, or null when no input is provided. */
function resolveSize(inputGrid: unknown): [number, number] | null {
  if (!Array.isArray(inputGrid) || inputGrid.length === 0) return null;
  const first = inputGrid[0];
  let grid: number[][];
  if (Array.isArray(first) && Array.isArray(first[0])) {
    grid = inputGrid[0] as number[][];
  } else if (Array.isArray(first)) {
    grid = inputGrid as number[][];
  } else {
    return null;
  }
  const H = Math.max(30, grid.length);
  const W = Math.max(30, grid[0]?.length ?? 30);
  return [W, H];
}

export function genBleedingForest(input: Record<string, unknown>): Record<string, unknown> {
  const size = resolveSize(input.inputGrid);
  if (!size) {
    return { outputGridList: [], outputNameList: [] };
  }
  const [W, H] = size;
  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  const baseSeed = seedRaw === 0 ? Date.now() : seedRaw;
  const iterations = typeof input.iterations === "number" ? Math.max(1, Math.min(10, input.iterations)) : 9;
  const fillRatio = typeof input.fillRatio === "number" ? Math.max(0.3, Math.min(0.8, input.fillRatio)) : 0.51;
  const pathCount = typeof input.pathCount === "number" ? Math.max(0, input.pathCount) : 9;
  const poolCount = typeof input.poolCount === "number" ? Math.max(0, input.poolCount) : 19;
  const rng = makeLCG(baseSeed);

  // Initialize grid: border = DENSE, interior random
  let grid: number[][] = Array.from({ length: H }, (_, y) =>
    Array.from({ length: W }, (__, x) =>
      (x < 2 || x > W - 3 || y < 2 || y > H - 3) ? DENSE : rng() < fillRatio ? DENSE : CLEARING
    )
  );

  // Cellular automata iterations (birth >= 5, survive >= 4)
  for (let iter = 0; iter < iterations; iter++) {
    const next: number[][] = grid.map(r => [...r]);
    for (let y = 2; y < H - 2; y++) {
      for (let x = 2; x < W - 2; x++) {
        const denseN = countNeighbors(grid, y, x, DENSE, H, W);
        if (grid[y][x] === DENSE) next[y][x] = denseN >= 4 ? DENSE : CLEARING;
        else next[y][x] = denseN >= 5 ? DENSE : CLEARING;
      }
    }
    grid = next;
  }

  // Find largest clearing cluster via flood fill
  const visited: boolean[][] = Array.from({ length: H }, () => new Array(W).fill(false));
  let biggestCluster: [number, number][] = [];
  for (let sy = 2; sy < H - 2; sy++) {
    for (let sx = 2; sx < W - 2; sx++) {
      if (!visited[sy][sx] && grid[sy][sx] === CLEARING) {
        const cluster: [number, number][] = [];
        const stack: [number, number][] = [[sy, sx]];
        while (stack.length > 0) {
          const [cy, cx] = stack.pop()!;
          if (cx < 0 || cx >= W || cy < 0 || cy >= H || visited[cy][cx] || grid[cy][cx] === DENSE) continue;
          visited[cy][cx] = true;
          cluster.push([cy, cx]);
          stack.push([cy - 1, cx], [cy + 1, cx], [cy, cx - 1], [cy, cx + 1]);
        }
        if (cluster.length > biggestCluster.length) biggestCluster = cluster;
      }
    }
  }

  // Collect all clearings for path endpoints
  const allClearings: [number, number][] = [];
  for (let y = 2; y < H - 2; y++)
    for (let x = 2; x < W - 2; x++)
      if (grid[y][x] === CLEARING) allClearings.push([y, x]);

  // Carve random-walk paths between clearing pairs
  for (let p = 0; p < pathCount && allClearings.length >= 2; p++) {
    const [ay, ax] = lcgPick(rng, allClearings);
    const [by, bx] = lcgPick(rng, allClearings);
    let cx = ax, cy = ay;
    let safety = W * H;
    while ((cx !== bx || cy !== by) && safety-- > 0) {
      if (cx !== bx) cx += cx < bx ? 1 : -1;
      else cy += cy < by ? 1 : -1;
      if (cy >= 2 && cy < H - 2 && cx >= 2 && cx < W - 2 && grid[cy][cx] === DENSE)
        grid[cy][cx] = PATH;
    }
  }

  // Glow spots in clearings
  for (let y = 3; y < H - 3; y += 4)
    for (let x = 3; x < W - 3; x += 4)
      if (grid[y][x] === CLEARING && rng() < 0.25) grid[y][x] = GLOW;

  // Dark pools (scatter in non-DENSE areas)
  for (let p = 0; p < poolCount; p++) {
    const px = lcgInt(rng, 5, W - 6), py = lcgInt(rng, 5, H - 6);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const y = py + dy, x = px + dx;
        if (y >= 0 && y < H && x >= 0 && x < W && grid[y][x] !== DENSE)
          grid[y][x] = POOL;
      }
    }
  }

  // Portal in largest clearing
  const clusterForPortal = biggestCluster.length > 0 ? biggestCluster : allClearings;
  const [pty, ptx] = clusterForPortal.length > 0
    ? clusterForPortal[Math.floor(clusterForPortal.length * 0.8)]
    : [H >> 1, W >> 1];
  grid[pty][ptx] = PORTAL;

  // Spawn point at start of largest clearing
  const [sty, stx] = clusterForPortal.length > 0 ? clusterForPortal[0] : [3, 3];
  grid[sty][stx] = SPAWN;

  // Decors written into grid (mushrooms and glow plants)
  for (let y = 2; y < H - 2; y += 3)
    for (let x = 2; x < W - 2; x += 3)
      if (grid[y][x] === CLEARING && rng() < 0.2)
        grid[y][x] = MUSHROOM;

  for (let y = 2; y < H - 2; y++)
    for (let x = 2; x < W - 2; x++)
      if (grid[y][x] === GLOW && rng() < 0.4)
        grid[y][x] = GLOW_PLANT;

  const outputNameList: NameEntry[] = [
    { id: DENSE,      name: "森林",   type: "tile" },
    { id: CLEARING,   name: "地面",   type: "tile" },
    { id: PATH,       name: "土路",   type: "tile" },
    { id: GLOW,       name: "发光区",     type: "tile" },
    { id: POOL,       name: "暗池",       type: "tile" },
    { id: PORTAL,     name: "传送门",     type: "asset" },
    { id: SPAWN,      name: "营火",     type: "asset" },
    { id: MUSHROOM,   name: "蘑菇",     type: "asset" },
    { id: GLOW_PLANT, name: "月光花",   type: "asset" },
  ];

  // Only keep entries that actually appear in the grid
  const usedIds = new Set<number>();
  for (const row of grid) for (const v of row) usedIds.add(v);
  const filteredNameList = outputNameList.filter(e => usedIds.has(e.id));

  // Build single-value grids: one per mask ID
  // 地面（CLEARING）输出完整底层网格：所有非 DENSE 格子均为 1，作为其他层的底色基底
  const outputGridList = filteredNameList.map(entry => {
    if (entry.id === CLEARING) {
      return grid.map(row => row.map(v => (v !== DENSE ? 1 : 0)));
    }
    return grid.map(row => row.map(v => (v === entry.id ? 1 : 0)));
  });

  return {
    outputGridList,
    outputNameList: filteredNameList,
  };
}
