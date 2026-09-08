/**
 * rectPoiPlace: 对网格列表中每个有值区域，在其边缘随机生成 POI 点位。
 *
 * 算法流程：
 *   1. 合并所有输入网格，找全局最大非零值作为点位写入值（poiValue）
 *   2. 对每个输入网格：
 *      a. 找出所有有值区域的"边缘格"（本格有值，且至少有一个4邻格为0）
 *      b. 从边缘格中按 count 随机采样（不重复），写入 poiValue
 *   3. 所有层的点位叠加到同一张输出网格
 *
 * 输入：
 *   inputGrids (array)  — 网格列表，每个 grid 代表一个区域层
 *   count      (number) — 每个网格生成的点位数量，默认 3
 *   seed       (number) — 随机种子，0 使用当前时间
 *
 * 输出：
 *   outputGrid (grid)   — 点位网格，点位格=所有输入网格最大值，其余=0
 */

type Grid = number[][];

// ─── PRNG ─────────────────────────────────────────────────────────────────────

class SeededRandom {
  private s: number;

  constructor(seed: number) {
    this.s = seed === 0 ? Date.now() >>> 0 : (Math.abs(Math.round(seed)) >>> 0) || 1;
    for (let i = 0; i < 8; i++) this.next();
  }

  next(): number {
    this.s = (this.s * 1664525 + 1013904223) >>> 0;
    return this.s / 0xffffffff;
  }

  // Fisher-Yates 原地洗牌，返回前 k 个元素
  sample<T>(arr: T[], k: number): T[] {
    const a = [...arr];
    const n = a.length;
    const take = Math.min(k, n);
    for (let i = 0; i < take; i++) {
      const j = i + Math.floor(this.next() * (n - i));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a.slice(0, take);
  }
}

// ─── 提取边缘格 ───────────────────────────────────────────────────────────────

/**
 * 找出 grid 中所有"边缘格"：本格非零，且至少有一个4邻格为0或越界。
 */
function extractEdgeCells(grid: Grid, rows: number, cols: number): [number, number][] {
  const edges: [number, number][] = [];
  const DR = [-1, 1, 0, 0];
  const DC = [0, 0, -1, 1];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] === 0) continue;
      let isEdge = false;
      for (let d = 0; d < 4; d++) {
        const nr = r + DR[d];
        const nc = c + DC[d];
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || grid[nr][nc] === 0) {
          isEdge = true;
          break;
        }
      }
      if (isEdge) edges.push([r, c]);
    }
  }
  return edges;
}

// ─── 主导出函数 ────────────────────────────────────────────────────────────────

export function rectPoiPlace(input: Record<string, unknown>): Record<string, unknown> {
  const inputGrids = input.inputGrids as Grid[] | undefined;
  if (!Array.isArray(inputGrids) || inputGrids.length === 0) {
    return { error: "inputGrids is required and must be a non-empty array" };
  }

  const count = typeof input.count === "number" ? Math.max(1, Math.round(input.count)) : 3;
  const seed  = typeof input.seed  === "number" ? input.seed : 0;

  const rows = inputGrids[0].length;
  const cols = inputGrids[0][0]?.length ?? 0;
  if (rows === 0 || cols === 0) return { error: "inputGrids contains empty grid" };

  // 找所有输入网格中的全局最大非零值，作为点位写入值
  let poiValue = 0;
  for (const g of inputGrids) {
    for (const row of g) {
      for (const v of row) {
        if (v > poiValue) poiValue = v;
      }
    }
  }
  if (poiValue === 0) return { error: "no non-zero values found in inputGrids" };

  const rng = new SeededRandom(seed);

  // 输出网格
  const outputGrid: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));

  for (const g of inputGrids) {
    const edges = extractEdgeCells(g, rows, cols);
    if (edges.length === 0) continue;

    const sampled = rng.sample(edges, count);
    for (const [r, c] of sampled) {
      outputGrid[r][c] = poiValue;
    }
  }

  return { outputGrid };
}
