/**
 * regionEdgeInnerSplit: 把一个区域按「边缘格 / 内部格」拆成两张 0/1 region。
 *
 * 输入：region (grid) — 0/1（或多值）区域，有效格 = 非零格
 *       connectivity (number, default 4) — 邻接度（4 = 上下左右，8 = 含对角）
 * 输出：edge (grid)  — 与输入同形状的 0/1 掩码，边缘有效格=1，其余=0
 *       inner (grid) — 与输入同形状的 0/1 掩码，内部有效格=1，其余=0
 *
 * 判定（复刻老 natural_decoration fillEdge 的边/内判定，默认 4-邻接、无概率无语义）：
 * 对每个有效格，遍历其 connectivity 个邻格；若存在「越界 或 邻格非有效」则判为 edge，
 * 否则判为 inner。edge 与 inner 互斥，二者并集 = region 全部有效格。
 *
 * 注意（去重提示）：本算子只产出 edge/inner 两张 region。下游两档概率
 * edgeProb=min(1, d*2)、innerProb=max(0, d*0.3) 由连接侧的 region_random_fill +
 * 数值 panel 承担，不在本电池内实现。
 *
 * 为何不能复用 region_outline：region_outline 是 8-邻接、语义为「向内取 thickness 层」，
 * 邻接度与厚度都不符合 fillEdge 的「单层 4-邻接边格」判定，故单独实现。
 */

type Grid = number[][];

const DIRS4: [number, number][] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

const DIRS8: [number, number][] = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1],
];

export function regionEdgeInnerSplit(input: Record<string, unknown>): Record<string, unknown> {
  const region = input.region as Grid | undefined;
  if (!region || region.length === 0 || (region[0]?.length ?? 0) === 0) {
    return { error: "region is required" };
  }

  const rows = region.length;
  const cols = region[0].length;

  const connRaw = typeof input.connectivity === "number" ? Math.round(input.connectivity) : 4;
  const dirs = connRaw === 8 ? DIRS8 : DIRS4;

  const isValid = (r: number, c: number): boolean =>
    r >= 0 && r < rows && c >= 0 && c < cols && (region[r]?.[c] ?? 0) !== 0;

  const edge: Grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  const inner: Grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  let edgeCount = 0;
  let innerCount = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if ((region[r][c] ?? 0) === 0) continue;
      let isEdge = false;
      for (const [dr, dc] of dirs) {
        // 边缘：相邻格越界或不在有效区域内
        if (!isValid(r + dr, c + dc)) {
          isEdge = true;
          break;
        }
      }
      if (isEdge) {
        edge[r][c] = 1;
        edgeCount++;
      } else {
        inner[r][c] = 1;
        innerCount++;
      }
    }
  }

  return { edge, inner, edgeCount, innerCount };
}
