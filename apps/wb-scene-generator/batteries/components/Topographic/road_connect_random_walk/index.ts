/**
 * roadConnectRandomWalk: 将一组 POI 点用横平竖直的道路全部连通，同时绕开障碍物。
 *
 * 算法流程：
 *   1. Prim 最小生成树：决定哪些点对需要连线（N个点只需 N-1 条边）
 *   2. A* 寻路（曼哈顿启发）：每条边在障碍物 grid 上找最短避障路径
 *   3. 路宽膨胀：把1格宽路径扩展到 roadWidth 格宽
 *   4. 写入输出 grid：道路格写入 roadValue
 *
 * 输入：
 *   poiGrid      (grid)   — POI 网格，自动取最大值格子作为连接点（无需手动指定 poiValue）
 *   obstacleGrid (grid)   — 障碍物网格，非零格不可通行（可选，不传则以 poiGrid 尺寸建空白障碍）
 *   roadWidth    (number) — 道路宽度（格），默认 1
 *   roadValue    (number) — 道路写入的值，默认 1
 *
 * 输出：
 *   outputGrid   (grid)   — 道路网格，道路格=roadValue，其余=0
 */

type Grid = number[][];
type Point = { x: number; y: number };

interface NameEntry { id: number; name: string; type: string; }

/** 将输入统一解析为 Grid[]，支持单个网格或网格列表 */
function parseInputGrids(raw: unknown): Grid[] | null {
  if (!raw || !Array.isArray(raw) || raw.length === 0) return null;
  if (Array.isArray(raw[0]) && typeof (raw[0] as unknown[])[0] === "number") {
    return [raw as Grid];
  }
  if (Array.isArray(raw[0]) && Array.isArray((raw[0] as unknown[])[0])) {
    return raw as Grid[];
  }
  return null;
}

// ─── A* 寻路 ──────────────────────────────────────────────────────────────────

class MinHeap {
  private heap: [number, number][] = []; // [f, nodeId]

  push(f: number, id: number) {
    this.heap.push([f, id]);
    this._bubbleUp(this.heap.length - 1);
  }

  pop(): [number, number] | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this._sinkDown(0);
    }
    return top;
  }

  get size() { return this.heap.length; }

  private _bubbleUp(i: number) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.heap[parent][0] <= this.heap[i][0]) break;
      [this.heap[parent], this.heap[i]] = [this.heap[i], this.heap[parent]];
      i = parent;
    }
  }

  private _sinkDown(i: number) {
    const n = this.heap.length;
    while (true) {
      let smallest = i;
      const l = 2 * i + 1, r = 2 * i + 2;
      if (l < n && this.heap[l][0] < this.heap[smallest][0]) smallest = l;
      if (r < n && this.heap[r][0] < this.heap[smallest][0]) smallest = r;
      if (smallest === i) break;
      [this.heap[smallest], this.heap[i]] = [this.heap[i], this.heap[smallest]];
      i = smallest;
    }
  }
}

const DR = [-1, 1, 0, 0];
const DC = [0, 0, -1, 1];

/**
 * A* 寻路，只允许上下左右移动（曼哈顿）。
 * 障碍格（obstacle[r][c] !== 0）不可通行，但起点和终点本身始终可通行。
 * 返回路径格子列表（含起终点），找不到时返回空数组。
 */
function aStar(
  startR: number, startC: number,
  endR: number, endC: number,
  obstacle: Grid,
  rows: number, cols: number
): [number, number][] {
  const id = (r: number, c: number) => r * cols + c;
  const heuristic = (r: number, c: number) => Math.abs(r - endR) + Math.abs(c - endC);

  const gScore = new Float32Array(rows * cols).fill(Infinity);
  const parent = new Int32Array(rows * cols).fill(-1);
  const startId = id(startR, startC);
  const endId = id(endR, endC);

  gScore[startId] = 0;
  const open = new MinHeap();
  open.push(heuristic(startR, startC), startId);

  while (open.size > 0) {
    const [, cur] = open.pop()!;
    if (cur === endId) break;

    const cr = Math.floor(cur / cols);
    const cc = cur % cols;
    const curG = gScore[cur];

    for (let d = 0; d < 4; d++) {
      const nr = cr + DR[d];
      const nc = cc + DC[d];
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;

      const nid = id(nr, nc);
      // 障碍格不可通行，但终点始终可达
      if (nid !== endId && obstacle[nr][nc] !== 0) continue;

      const ng = curG + 1;
      if (ng < gScore[nid]) {
        gScore[nid] = ng;
        parent[nid] = cur;
        open.push(ng + heuristic(nr, nc), nid);
      }
    }
  }

  // 重建路径
  if (gScore[endId] === Infinity) return [];
  const path: [number, number][] = [];
  let cur = endId;
  while (cur !== -1) {
    path.push([Math.floor(cur / cols), cur % cols]);
    cur = parent[cur];
  }
  return path.reverse();
}

// ─── Prim 最小生成树 ──────────────────────────────────────────────────────────

/**
 * 对 N 个点用 Prim 算法构造最小生成树（权重=曼哈顿距离）。
 * 返回需要连线的 N-1 条边 [[i, j], ...]。
 */
