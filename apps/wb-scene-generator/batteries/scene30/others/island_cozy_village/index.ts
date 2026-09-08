/**
 * islandCozyVillage: 生成一片悠闲海岛地图，岛上有沙滩、草地、树木、小屋和码头。
 * 输入: width(number) height(number) seed(number) islandCount(number) houseCount(number)
 * 输出: outputGrid(grid), outputNameList(array)
 */

type Grid = number[][];

// 地块 ID 定义
const TILE = {
  OCEAN: 1,       // 海洋（深水）
  SHALLOW: 2,     // 浅海/礁石区
  BEACH: 3,       // 沙滩
  GRASS: 4,       // 草地
  FOREST: 5,      // 树林
  HOUSE: 6,       // 民居（悠闲小屋）
  DOCK: 7,        // 码头/栈桥
  PATH: 8,        // 石板路
  FLOWER: 9,      // 花草地
} as const;

// ======================== LCG 伪随机 ========================
function makeLCG(seed: number) {
  let s = seed >>> 0;
  if (s === 0) s = 123456789;
  return {
    next(): number {
      s = ((s * 1664525 + 1013904223) >>> 0);
      return s / 4294967296;
    },
    nextInt(min: number, max: number): number {
      return Math.floor(this.next() * (max - min + 1)) + min;
    },
  };
}

// ======================== 三次样条辅助（Catmull-Rom风格，一维周期序列） ========================
// 让 radii 控制点之间过渡更平滑，消除线性插值产生的尖角/单格凸点
function catmullRomPeriodic(arr: number[], t: number): number {
  const n = arr.length;
  const lo = Math.floor(t) % n;
  const p0 = arr[((lo - 1) + n) % n];
  const p1 = arr[lo];
  const p2 = arr[(lo + 1) % n];
  const p3 = arr[(lo + 2) % n];
  const tt = t - Math.floor(t);
  // Catmull-Rom
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * tt +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * tt * tt +
    (-p0 + 3 * p1 - 3 * p2 + p3) * tt * tt * tt
  );
}

// 更有机的岛屿形状（控制点+Catmull-Rom样条，边缘连续，无单点凸起）
function generateOrganicIsland(
  width: number, height: number,
  cx: number, cy: number, baseR: number,
  rng: ReturnType<typeof makeLCG>
): boolean[][] {
  // 控制点数较少（12），两两之间会被样条平滑过渡
  // 变化量限制在 0.75~1.25，避免极端凸出
  const angleSteps = 12;
  const radii: number[] = [];
  for (let i = 0; i < angleSteps; i++) {
    const variation = rng.next() * 0.5 + 0.75; // 0.75~1.25
    radii.push(baseR * variation);
  }

  const mask: boolean[][] = Array.from({ length: height }, () => new Array(width).fill(false));
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const dx = c - cx;
      const dy = r - cy;
      const angle = Math.atan2(dy, dx);
      const normalizedAngle = ((angle / (2 * Math.PI)) + 1) % 1;
      const idx = normalizedAngle * angleSteps;
      // 用 Catmull-Rom 插值取当前方向的岛缘半径，曲线C1连续，无尖角
      const r0 = catmullRomPeriodic(radii, idx);
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < r0) {
        mask[r][c] = true;
      }
    }
  }
  return mask;
}

// ======================== 地形分层 ========================
function assignBiome(
  grid: Grid, islandMask: boolean[][],
  cx: number, cy: number,
  width: number, height: number,
  islandRadius: number
): void {
  // 用实际岛屿半径归一化距离比（0=中心，1=边缘）
  const maxR = islandRadius;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (!islandMask[r][c]) continue;
      const dx = c - cx;
      const dy = r - cy;
      const ratio = Math.sqrt(dx * dx + dy * dy) / maxR;

      if (ratio > 0.78) {
        grid[r][c] = TILE.BEACH;
      } else if (ratio > 0.5) {
        grid[r][c] = TILE.GRASS;
      } else if (ratio > 0.25) {
        grid[r][c] = TILE.FOREST;
      } else {
        grid[r][c] = TILE.GRASS;
      }
    }
  }
}

/**
 * 树林后处理：摘掉四邻域内与其它「树林」连接数 ≤1 的格子（端点/孤立点），消除单格凸刺。
 * 多轮迭代直到无变化；剥除后新露出的端点会在下一轮继续剥除。
 */
function smoothForestSpurs(grid: Grid, height: number, width: number): void {
  const maxIter = width * height + 4;
  for (let iter = 0; iter < maxIter; iter++) {
    const toGrass: [number, number][] = [];
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        if (grid[r][c] !== TILE.FOREST) continue;
        let n = 0;
        if (r > 0 && grid[r - 1][c] === TILE.FOREST) n++;
        if (r + 1 < height && grid[r + 1][c] === TILE.FOREST) n++;
        if (c > 0 && grid[r][c - 1] === TILE.FOREST) n++;
        if (c + 1 < width && grid[r][c + 1] === TILE.FOREST) n++;
        if (n <= 1) toGrass.push([r, c]);
      }
    }
    if (toGrass.length === 0) break;
    for (const [r, c] of toGrass) {
      if (grid[r][c] === TILE.FOREST) grid[r][c] = TILE.GRASS;
    }
  }
}

