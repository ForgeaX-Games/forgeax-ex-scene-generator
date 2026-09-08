/**
 * gridMaskAb: 用网格 B 遮罩网格 A
 * 输入：gridA (grid/array) — 数据网格；gridB (grid/array) — 蒙版网格
 * 输出：maskedGrid (grid) — gridB 为 0 的位置输出 0，其余位置保留 gridA 原值
 *
 * 兼容：若传入网格列表（number[][][]），自动取第一张网格处理。
 */

/** 从任意输入中提取单张 number[][] */
function extractGrid(v: unknown): number[][] | null {
  if (!Array.isArray(v) || v.length === 0) return null;

  const first = (v as unknown[])[0];

  // 单张网格：v[0] 是数组，v[0][0] 是数字
  if (Array.isArray(first) && first.length > 0) {
    if (typeof (first as unknown[])[0] === "number") {
      return v as number[][];
    }
    // 网格列表：v[0][0] 是数组 → 取第一张
    if (Array.isArray((first as unknown[])[0])) {
      const innerRow = ((v as unknown[][][])[0] as unknown[][])[0];
      if (Array.isArray(innerRow) && typeof (innerRow as unknown[])[0] === "number") {
        return (v as unknown[][][])[0] as number[][];
      }
    }
  }

  return null;
}

export function gridMaskAb(
  input: Record<string, unknown>
): Record<string, unknown> {
  const gridA = extractGrid(input.gridA);
  const gridB = extractGrid(input.gridB);

  if (!gridA || !gridB) {
    return { maskedGrid: [] as number[][] };
  }

  const rows = gridA.length;
  const cols = gridA[0]?.length ?? 0;

  const maskedGrid: number[][] = Array.from({ length: rows }, (_, y) =>
    Array.from({ length: cols }, (__, x) => {
      const bVal = gridB[y]?.[x];
      return bVal === 0 || bVal === undefined ? 0 : (gridA[y][x] ?? 0);
    })
  );

  return { maskedGrid };
}