function primMST(points: Point[]): [number, number][] {
  const n = points.length;
  if (n <= 1) return [];

  const inMST = new Uint8Array(n);
  const minDist = new Float32Array(n).fill(Infinity);
  const minFrom = new Int32Array(n).fill(-1);
  const edges: [number, number][] = [];

  minDist[0] = 0;

  for (let step = 0; step < n; step++) {
    // 找未加入MST中距离最小的点
    let u = -1;
    for (let i = 0; i < n; i++) {
      if (!inMST[i] && (u === -1 || minDist[i] < minDist[u])) u = i;
    }
    inMST[u] = 1;
    if (minFrom[u] !== -1) edges.push([minFrom[u], u]);

    // 更新邻居距离
    for (let v = 0; v < n; v++) {
      if (inMST[v]) continue;
      const d = Math.abs(points[u].x - points[v].x) + Math.abs(points[u].y - points[v].y);
      if (d < minDist[v]) {
        minDist[v] = d;
        minFrom[v] = u;
      }
    }
  }

  return edges;
}

// ─── 路宽膨胀 ─────────────────────────────────────────────────────────────────

/**
 * 对 roadGrid 中所有 roadValue 格子，向四周膨胀 (roadWidth-1)/2 格。
 * 膨胀不会覆盖障碍物格子。
 */
function dilateRoad(
  roadGrid: Grid, obstacle: Grid,
  rows: number, cols: number,
  roadValue: number, roadWidth: number
): Grid {
  if (roadWidth <= 1) return roadGrid;
  const radius = Math.floor(roadWidth / 2);
  const result: Grid = roadGrid.map((r) => [...r]);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (roadGrid[r][c] !== roadValue) continue;
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          if (obstacle[nr][nc] !== 0) continue;
          result[nr][nc] = roadValue;
        }
      }
    }
  }
  return result;
}

// ─── 辅助：网格最大值 ─────────────────────────────────────────────────────────

function gridMax(grid: Grid): number {
  let max = 0;
  for (const row of grid) for (const v of row) if (v > max) max = v;
  return max;
}

// ─── 从 POI 网格中提取点坐标 ──────────────────────────────────────────────────

function extractPoints(poiGrid: Grid, poiValue: number): Point[] {
  const points: Point[] = [];
  for (let r = 0; r < poiGrid.length; r++) {
    for (let c = 0; c < poiGrid[r].length; c++) {
      if (poiGrid[r][c] === poiValue) {
        points.push({ x: c, y: r }); // x=列, y=行
      }
    }
  }
  return points;
}

// ─── 对单个 poiGrid 执行 A* 道路生成 ─────────────────────────────────────────

function processOnePoi(
  poiGrid: Grid,
  obstacle: Grid,
  rows: number,
  cols: number,
  roadWidth: number,
  roadValue: number,
): Grid {
  const poiValue = gridMax(poiGrid);
  const points = extractPoints(poiGrid, poiValue);
  const roadGrid: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));

  if (points.length === 0) return roadGrid;

  if (points.length === 1) {
    roadGrid[points[0].y][points[0].x] = roadValue;
  } else {
    const edges = primMST(points);
    for (const [i, j] of edges) {
      const pa = points[i];
      const pb = points[j];
      const path = aStar(pa.y, pa.x, pb.y, pb.x, obstacle, rows, cols);
      for (const [r, c] of path) roadGrid[r][c] = roadValue;
    }
  }

  return dilateRoad(roadGrid, obstacle, rows, cols, roadValue, roadWidth);
}

// ─── 主导出函数 ────────────────────────────────────────────────────────────────

export function roadConnectRandomWalk(input: Record<string, unknown>): Record<string, unknown> {
  const poiGrids = parseInputGrids(input.poiGrid);
  if (!poiGrids) {
    return { error: "poiGrid is required" };
  }

  const roadWidth = typeof input.roadWidth === "number" ? Math.max(1, Math.round(input.roadWidth)) : 1;
  const roadValue = typeof input.roadValue === "number" ? Math.round(input.roadValue) : 1;
  const coverPoi = input.coverPoi === true;

  let obstacle: Grid | null = null;
  let sharedRows = 0, sharedCols = 0;
  const obstacleGrid = input.obstacleGrid as Grid | undefined;
  if (Array.isArray(obstacleGrid) && obstacleGrid.length > 0 && obstacleGrid[0].length > 0) {
    obstacle = obstacleGrid;
    sharedRows = obstacle.length;
    sharedCols = obstacle[0].length;
  }

  const outputGridList: Grid[] = [];
  for (const poiGrid of poiGrids) {
    if (!poiGrid || poiGrid.length === 0 || poiGrid[0].length === 0) continue;
    const rows = obstacle ? sharedRows : poiGrid.length;
    const cols = obstacle ? sharedCols : poiGrid[0].length;
    const obs = obstacle ?? Array.from({ length: rows }, () => new Array(cols).fill(0));
    const roadGrid = processOnePoi(poiGrid, obs, rows, cols, roadWidth, roadValue);

    if (!coverPoi) {
      // 从道路中减去 POI 格点（POI 所在位置置 0）
      const poiValue = gridMax(poiGrid);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (poiGrid[r][c] === poiValue) {
            roadGrid[r][c] = 0;
          }
        }
      }
    }

    outputGridList.push(roadGrid);
  }

  const outputNameList: NameEntry[] = [
    { id: roadValue, name: "道路", type: "tile" },
  ];

  return { outputGridList, outputNameList };
}
