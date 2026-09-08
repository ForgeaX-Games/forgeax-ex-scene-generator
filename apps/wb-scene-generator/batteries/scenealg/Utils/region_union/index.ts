/**
 * regionUnion: 对两张 0/1 网格做并集。
 *
 * 输入：a (grid) — 主区域，非零优先；b (grid) — 次区域，仅在 a 为零时填入
 * 输出：region (grid) — 尺寸为两输入逐维最大值的并集
 *
 * autoIterate=true：两输入端口 rank=0；并行的两条 rank=1 grid 列表会被 dispatcher
 * 按 lacing 配对调用，输出对应一条 rank=1 grid 列表。
 */

type Grid = number[][];

function gridDims(g: Grid | undefined): [number, number] {
  if (!g || g.length === 0 || !g[0] || g[0].length === 0) return [0, 0];
  return [g.length, g[0].length];
}

export function regionUnion(input: Record<string, unknown>): Record<string, unknown> {
  const a = input.a as Grid | undefined;
  const b = input.b as Grid | undefined;
  const [aRows, aCols] = gridDims(a);
  const [bRows, bCols] = gridDims(b);
  const rows = Math.max(aRows, bRows);
  const cols = Math.max(aCols, bCols);
  if (rows === 0 || cols === 0) return { region: [] };

  const region: Grid = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (__, c) => {
      const av = r < aRows && c < aCols ? a![r][c] : 0;
      if (av !== 0) return av;
      return r < bRows && c < bCols ? b![r][c] : 0;
    })
  );
  return { region };
}
