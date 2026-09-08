/**
 * fieldThreshold: 按阈值把标量场切成「近/远」两个 0/1 子区域掩码。
 *
 * 给定一个标量场 field（如距离场）和限定有效范围的 region 掩码，以 threshold 为界，
 * 把 region 内的有效格分成两份：
 *   · near = 有效格且 0 <= field <= threshold（靠近源，距离小）
 *   · far  = 有效格且非 near（field > threshold，或 BFS 不可达的 -1）
 * 两份并起来恰好等于 region 的有效格，互不重叠，便于「内/外」「浅/深」「海岸/内陆」之类的二分。
 *
 * 约定（与 alg_field_distance / alg_field_inner_distance 对齐）：
 *   field 中 region 外的无效格 = 0、源格 = 0、不可达有效格 = -1。仅凭 field 无法区分
 *   「无效格 0」和「源格 0」，因此必须用 region 限定有效范围。
 *
 * 输入：field (grid, 必填) — 标量场 number[][]
 *       region (grid, 必填) — 限定有效范围的掩码，非零格为有效格
 *       threshold (number, default 1) — 近/远分界值（含界归入 near）
 * 输出：near (grid) — 0/1 掩码，靠近源的子区域
 *       far  (grid) — 0/1 掩码，远离源的子区域
 */

type Grid = number[][];

export function fieldThreshold(input: Record<string, unknown>): Record<string, unknown> {
  const field = input.field as Grid | undefined;
  const region = input.region as Grid | undefined;
  if (!field || field.length === 0 || (field[0]?.length ?? 0) === 0) {
    return { error: 'field is required' };
  }
  if (!region || region.length === 0 || (region[0]?.length ?? 0) === 0) {
    return { error: 'region is required (to bound valid cells)' };
  }

  const rows = field.length;
  const cols = field[0].length;
  const threshold = typeof input.threshold === 'number' ? input.threshold : 1;

  const near: Grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  const far: Grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const valid = (region[r]?.[c] ?? 0) !== 0;
      if (!valid) continue;
      const v = field[r]?.[c] ?? -1;
      if (v >= 0 && v <= threshold) {
        near[r][c] = 1;
      } else {
        // v > threshold，或 v < 0（BFS 不可达，视作最远）
        far[r][c] = 1;
      }
    }
  }

  return { near, far };
}
