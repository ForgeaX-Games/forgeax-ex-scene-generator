/**
 * building_inner_door: 在建筑内墙上随机开门，确保所有室内房间互相连通
 * 输入：inputGrid (grid) — 建筑轮廓+内墙掩码，非零值为墙
 *       seed      (number) — 随机种子，0 使用当前时间戳
 * 输出：outputGrid (grid) — 在内墙上开好门洞的网格，门洞处=0
 *
 * 算法流程：
 *   1. BFS 标记所有 0 值连通分量
 *   2. 将 grid 四条边界上可达的分量识别为"建筑外部"，排除在外
 *   3. 扫描内墙段：墙格上下/左右两侧都是室内房间（非外部）且分属不同房间的连续墙格
 *   4. Kruskal 最小生成树：选最少墙段开门，保证所有室内房间全连通
 *   5. 每段选中内墙随机开 2~4 格宽的门洞（两端各留至少 1 格墙柱）
 */

/** 简单线性同余随机数生成器 */
function makeLCG(seed: number): () => number {
  let s = seed >>> 0;
  if (s === 0) s = Date.now() >>> 0;
  return function () {
    s = Math.imul(1664525, s) + 1013904223;
    s = s >>> 0;
    return s / 0x100000000;
  };
}

/** Fisher-Yates 洗牌，原地打乱数组 */
function shuffle<T>(arr: T[], rand: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/** 并查集（Union-Find） */
class UnionFind {
  private parent: number[];
  private rank: number[];

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array(n).fill(0);
  }

  find(x: number): number {
    if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x]);
    return this.parent[x];
  }

  union(x: number, y: number): boolean {
    const px = this.find(x);
    const py = this.find(y);
    if (px === py) return false;
    if (this.rank[px] < this.rank[py]) {
      this.parent[px] = py;
    } else if (this.rank[px] > this.rank[py]) {
      this.parent[py] = px;
    } else {
      this.parent[py] = px;
      this.rank[px]++;
    }
    return true;
  }

  connected(x: number, y: number): boolean {
    return this.find(x) === this.find(y);
  }
}

/**
 * BFS 标记所有值为 0 的连通分量，同时识别建筑外部区域。
 * 返回：
 *   labels      — 每个格子的分量 ID（-1 表示墙格）
 *   roomCount   — 分量总数
 *   exteriorIds — 建筑外部分量的 ID 集合（从四条边界可达的所有分量）
 */
function labelRegions(
  grid: number[][],
  rows: number,
  cols: number
): { labels: Int32Array; roomCount: number; exteriorIds: Set<number> } {
  const labels = new Int32Array(rows * cols).fill(-1);
  let roomCount = 0;

  const dx = [0, 0, 1, -1];
  const dy = [1, -1, 0, 0];

  function bfs(startKey: number, label: number): void {
    labels[startKey] = label;
    const queue = [startKey];
    let head = 0;
    while (head < queue.length) {
      const key = queue[head++];
      const cr = Math.floor(key / cols);
      const cc = key % cols;
      for (let d = 0; d < 4; d++) {
        const nr = cr + dx[d];
        const nc = cc + dy[d];
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        const nkey = nr * cols + nc;
        if (grid[nr][nc] === 0 && labels[nkey] === -1) {
          labels[nkey] = label;
          queue.push(nkey);
        }
      }
    }
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] === 0 && labels[r * cols + c] === -1) {
        bfs(r * cols + c, roomCount++);
      }
    }
  }

  // 收集所有从四条边界可达的分量 ID，视为建筑外部
  const exteriorIds = new Set<number>();
  for (let c = 0; c < cols; c++) {
    const t = labels[0 * cols + c];
    const b = labels[(rows - 1) * cols + c];
    if (t !== -1) exteriorIds.add(t);
    if (b !== -1) exteriorIds.add(b);
  }
  for (let r = 0; r < rows; r++) {
    const l = labels[r * cols + 0];
    const rr = labels[r * cols + cols - 1];
    if (l !== -1) exteriorIds.add(l);
    if (rr !== -1) exteriorIds.add(rr);
  }

  return { labels, roomCount, exteriorIds };
}

