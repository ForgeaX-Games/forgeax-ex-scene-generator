/**
 * caveConnect: 洞穴连通性修复
 *
 * 对元胞自动机生成的洞穴网格进行连通性修复，使所有孤立空间都与主洞穴相通。
 *
 * 算法：
 *   1. BFS 标记所有"洞穴空间"（值=2）的连通区域
 *   2. 保留最大区域为主洞穴；面积 < minRegionSize 的孤立区域直接用墙填充
 *   3. 从主洞穴出发，BFS 穿越墙壁（值=1）找最近的孤立洞穴格子
 *   4. 沿 BFS 路径凿通隧道，每个凿点加法向随机抖动（jitterAmount）使边界不规则
 *   5. 重复直到所有区域联通
 *
 * 输入：caveGrids/caveGrid — 0=蒙版外, 1=洞穴墙, 2=洞穴空间（来自 cellular_automata）
 * 输出：connectedGrids/connectedGrid — 修复后的洞穴网格，所有空间区域相互联通
 */

// --- LCG 随机数 -------------------------------------------------------------

class LCG {
  private s: bigint;
  constructor(seed: number) {
    this.s = seed === 0 ? 12345n : BigInt(seed >>> 0);
  }
  next(): number {
    this.s = (this.s * 6364136223846793005n + 1442695040888963407n) & 0xffffffffffffffffn;
    return Number(this.s & 0xffffffffn) / 0x100000000;
  }
}

// --- 连通分量标记 -----------------------------------------------------------

interface Region {
  cells: number[];
  cellSet: Set<number>;
}

function labelCaveRegions(grid: number[][], w: number, h: number): Region[] {
  const visited = new Uint8Array(w * h);
  const regions: Region[] = [];
  const DIRS: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (grid[y][x] !== 2 || visited[idx]) continue;

      const cells: number[] = [];
      const queue: number[] = [idx];
      visited[idx] = 1;
      let head = 0;

      while (head < queue.length) {
        const cur = queue[head++];
        const cx = cur % w, cy = (cur / w) | 0;
        cells.push(cur);

        for (const [dx, dy] of DIRS) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const nIdx = ny * w + nx;
          if (visited[nIdx] || grid[ny][nx] !== 2) continue;
          visited[nIdx] = 1;
          queue.push(nIdx);
        }
      }

      regions.push({ cells, cellSet: new Set(cells) });
    }
  }

  return regions;
}

// --- 圆形膨胀凿洞（只改墙格，不改蒙版外格）---------------------------------

function carveCircle(
  grid: number[][],
  cx: number, cy: number,
  radius: number,
  w: number, h: number
): void {
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= r2) {
        const nx = cx + dx, ny = cy + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h && grid[ny][nx] === 1) {
          grid[ny][nx] = 2;
        }
      }
    }
  }
}

// --- 主连通算法 -------------------------------------------------------------
//
// 每轮：
//   1. 标记所有区域，按大小降序排列
//   2. 小区域（< minRegionSize）填墙移除，重新循环
//   3. 从最大区域（主洞穴）BFS 穿越墙壁找最近孤立洞穴格子
//   4. 沿路径凿通隧道，每个凿点加法向抖动，主洞穴扩大，继续下一轮

