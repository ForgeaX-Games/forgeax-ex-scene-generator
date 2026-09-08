/**
 * walkable_grid_builder: 可通行网格构建器
 *
 * 碰撞规则：
 *   地形层（terrainGrid，白名单）：
 *     2 (沙滩) → 可通行 (1)
 *     3 (草地) → 可通行 (1)
 *     其他（含水=1、未知值） → 阻挡 (0)
 *   装饰物层（decorationGrid，叠加覆盖）：
 *     1 (树木) → 阻挡 (0)
 *     2 (灌木) → 阻挡 (0)
 *     3 (岩石) → 阻挡 (0)
 *     4 (小花) → 保持可通行（不改变）
 *     0 (空)   → 不改变
 *
 * 输入：terrainGrid (grid) — 地形网格；decorationGrid (grid) — 装饰物网格
 * 输出：walkableGrid (grid) — 布尔型可通行网格（0=阻挡，1=可通行）
 */

type Grid = number[][];

/** 阻挡型装饰物编号集合（树=1，灌木=2，岩石=3） */
const BLOCKING_DECORATION_IDS = new Set([1, 2, 3]);

export function walkableGridBuilder(input: Record<string, unknown>): Record<string, unknown> {
  const terrainGrid = input.terrainGrid as Grid | undefined;
  const decorationGrid = input.decorationGrid as Grid | undefined;

  if (!terrainGrid || !Array.isArray(terrainGrid) || terrainGrid.length === 0) {
    return { error: "terrainGrid is required and must be a non-empty 2D array" };
  }

  const rows = terrainGrid.length;
  const cols = terrainGrid[0]?.length ?? 0;
  if (cols === 0) {
    return { error: "terrainGrid rows must not be empty" };
  }

  // 步骤 1：白名单判断地形，只有沙(2)或草(3)才可通行，其他（含水=1、未知值）一律阻挡
  const walkableGrid: Grid = terrainGrid.map(row =>
    row.map(cell => (cell === 2 || cell === 3 ? 1 : 0))
  );

  // 步骤 2：叠加装饰物层，树(1)/灌木(2)/岩石(3) 所在格改为不可通行；小花(4)/空(0) 不影响
  if (decorationGrid && Array.isArray(decorationGrid)) {
    for (let row = 0; row < rows; row++) {
      const decRow = decorationGrid[row];
      if (!decRow) continue;
      for (let col = 0; col < cols; col++) {
        if (BLOCKING_DECORATION_IDS.has(decRow[col])) {
          walkableGrid[row][col] = 0;
        }
      }
    }
  }

  return { walkableGrid };
}
