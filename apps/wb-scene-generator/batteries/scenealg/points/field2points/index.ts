/**
 * field2points: 从标量场（field，每格一个数值）按阈值采样出采样点列表（grid[]，rank=1）。
 *
 * 遍历输入 field 的所有格（行优先：r 外层、c 内层），凡是「field[r][c] > threshold」（严格大于）
 * 的格，各自生成一张与输入同尺寸、仅该格=1 其余=0 的单点 0/1 网格，把它加入输出列表。所有单点网格
 * 按行优先顺序构成列表，由 autoIterate/access:list 机制摊成 DataTree 列表输出。
 *
 * 输入：field (grid) — 输入标量场/网格（number[][]），每格一个连续数值
 *       threshold (number, default 0) — 采样阈值，严格大于才被选中（== 不选）
 * 输出：points (grid[], access:list) — 每个超阈值格一张同尺寸单点 0/1 网格，行优先顺序；
 *                                       无超阈值时为空列表
 *       count (number) — 超阈值格数，即 points 列表长度
 *
 * field 是 scenealg 体系里区别于 region（0/1 掩码）的基本类型：grid 上每格一个标量数值；points 是
 * 离散采样点。本电池把连续场离散化成一组单点采样网格，输出范式与 region_grid_split 的 partition
 * (grid[] + access:list) 完全一致。
 */

type Grid = number[][];

export function field2points(input: Record<string, unknown>): Record<string, unknown> {
  const field = input.field as Grid | undefined;
  if (!field || field.length === 0 || (field[0]?.length ?? 0) === 0) {
    return { error: "field is required" };
  }

  const rows = field.length;
  const cols = field[0].length;
  const threshold = typeof input.threshold === "number" ? input.threshold : 0;

  const points: Grid[] = [];

  for (let r = 0; r < rows; r++) {
    const row = field[r];
    for (let c = 0; c < cols; c++) {
      if ((row[c] ?? 0) > threshold) {
        const g: Grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
        g[r][c] = 1;
        points.push(g);
      }
    }
  }

  return { points, count: points.length };
}
