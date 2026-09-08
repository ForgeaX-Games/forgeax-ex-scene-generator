/**
 * gridMaskClean: 对等高线网格列表做形态学清理。
 *
 * 正确处理流程：
 *   等高线列表每层是单层 mask（本层有值，其余为0），不能对单层做空白归并。
 *   因此先把所有层合并成一张完整地图，在合并图上执行清理，再拆回各层。
 *
 *   1. 合并（merge）：所有层叠加 → 每格取其所在层的值，构成完整地图
 *   2. 填充内部孔洞（hole fill）：0 连通域若被单一值包围且面积 ≤ minHoleSize，填充之
 *   3. 删除孤立小块（island remove）：非零连通域面积 < minIslandSize 则置0
 *   4. 空白归并（void fill）：残余0区域找边界相邻中最多的非零值，归并进去
 *   5. 拆回各层（split）：按每格的值分配回对应层，其余置0
 *
 * 输入：
 *   inputGrids    (array)  — 等高线网格列表，每层值=层序号，其余=0
 *   minHoleSize   (number) — 面积 ≤ 此值的内部孔洞被填充（默认 20）
 *   minIslandSize (number) — 面积 < 此值的孤立块被删除（默认 10）
 *
 * 输出：
 *   outputGrids   (array)  — 清理后的网格列表，长度与输入一致
 */

type Grid = number[][];

const DR = [-1, 1, 0, 0];
const DC = [0, 0, -1, 1];

// ─── Step 1: 合并所有层为一张完整地图 ─────────────────────────────────────────

function mergeLayers(grids: Grid[]): Grid {
  const rows = grids[0].length;
  const cols = grids[0][0].length;
  const merged: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));

  for (const g of grids) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (g[r][c] !== 0) merged[r][c] = g[r][c];
      }
    }
  }
  return merged;
}

// ─── BFS 收集连通域 ───────────────────────────────────────────────────────────

function bfsRegion(
  grid: Grid,
  startR: number,
  startC: number,
  visited: Uint8Array,
  rows: number,
  cols: number,
  targetValue: number
): { cells: [number, number][]; touchesBorder: boolean; neighborCount: Map<number, number> } {
  const cells: [number, number][] = [];
  const neighborCount = new Map<number, number>();
  let touchesBorder = false;

  const queue: [number, number][] = [[startR, startC]];
  visited[startR * cols + startC] = 1;

  while (queue.length > 0) {
    const [r, c] = queue.shift()!;
    cells.push([r, c]);
    if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) touchesBorder = true;

    for (let d = 0; d < 4; d++) {
      const nr = r + DR[d];
      const nc = c + DC[d];
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const nv = grid[nr][nc];
      if (nv !== targetValue) {
        if (nv !== 0) neighborCount.set(nv, (neighborCount.get(nv) ?? 0) + 1);
        continue;
      }
      if (visited[nr * cols + nc]) continue;
      visited[nr * cols + nc] = 1;
      queue.push([nr, nc]);
    }
  }

  return { cells, touchesBorder, neighborCount };
}

// ─── Step 2: 填充内部孔洞 ─────────────────────────────────────────────────────

function fillHoles(grid: Grid, minHoleSize: number): Grid {
  const rows = grid.length;
  const cols = grid[0].length;
  const result: Grid = grid.map((r) => [...r]);
  const visited = new Uint8Array(rows * cols);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (result[r][c] !== 0 || visited[r * cols + c]) continue;
      const { cells, touchesBorder, neighborCount } = bfsRegion(result, r, c, visited, rows, cols, 0);

      if (!touchesBorder && neighborCount.size === 1 && cells.length <= minHoleSize) {
        const fillVal = [...neighborCount.keys()][0];
        for (const [fr, fc] of cells) result[fr][fc] = fillVal;
      }
    }
  }
  return result;
}

// ─── Step 3: 删除孤立小块 ─────────────────────────────────────────────────────

function removeIslands(grid: Grid, minIslandSize: number): Grid {
  const rows = grid.length;
  const cols = grid[0].length;
  const result: Grid = grid.map((r) => [...r]);
  const visited = new Uint8Array(rows * cols);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = result[r][c];
      if (v === 0 || visited[r * cols + c]) continue;
      const { cells } = bfsRegion(result, r, c, visited, rows, cols, v);
      if (cells.length < minIslandSize) {
        for (const [dr, dc] of cells) result[dr][dc] = 0;
      }
    }
  }
  return result;
}

// ─── Step 4: 空白归并 ─────────────────────────────────────────────────────────

/**
 * 对合并图上所有残余 0 格，BFS 找连通域，取边界接触最多的非零层值填入。
 * 在合并图上操作：每格只有一个层值或0，归并结果是将空白划归到最近的层。
 */
function fillVoids(grid: Grid): Grid {
  const rows = grid.length;
  const cols = grid[0].length;
  const result: Grid = grid.map((r) => [...r]);
  const visited = new Uint8Array(rows * cols);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (result[r][c] !== 0 || visited[r * cols + c]) continue;
      const { cells, neighborCount } = bfsRegion(result, r, c, visited, rows, cols, 0);
      if (neighborCount.size === 0) continue;

      let bestVal = 0;
      let bestCount = 0;
      for (const [val, cnt] of neighborCount) {
        if (cnt > bestCount) { bestCount = cnt; bestVal = val; }
      }
      for (const [fr, fc] of cells) result[fr][fc] = bestVal;
    }
  }
  return result;
}

// ─── Step 5: 拆回各层 ─────────────────────────────────────────────────────────

function splitToLayers(merged: Grid, layerCount: number, rows: number, cols: number): Grid[] {
  const layers: Grid[] = Array.from({ length: layerCount }, () =>
    Array.from({ length: rows }, () => new Array(cols).fill(0))
  );

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = merged[r][c];
      if (v >= 1 && v <= layerCount) {
        layers[v - 1][r][c] = v;
      }
    }
  }
  return layers;
}

// ─── 主导出函数 ────────────────────────────────────────────────────────────────

export function gridMaskClean(input: Record<string, unknown>): Record<string, unknown> {
  const inputGrids = input.inputGrids as Grid[] | undefined;
  if (!Array.isArray(inputGrids) || inputGrids.length === 0) {
    return { error: "inputGrids is required and must be a non-empty array" };
  }

  const minHoleSize   = typeof input.minHoleSize   === "number" ? Math.max(1, Math.round(input.minHoleSize))   : 20;
  const minIslandSize = typeof input.minIslandSize === "number" ? Math.max(1, Math.round(input.minIslandSize)) : 10;

  const rows = inputGrids[0].length;
  const cols = inputGrids[0][0].length;
  const layerCount = inputGrids.length;

  // 1. 合并所有层为完整地图
  const merged = mergeLayers(inputGrids);

  // 2. 填充内部孔洞
  const afterFill = fillHoles(merged, minHoleSize);

  // 3. 删除孤立小块
  const afterRemove = removeIslands(afterFill, minIslandSize);

  // 4. 空白归并（在合并图上操作，不会把整层填满）
  const afterVoid = fillVoids(afterRemove);

  // 5. 拆回各层
  const outputGrids = splitToLayers(afterVoid, layerCount, rows, cols);

  return { outputGrids };
}