interface WallSegment {
  wallCells: number[]; // 连续墙格 key 列表（r*cols+c）
  roomA: number;       // 一侧室内房间 ID
  roomB: number;       // 另一侧室内房间 ID
}

/**
 * 扫描所有纯内墙段：
 * 墙格的上下（水平扫描）或左右（垂直扫描）两侧同时满足：
 *   - 都是值为 0 的空地
 *   - 都是室内房间（不在 exteriorIds 中）
 *   - 属于不同的连通分量（分隔两个不同房间）
 * 连续满足条件且房间对相同的墙格组成一段内墙段。
 */
function collectInnerWallSegments(
  grid: number[][],
  labels: Int32Array,
  rows: number,
  cols: number,
  exteriorIds: Set<number>
): WallSegment[] {
  const segments: WallSegment[] = [];

  function isIndoor(roomId: number): boolean {
    return roomId !== -1 && !exteriorIds.has(roomId);
  }

  // 水平扫描（同一行，上下两侧为不同室内房间）
  for (let r = 0; r < rows; r++) {
    let segStart = -1;
    let segRoomA = -1;
    let segRoomB = -1;

    for (let c = 0; c <= cols; c++) {
      let isInner = false;
      let roomA = -1;
      let roomB = -1;

      if (c < cols && grid[r][c] !== 0) {
        const top = r > 0       && grid[r - 1][c] === 0 ? labels[(r - 1) * cols + c] : -1;
        const bot = r < rows - 1 && grid[r + 1][c] === 0 ? labels[(r + 1) * cols + c] : -1;
        if (isIndoor(top) && isIndoor(bot) && top !== bot) {
          isInner = true;
          roomA = Math.min(top, bot);
          roomB = Math.max(top, bot);
        }
      }

      // 段中断或房间对变化 → 结束当前段
      if (segStart !== -1 && (!isInner || roomA !== segRoomA || roomB !== segRoomB)) {
        const cells: number[] = [];
        for (let wc = segStart; wc < c; wc++) cells.push(r * cols + wc);
        if (cells.length >= 2) segments.push({ wallCells: cells, roomA: segRoomA, roomB: segRoomB });
        segStart = -1;
      }

      if (isInner && segStart === -1) {
        segStart = c;
        segRoomA = roomA;
        segRoomB = roomB;
      }
    }
  }

  // 垂直扫描（同一列，左右两侧为不同室内房间）
  for (let c = 0; c < cols; c++) {
    let segStart = -1;
    let segRoomA = -1;
    let segRoomB = -1;

    for (let r = 0; r <= rows; r++) {
      let isInner = false;
      let roomA = -1;
      let roomB = -1;

      if (r < rows && grid[r][c] !== 0) {
        const left  = c > 0       && grid[r][c - 1] === 0 ? labels[r * cols + c - 1] : -1;
        const right = c < cols - 1 && grid[r][c + 1] === 0 ? labels[r * cols + c + 1] : -1;
        if (isIndoor(left) && isIndoor(right) && left !== right) {
          isInner = true;
          roomA = Math.min(left, right);
          roomB = Math.max(left, right);
        }
      }

      if (segStart !== -1 && (!isInner || roomA !== segRoomA || roomB !== segRoomB)) {
        const cells: number[] = [];
        for (let wr = segStart; wr < r; wr++) cells.push(wr * cols + c);
        if (cells.length >= 2) segments.push({ wallCells: cells, roomA: segRoomA, roomB: segRoomB });
        segStart = -1;
      }

      if (isInner && segStart === -1) {
        segStart = r;
        segRoomA = roomA;
        segRoomB = roomB;
      }
    }
  }

  return segments;
}

/**
 * 在一段内墙上随机开一个 minWidth~maxWidth 格宽的门洞。
 * 两端各保留至少 1 格墙柱；若墙段过短则居中开最小宽度。
 */