function connectAllRegions(
  grid: number[][],
  w: number, h: number,
  tunnelRadius: number,
  minRegionSize: number,
  jitterAmount: number,
  rng: LCG
): void {
  const DIRS: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  while (true) {
    const regions = labelCaveRegions(grid, w, h);
    if (regions.length <= 1) break;

    regions.sort((a, b) => b.cells.length - a.cells.length);

    // 移除面积过小的孤立区域（填墙）
    let removedAny = false;
    if (minRegionSize > 0) {
      for (let i = 1; i < regions.length; i++) {
        if (regions[i].cells.length < minRegionSize) {
          for (const idx of regions[i].cells) {
            grid[(idx / w) | 0][idx % w] = 1;
          }
          removedAny = true;
        }
      }
    }
    if (removedAny) continue;

    // BFS 从主洞穴出发，穿越墙壁，寻找最近的孤立洞穴格子
    const mainRegion = regions[0];
    const dist = new Int32Array(w * h).fill(-1);
    const parent = new Int32Array(w * h).fill(-1);
    const queue: number[] = [];

    for (const idx of mainRegion.cells) {
      dist[idx] = 0;
      queue.push(idx);
    }

    let found = -1;
    let head = 0;

    outer:
    while (head < queue.length) {
      const idx = queue[head++];
      const x = idx % w, y = (idx / w) | 0;

      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const nIdx = ny * w + nx;
        if (dist[nIdx] !== -1) continue;
        if (grid[ny][nx] === 0) continue; // 蒙版外，不穿越

        dist[nIdx] = dist[idx] + 1;
        parent[nIdx] = idx;

        // 找到孤立洞穴格子
        if (grid[ny][nx] === 2 && !mainRegion.cellSet.has(nIdx)) {
          found = nIdx;
          break outer;
        }

        queue.push(nIdx); // 继续穿越墙壁
      }
    }

    if (found === -1) break; // 所有区域已联通或无法再联通

    // 收集路径点（从孤立洞穴到主洞穴）
    const pathCells: number[] = [];
    let cur = found;
    while (cur !== -1 && !mainRegion.cellSet.has(cur)) {
      pathCells.push(cur);
      cur = parent[cur];
    }
    if (cur !== -1) pathCells.push(cur); // 末端主洞穴接口点

    // 沿路径凿通隧道，每个凿点加法向抖动使边界不规则
    for (let pi = 0; pi < pathCells.length; pi++) {
      const idx = pathCells[pi];
      let cx = idx % w, cy = (idx / w) | 0;

      if (jitterAmount > 0 && pathCells.length > 2) {
        // 用相邻路径点估算切线方向，取法向做抖动
        const prev = pathCells[Math.max(0, pi - 1)];
        const next = pathCells[Math.min(pathCells.length - 1, pi + 1)];
        const tdx = (next % w) - (prev % w);
        const tdy = ((next / w) | 0) - ((prev / w) | 0);
        const tlen = Math.sqrt(tdx * tdx + tdy * tdy) || 1;
        // 法向（切线旋转90°）
        const nx = -tdy / tlen;
        const ny =  tdx / tlen;
        // 随机法向偏移量（正负均可）
        const offset = (rng.next() - 0.5) * 2 * jitterAmount;
        cx = Math.round(cx + nx * offset);
        cy = Math.round(cy + ny * offset);
      }

      carveCircle(grid, cx, cy, tunnelRadius, w, h);
    }
  }
}

// --- 单张网格处理 -----------------------------------------------------------

function processOneGrid(
  rawGrid: unknown,
  tunnelRadius: number,
  minRegionSize: number,
  jitterAmount: number,
  rng: LCG
): number[][] | null {
  if (
    !Array.isArray(rawGrid) ||
    rawGrid.length === 0 ||
    !Array.isArray((rawGrid as unknown[][])[0])
  ) {
    return null;
  }
  const grid = (rawGrid as number[][]).map(row => [...row]);
  connectAllRegions(grid, grid[0].length, grid.length, tunnelRadius, minRegionSize, jitterAmount, rng);
  return grid;
}

// --- 主导出函数 -------------------------------------------------------------

export function caveConnect(
  input: Record<string, unknown>
): Record<string, unknown> {
  const tunnelRadius =
    typeof input.tunnelRadius === "number"
      ? Math.max(0, Math.round(input.tunnelRadius))
      : 1;
  const minRegionSize =
    typeof input.minRegionSize === "number"
      ? Math.max(0, Math.round(input.minRegionSize))
      : 0;
  const jitterAmount =
    typeof input.jitterAmount === "number"
      ? Math.max(0, input.jitterAmount)
      : 1.5;
  const seedRaw =
    typeof input.seed === "number" ? Math.round(input.seed) : 0;
  const baseSeed = seedRaw === 0 ? Date.now() : seedRaw;

  const raw = input.caveGrids ?? input.caveGrid;

  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: "caveGrids (or caveGrid) is required" };
  }

  // 判断是列表还是单张网格：元素是数组的数组 → 列表；元素是数字 → 单张行
  const isList = Array.isArray(raw[0]) && Array.isArray((raw[0] as unknown[])[0]);

  if (isList) {
    // 列表模式：每张用不同种子保证独立随机
    const connectedGrids = (raw as unknown[]).map((g, i) => {
      const rng = new LCG(baseSeed + i * 999983);
      return processOneGrid(g, tunnelRadius, minRegionSize, jitterAmount, rng);
    });
    if (connectedGrids.some(g => g === null)) {
      return { error: "one or more grids in caveGrids are invalid (expected number[][])" };
    }
    return { connectedGrids };
  } else {
    // 单张模式
    const rng = new LCG(baseSeed);
    const result = processOneGrid(raw, tunnelRadius, minRegionSize, jitterAmount, rng);
    if (result === null) {
      return { error: "caveGrid must be a number[][]" };
    }
    return { connectedGrid: result };
  }
}