// ======================== 浅海过渡带（扩展为 3 格宽，形成渐进过渡带） ========================
function addShallowWater(grid: Grid, height: number, width: number): void {
  // 多次膨胀：先找紧邻陆地的海洋格，标为 SHALLOW；再对 SHALLOW 格向外继续膨胀 2 轮
  const PASSES = 3; // 浅海宽度（格数）
  for (let pass = 0; pass < PASSES; pass++) {
    const temp = grid.map(row => [...row]);
    for (let r = 1; r < height - 1; r++) {
      for (let c = 1; c < width - 1; c++) {
        if (temp[r][c] !== TILE.OCEAN) continue;
        // 8 邻域内有陆地（BEACH/GRASS/FOREST/HOUSE/PATH/FLOWER/DOCK）或已是 SHALLOW
        const neighbors = [
          temp[r - 1][c], temp[r + 1][c], temp[r][c - 1], temp[r][c + 1],
          temp[r - 1][c - 1], temp[r - 1][c + 1], temp[r + 1][c - 1], temp[r + 1][c + 1],
        ];
        if (neighbors.some(v => v !== TILE.OCEAN)) {
          grid[r][c] = TILE.SHALLOW;
        }
      }
    }
  }
}

// ======================== 花草地散布 ========================
function scatterFlowers(grid: Grid, height: number, width: number, rng: ReturnType<typeof makeLCG>): void {
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (grid[r][c] === TILE.GRASS && rng.next() < 0.08) {
        grid[r][c] = TILE.FLOWER;
      }
    }
  }
}

// ======================== 码头放置 ========================
function placeDock(grid: Grid, height: number, width: number, islandMask: boolean[][], rng: ReturnType<typeof makeLCG>): void {
  // 找沙滩格子，在边缘沿海放一条短栈桥
  const beachCells: [number, number][] = [];
  for (let r = 2; r < height - 2; r++) {
    for (let c = 2; c < width - 2; c++) {
      if (grid[r][c] === TILE.BEACH) {
        const nearOcean = [
          [r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1],
        ].some(([nr, nc]) => grid[nr][nc] === TILE.OCEAN || grid[nr][nc] === TILE.SHALLOW);
        if (nearOcean) beachCells.push([r, c]);
      }
    }
  }
  if (beachCells.length === 0) return;

  const [br, bc] = beachCells[rng.nextInt(0, beachCells.length - 1)];
  // 向外延伸3格作为码头
  const dirs: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (const [dr, dc] of dirs) {
    const nr = br + dr;
    const nc = bc + dc;
    if (nr >= 0 && nr < height && nc >= 0 && nc < width &&
      (grid[nr][nc] === TILE.OCEAN || grid[nr][nc] === TILE.SHALLOW)) {
      grid[br][bc] = TILE.DOCK;
      for (let step = 1; step <= 3; step++) {
        const r2 = br + dr * step;
        const c2 = bc + dc * step;
        if (r2 >= 0 && r2 < height && c2 >= 0 && c2 < width) {
          grid[r2][c2] = TILE.DOCK;
        }
      }
      break;
    }
  }
}

// ======================== 小屋放置 ========================
function placeHouses(
  grid: Grid, height: number, width: number,
  houseCount: number,
  rng: ReturnType<typeof makeLCG>
): void {
  const grassCells: [number, number][] = [];
  for (let r = 2; r < height - 2; r++) {
    for (let c = 2; c < width - 2; c++) {
      if (grid[r][c] === TILE.GRASS || grid[r][c] === TILE.FLOWER) {
        grassCells.push([r, c]);
      }
    }
  }
  if (grassCells.length === 0) return;

  const placed: [number, number][] = [];
  let attempts = 0;
  while (placed.length < houseCount && attempts < 500) {
    attempts++;
    const idx = rng.nextInt(0, grassCells.length - 1);
    const [hr, hc] = grassCells[idx];
    // 保持房屋间距
    const tooClose = placed.some(([pr, pc]) => Math.abs(pr - hr) < 5 && Math.abs(pc - hc) < 5);
    if (!tooClose) {
      grid[hr][hc] = TILE.HOUSE;
      placed.push([hr, hc]);
    }
  }

  // 在房屋之间/周围铺一些小路
  for (const [hr, hc] of placed) {
    const pathDirs: [number, number][] = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    const dir = pathDirs[rng.nextInt(0, 3)];
    for (let step = 1; step <= rng.nextInt(2, 5); step++) {
      const pr = hr + dir[0] * step;
      const pc = hc + dir[1] * step;
      if (pr >= 0 && pr < height && pc >= 0 && pc < width &&
        (grid[pr][pc] === TILE.GRASS || grid[pr][pc] === TILE.FLOWER || grid[pr][pc] === TILE.BEACH)) {
        grid[pr][pc] = TILE.PATH;
      }
    }
  }
}

