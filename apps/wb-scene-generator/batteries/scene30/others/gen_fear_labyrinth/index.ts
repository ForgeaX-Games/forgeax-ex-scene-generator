/**
 * gen_fear_labyrinth: DFS perfect maze generator with fear chambers, vein walls, and crystals.
 * Produces a complete maze with widened intersection chambers and blood-vein accents.
 * All special tiles (spawn, portal, decors) are encoded as mask IDs in the grid.
 *
 * Mask IDs:
 *   1 = 墙体     (WALL)
 *   2 = 通道     (FLOOR)
 *   3 = 血渍     (VEIN)
 *   4 = 恐惧房间 (CHAMBER)
 *   5 = 血晶     (CRYSTAL)
 *   6 = 传送门   (PORTAL)
 *   7 = 出生点   (SPAWN)
 *   8 = 骷髅装饰 (SKULL)
 *   9 = 恐惧之眼 (EYE)
 */

type NameEntry = { id: number; name: string };

const WALL = 1, FLOOR = 2, VEIN = 3, CHAMBER = 4, CRYSTAL = 5, PORTAL = 6, SPAWN = 7,
  SKULL = 8, EYE = 9;

function makeLCG(seed: number): () => number {
  let s = (seed | 0) >>> 0;
  return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 0x100000000; };
}

function lcgShuffle<T>(rng: () => number, arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function genFearLabyrinth(input: Record<string, unknown>): Record<string, unknown> {
  // DFS maze requires odd dimensions; clamp and force odd
  let W = typeof input.width === "number" ? Math.max(11, input.width) : 65;
  let H = typeof input.height === "number" ? Math.max(11, input.height) : 65;
  if (W % 2 === 0) W++;
  if (H % 2 === 0) H++;

  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  const baseSeed = seedRaw === 0 ? Date.now() : seedRaw;
  const chamberChance = typeof input.chamberChance === "number" ? Math.max(0, Math.min(1, input.chamberChance)) : 0.2;
  const veinChance = typeof input.veinChance === "number" ? Math.max(0, Math.min(1, input.veinChance)) : 0.08;
  const crystalChance = typeof input.crystalChance === "number" ? Math.max(0, Math.min(1, input.crystalChance)) : 0.15;
  const rng = makeLCG(baseSeed);

  // Initialize all cells as WALL
  const grid: number[][] = Array.from({ length: H }, () => new Array(W).fill(WALL));
  const visited: boolean[][] = Array.from({ length: H }, () => new Array(W).fill(false));

  // Iterative DFS maze (cells at odd coordinates)
  const dfsStack: [number, number][] = [[1, 1]];
  visited[1][1] = true;
  grid[1][1] = FLOOR;

  while (dfsStack.length > 0) {
    const [y, x] = dfsStack[dfsStack.length - 1];
    const dirs = lcgShuffle(rng, [[0, 2], [0, -2], [2, 0], [-2, 0]] as [number, number][]);
    let moved = false;
    for (const [dy, dx] of dirs) {
      const ny = y + dy, nx = x + dx;
      if (ny >= 1 && ny < H - 1 && nx >= 1 && nx < W - 1 && !visited[ny][nx]) {
        visited[ny][nx] = true;
        grid[y + dy / 2][x + dx / 2] = FLOOR;
        grid[ny][nx] = FLOOR;
        dfsStack.push([ny, nx]);
        moved = true;
        break;
      }
    }
    if (!moved) dfsStack.pop();
  }

  // Fear chambers: widen intersections at grid positions
  for (let y = 3; y < H - 3; y += 4) {
    for (let x = 3; x < W - 3; x += 4) {
      if (grid[y][x] === FLOOR && rng() < chamberChance) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const ny = y + dy, nx = x + dx;
            if (ny >= 0 && ny < H && nx >= 0 && nx < W) grid[ny][nx] = CHAMBER;
          }
        }
      }
    }
  }

  // Vein tiles adjacent to floors
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (grid[y][x] === WALL && rng() < veinChance) {
        const adjFloor = (grid[y - 1]?.[x] !== WALL) || (grid[y + 1]?.[x] !== WALL) ||
                         (grid[y]?.[x - 1] !== WALL) || (grid[y]?.[x + 1] !== WALL);
        if (adjFloor) grid[y][x] = VEIN;
      }
    }
  }

  // Fear crystals in chambers
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++)
      if (grid[y][x] === CHAMBER && rng() < crystalChance) grid[y][x] = CRYSTAL;

  // Portal in lower-right area (first usable FLOOR or CHAMBER cell)
  let ptx = W - 3, pty = H - 3;
  outer: for (let y = H - 3; y > Math.floor(H / 2); y--) {
    for (let x = W - 3; x > Math.floor(W / 2); x--) {
      if (grid[y][x] === FLOOR || grid[y][x] === CHAMBER) { ptx = x; pty = y; break outer; }
    }
  }
  grid[pty][ptx] = PORTAL;

  // Spawn point at top-left entrance
  grid[1][1] = SPAWN;

  // Skull decors on floor tiles (every 6 steps), written into grid
  for (let y = 2; y < H - 2; y += 6)
    for (let x = 2; x < W - 2; x += 6)
      if (grid[y][x] === FLOOR) grid[y][x] = SKULL;

  // Eye decor: one POI per connected CHAMBER cluster (flood-fill each cluster, pick center cell)
  const chamberVisited: boolean[][] = Array.from({ length: H }, () => new Array(W).fill(false));
  for (let sy = 1; sy < H - 1; sy++) {
    for (let sx = 1; sx < W - 1; sx++) {
      if (chamberVisited[sy][sx] || grid[sy][sx] !== CHAMBER) continue;
      // BFS to collect this cluster
      const cluster: [number, number][] = [];
      const bfsQ: [number, number][] = [[sy, sx]];
      chamberVisited[sy][sx] = true;
      while (bfsQ.length > 0) {
        const [cy, cx] = bfsQ.shift()!;
        cluster.push([cy, cx]);
        for (const [dy, dx] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as [number, number][]) {
          const ny = cy + dy, nx = cx + dx;
          if (ny >= 0 && ny < H && nx >= 0 && nx < W && !chamberVisited[ny][nx] && grid[ny][nx] === CHAMBER) {
            chamberVisited[ny][nx] = true;
            bfsQ.push([ny, nx]);
          }
        }
      }
      // Pick the cell closest to the cluster's centroid as the POI
      const ccy = cluster.reduce((s, [y]) => s + y, 0) / cluster.length;
      const ccx = cluster.reduce((s, [, x]) => s + x, 0) / cluster.length;
      let bestDist = Infinity, bestY = cluster[0][0], bestX = cluster[0][1];
      for (const [y, x] of cluster) {
        const d = (y - ccy) ** 2 + (x - ccx) ** 2;
        if (d < bestDist) { bestDist = d; bestY = y; bestX = x; }
      }
      grid[bestY][bestX] = EYE;
    }
  }

  const outputNameList: NameEntry[] = [
    { id: WALL,    name: "墙体" },
    { id: FLOOR,   name: "通道" },
    { id: VEIN,    name: "血渍" },
    { id: CHAMBER, name: "恐惧房间" },
    { id: CRYSTAL, name: "血晶" },
    { id: PORTAL,  name: "传送门" },
    { id: SPAWN,   name: "出生点" },
    { id: SKULL,   name: "骷髅装饰" },
    { id: EYE,     name: "恐惧之眼" },
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
