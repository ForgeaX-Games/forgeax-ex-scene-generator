/**
 * bridgeEntryTag（桥梁端头标记）
 *
 * 给一张桥掩码网格逐格打「端头 / 普通」标签，端头再分横向长条 / 竖向长条。
 *
 * 为什么需要它：桥梁 autotile 的端头收口块与桥身扶手块**八邻域完全同形**——
 * 竖向桥上端头中格与横向桥顶部扶手中格的 (u,d,l,r,ul,ur,dl,dr) 都是
 * `0,1,1,1,0,0,1,1`，竖向桥上端头左角与横向桥左端头上格都是 `0,1,0,1,0,0,0,1`。
 * 纯邻域查表不可分，只能由上游按格派发标签，rule 侧用
 * `face.variants[].when.stateEquals` 分派到不同的 map。
 *
 * 判定（端头一定是「厚度 ≤ thickness 的终止长条」）：
 *   对每格算所在行的连续长度 rx 与所在列的连续长度 ry，
 *   * rx ≤ thickness 且 rx < ry 且整条行段上方（或下方）全空 → 横向端头长条 → 1
 *   * ry ≤ thickness 且 ry < rx 且整条列段左侧（或右侧）全空 → 竖向端头长条 → 2
 *   * 其余（桥身、扶手、L 拐角）→ 0
 *   两侧同时成立（如 3×3 孤立块）时不打标，交给 rule 的默认 map。
 *   `rx ≤ thickness` 这一条是 L 拐角的关键防线：拐角处外侧那一列虽然「整列左侧全空」，
 *   但它的长度是桥臂长度而非桥宽，会被 thickness 挡掉。
 *
 * 输出的 tagGrid 直接接 grid2node 的 stateGrid，stateValues 接 grid2node 的
 * 同名口，即可让体素带上 `state.bridgeTag = "entry_h" | "entry_v"`。
 *
 * DataTree：输入输出均为 grid/access:item，网格列表由引擎逐张 fanout。
 */

type Grid = number[][];

const TAG_NONE = 0;
const TAG_ENTRY_H = 1;
const TAG_ENTRY_V = 2;

/** stateValues 表：下标即 tagGrid 的数值，0 位占位（0 表示不打标）。 */
const STATE_VALUES = ['', 'entry_h', 'entry_v'];

function parseGrid(raw: unknown): Grid | null {
  if (!raw || !Array.isArray(raw) || raw.length === 0) return null;
  if (!Array.isArray(raw[0])) return null;
  return raw as Grid;
}

interface Span { lo: number; hi: number }

/** 行 y 上过 x 的极大连续非零区间（闭区间）。 */
function rowSpan(mask: boolean[][], x: number, y: number, W: number): Span {
  let lo = x;
  while (lo - 1 >= 0 && mask[y][lo - 1]) lo--;
  let hi = x;
  while (hi + 1 < W && mask[y][hi + 1]) hi++;
  return { lo, hi };
}

/** 列 x 上过 y 的极大连续非零区间（闭区间）。 */
function colSpan(mask: boolean[][], x: number, y: number, H: number): Span {
  let lo = y;
  while (lo - 1 >= 0 && mask[lo - 1][x]) lo--;
  let hi = y;
  while (hi + 1 < H && mask[hi + 1][x]) hi++;
  return { lo, hi };
}

function at(mask: boolean[][], x: number, y: number, W: number, H: number): boolean {
  return x >= 0 && x < W && y >= 0 && y < H && mask[y][x];
}

/** 行段 [lo..hi] @ y 在 dy 方向上是否整条为空（即该行段是那一侧的终止边）。 */
function rowSideEmpty(mask: boolean[][], s: Span, y: number, dy: number, W: number, H: number): boolean {
  for (let x = s.lo; x <= s.hi; x++) if (at(mask, x, y + dy, W, H)) return false;
  return true;
}

function colSideEmpty(mask: boolean[][], s: Span, x: number, dx: number, W: number, H: number): boolean {
  for (let y = s.lo; y <= s.hi; y++) if (at(mask, x + dx, y, W, H)) return false;
  return true;
}

export function bridgeEntryTag(input: Record<string, unknown>): Record<string, unknown> {
  const grid = parseGrid(input.inputGrid);
  if (!grid) return { error: 'inputGrid is required' };

  const H = grid.length;
  const W = Array.isArray(grid[0]) ? grid[0].length : 0;
  if (W === 0) return { error: 'inputGrid is empty' };

  const thicknessRaw = typeof input.thickness === 'number' ? input.thickness : Number(input.thickness);
  const thickness = Number.isFinite(thicknessRaw) ? Math.max(1, Math.trunc(thicknessRaw)) : 3;

  const mask: boolean[][] = [];
  for (let y = 0; y < H; y++) {
    const row = Array.isArray(grid[y]) ? grid[y] : [];
    const out: boolean[] = new Array(W).fill(false);
    for (let x = 0; x < W; x++) out[x] = Number(row[x]) !== 0;
    mask.push(out);
  }

  const tagGrid: Grid = Array.from({ length: H }, () => new Array<number>(W).fill(TAG_NONE));
  let entryCount = 0;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!mask[y][x]) continue;
      const rs = rowSpan(mask, x, y, W);
      const cs = colSpan(mask, x, y, H);
      const rx = rs.hi - rs.lo + 1;
      const ry = cs.hi - cs.lo + 1;

      const horizCap =
        rx <= thickness && rx < ry &&
        (rowSideEmpty(mask, rs, y, -1, W, H) || rowSideEmpty(mask, rs, y, 1, W, H));
      const vertCap =
        ry <= thickness && ry < rx &&
        (colSideEmpty(mask, cs, x, -1, W, H) || colSideEmpty(mask, cs, x, 1, W, H));

      if (horizCap && !vertCap) { tagGrid[y][x] = TAG_ENTRY_H; entryCount++; }
      else if (vertCap && !horizCap) { tagGrid[y][x] = TAG_ENTRY_V; entryCount++; }
    }
  }

  return { tagGrid, stateValues: STATE_VALUES, entryCount };
}
