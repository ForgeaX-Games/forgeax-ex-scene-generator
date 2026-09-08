/**
 * partitionFieldQuantize: 将 [0,1] 高度场按整数层数截断，输出互斥的高度层级 partition 列表。
 *
 * maxElevationLayers 语义：
 *   0 — 全部为平地（高度层 0），输出 1 张 partition
 *   N — 高度整数层 0..N（共 N+1 层），每层一张 0/1 掩码，互不重叠且覆盖全部有效格
 *
 * 输入：region (grid) — 限定有效范围
 *       field (grid) — [0,1] 高度标量场（通常来自 alg_field_mountain_contour）
 *       maxElevationLayers (number) — 最高抬升层数（整数，≥0）
 *       namePrefix (string, optional) — 默认分区名前缀，默认「等高线」
 * 输出：partition (grid list) — 每层高度一张 0/1 掩码，下标 = 高度层
 *       count (number) — partition 张数
 *       levelGrid (grid) — 多值网格，有效格值 = 高度层（0..maxElevationLayers）
 *       nameList (array) — { id, name } 名称清单，默认 namePrefix+层号（0 层为 namePrefix+0）
 */

type Grid = number[][];

type NameEntry = { id: number; name: string };

function quantizeLevel(fieldVal: number, maxLayers: number): number {
  if (maxLayers <= 0) return 0;
  const t = fieldVal <= 0 ? 0 : fieldVal >= 1 ? 1 : fieldVal;
  return Math.min(maxLayers, Math.round(t * maxLayers));
}

export function partitionFieldQuantize(input: Record<string, unknown>): Record<string, unknown> {
  const region = input.region as Grid | undefined;
  const field = input.field as Grid | undefined;
  if (!region || region.length === 0 || (region[0]?.length ?? 0) === 0) {
    return { error: "region is required" };
  }
  if (!field || field.length === 0 || (field[0]?.length ?? 0) === 0) {
    return { error: "field is required" };
  }

  const rows = region.length;
  const cols = region[0].length;
  const maxElevationLayers =
    typeof input.maxElevationLayers === "number"
      ? Math.max(0, Math.round(input.maxElevationLayers))
      : 0;
  const namePrefix =
    typeof input.namePrefix === "string" && input.namePrefix.length > 0
      ? input.namePrefix
      : "等高线";

  const levelCount = maxElevationLayers + 1;
  const partition: Grid[] = Array.from({ length: levelCount }, () =>
    Array.from({ length: rows }, () => new Array<number>(cols).fill(0))
  );
  const levelGrid: Grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const valid = (region[r]?.[c] ?? 0) !== 0;
      if (!valid) continue;
      const lv = quantizeLevel(field[r]?.[c] ?? 0, maxElevationLayers);
      partition[lv][r][c] = 1;
      levelGrid[r][c] = lv + 1;
    }
  }

  const nameList: NameEntry[] = [];
  for (let lv = 0; lv < levelCount; lv++) {
    nameList.push({ id: lv, name: `${namePrefix}${lv}` });
  }

  return {
    partition,
    count: levelCount,
    levelGrid,
    nameList,
  };
}