// ======================== 主函数 ========================
export function islandCozyVillage(input: Record<string, unknown>): Record<string, unknown> {
  const width = typeof input.width === "number" ? Math.max(40, input.width) : 80;
  const height = typeof input.height === "number" ? Math.max(40, input.height) : 80;
  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  const islandCount = typeof input.islandCount === "number" ? Math.max(1, Math.min(4, input.islandCount)) : 2;
  const houseCount = typeof input.houseCount === "number" ? Math.max(1, Math.min(12, input.houseCount)) : 4;

  const baseSeed = seedRaw === 0 ? Date.now() : seedRaw;
  const rng = makeLCG(baseSeed);

  // 初始化海洋底图
  const grid: Grid = Array.from({ length: height }, () => new Array(width).fill(TILE.OCEAN));

  // 生成若干岛屿
  const islandCenters: [number, number][] = [];
  const marginX = Math.floor(width * 0.2);
  const marginY = Math.floor(height * 0.2);

  for (let i = 0; i < islandCount; i++) {
    const attempts = 60;
    let placed = false;
    for (let a = 0; a < attempts; a++) {
      const cx = rng.nextInt(marginX, width - marginX);
      const cy = rng.nextInt(marginY, height - marginY);
      const baseR = rng.nextInt(
        Math.floor(Math.min(width, height) * 0.12),
        Math.floor(Math.min(width, height) * 0.26)
      );

      // 避免岛屿重叠太多
      const tooClose = islandCenters.some(([px, py]) => {
        const d = Math.sqrt((cx - px) ** 2 + (cy - py) ** 2);
        return d < baseR * 2.5;
      });
      if (tooClose) continue;

      const islandRng = makeLCG(baseSeed + i * 999983 + a * 37);
      const mask = generateOrganicIsland(width, height, cx, cy, baseR, islandRng);
      assignBiome(grid, mask, cx, cy, width, height, baseR);
      islandCenters.push([cx, cy]);
      placed = true;
      break;
    }
    if (!placed && islandCenters.length === 0) {
      // 至少放一个主岛
      const cx = Math.floor(width / 2);
      const cy = Math.floor(height / 2);
      const baseR = Math.floor(Math.min(width, height) * 0.2);
      const islandRng = makeLCG(baseSeed + i * 999983);
      const mask = generateOrganicIsland(width, height, cx, cy, baseR, islandRng);
      assignBiome(grid, mask, cx, cy, width, height, baseR);
      islandCenters.push([cx, cy]);
    }
  }

  // 树林边界后处理：去掉单格凸刺（四向仅连 0/1 个树林邻格）
  smoothForestSpurs(grid, height, width);

  // 添加浅海过渡
  addShallowWater(grid, height, width);

  // 为每个岛屿放置码头和房屋
  for (let i = 0; i < islandCenters.length; i++) {
    const islandRng = makeLCG(baseSeed + i * 777777);
    // 找属于这个岛的掩码
    const [cx, cy] = islandCenters[i];
    // 简单：为每个岛计算其覆盖格子
    const islandMask: boolean[][] = Array.from({ length: height }, () => new Array(width).fill(false));
    // 不需要精确 mask，直接用 grid 中非 ocean/shallow 的格子
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        islandMask[r][c] = grid[r][c] !== TILE.OCEAN && grid[r][c] !== TILE.SHALLOW;
      }
    }
    placeDock(grid, height, width, islandMask, islandRng);
    const housesForThisIsland = Math.max(1, Math.round(houseCount / islandCount));
    const houseRng = makeLCG(baseSeed + i * 999983);
    placeHouses(grid, height, width, housesForThisIsland, houseRng);
  }

  // 散布花草
  scatterFlowers(grid, height, width, makeLCG(baseSeed + 111));

  // 构建名称清单（严格 {id, name, type}）
  const outputNameList = [
    { id: TILE.OCEAN, name: "海洋", type: "tile" },
    { id: TILE.SHALLOW, name: "浅海", type: "tile" },
    { id: TILE.BEACH, name: "沙滩", type: "tile" },
    { id: TILE.GRASS, name: "草地", type: "tile" },
    { id: TILE.FOREST, name: "树林", type: "asset" },
    { id: TILE.HOUSE, name: "民居", type: "asset" },
    { id: TILE.DOCK, name: "码头", type: "tile" },
    { id: TILE.PATH, name: "石板路", type: "tile" },
    { id: TILE.FLOWER, name: "花丛", type: "asset" },
  ];

  // 只保留 grid 中实际出现的 id
  const usedIds = new Set<number>();
  for (const row of grid) for (const v of row) usedIds.add(v);
  const filteredNameList = outputNameList.filter(e => usedIds.has(e.id));

  return {
    outputGrid: grid,
    outputNameList: filteredNameList,
  };
}