function openDoorOnSegment(
  segment: WallSegment,
  outputGrid: number[][],
  doorGrid: number[][],
  cols: number,
  rand: () => number,
  minWidth: number,
  maxWidth: number
): void {
  const cells = segment.wallCells;
  const segLen = cells.length;
  const maxAllowed = Math.min(maxWidth, segLen - 2);

  if (maxAllowed < minWidth) {
    // 空间不足两端留边，居中开门
    const doorWidth = Math.min(minWidth, segLen);
    const startIdx = Math.floor((segLen - doorWidth) / 2);
    for (let i = startIdx; i < startIdx + doorWidth; i++) {
      const key = cells[i];
      outputGrid[Math.floor(key / cols)][key % cols] = 0;
      doorGrid[Math.floor(key / cols)][key % cols] = 1;
    }
    return;
  }

  const doorWidth = minWidth + Math.floor(rand() * (maxAllowed - minWidth + 1));
  const startMin = 1;
  const startMax = segLen - doorWidth - 1;
  const startIdx = startMin + Math.floor(rand() * (startMax - startMin + 1));

  for (let i = startIdx; i < startIdx + doorWidth; i++) {
    const key = cells[i];
    outputGrid[Math.floor(key / cols)][key % cols] = 0;
    doorGrid[Math.floor(key / cols)][key % cols] = 1;
  }
}

function processOneGrid(
  inputGrid: number[][],
  seedRaw: number
): { outputGrid: number[][]; doorGrid: number[][] } {
  const rows = inputGrid.length;
  const cols = inputGrid[0].length;
  const rand = makeLCG(seedRaw);
  const outputGrid: number[][] = inputGrid.map(row => [...row]);
  const doorGrid: number[][] = inputGrid.map(row => row.map(() => 0));

  const { labels, roomCount, exteriorIds } = labelRegions(inputGrid, rows, cols);
  const indoorRoomIds: number[] = [];
  for (let i = 0; i < roomCount; i++) {
    if (!exteriorIds.has(i)) indoorRoomIds.push(i);
  }

  if (indoorRoomIds.length <= 1) return { outputGrid, doorGrid };

  const segments = collectInnerWallSegments(inputGrid, labels, rows, cols, exteriorIds);
  if (segments.length === 0) return { outputGrid, doorGrid };

  const idToIdx = new Map<number, number>();
  indoorRoomIds.forEach((id, idx) => idToIdx.set(id, idx));
  const uf = new UnionFind(indoorRoomIds.length);
  shuffle(segments, rand);

  const chosenSegments: WallSegment[] = [];
  for (const seg of segments) {
    const idxA = idToIdx.get(seg.roomA);
    const idxB = idToIdx.get(seg.roomB);
    if (idxA === undefined || idxB === undefined) continue;
    if (!uf.connected(idxA, idxB)) {
      uf.union(idxA, idxB);
      chosenSegments.push(seg);
    }
  }

  for (const seg of chosenSegments) {
    openDoorOnSegment(seg, outputGrid, doorGrid, cols, rand, 2, 4);
  }
  return { outputGrid, doorGrid };
}

export function buildingInnerDoor(input: Record<string, unknown>): Record<string, unknown> {
  const rawList = input.gridList ?? input.inputGrid;
  const seedRaw = typeof input.seed === "number" ? input.seed : 0;

  const gridList: number[][][] = Array.isArray(rawList)
    ? (Array.isArray(rawList[0]) && Array.isArray((rawList[0] as unknown[])[0])
        ? rawList as number[][][]
        : [rawList as number[][]])
    : [];

  if (gridList.length === 0) {
    return { error: "gridList is required and must be non-empty" };
  }

  const baseSeed = seedRaw === 0 ? Date.now() : seedRaw;
  const outputGridList: number[][][] = [];
  const doorGridList: number[][][] = [];

  gridList.forEach((grid, i) => {
    if (!grid || grid.length === 0 || !grid[0] || grid[0].length === 0) {
      outputGridList.push([]);
      doorGridList.push([]);
      return;
    }
    const effectiveSeed = baseSeed + i * 999983;
    const result = processOneGrid(grid, effectiveSeed);
    outputGridList.push(result.outputGrid);
    doorGridList.push(result.doorGrid);
  });

  return { outputGridList, doorGridList };
}
