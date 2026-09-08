/**
 * topologyPickDoors: 在输入拓扑（墙状 0/1 grid）上挑 count 个宽度为 width 的门洞段。
 *
 * 输入：topology (grid)，count (number, default 1)，width (number, default 2)，seed (number, default 0)，
 *       bottomDoor (boolean, default false)，region (grid, 可选)
 * 输出：topology (grid) — 挑中的门洞 0/1，placed (number)
 *
 * 算法本体（doorCandCells / collectDoorPriority / collectDoorFallback / placeDoors / doorOne）
 * 完整照搬自 components/interests/building_generator 的外门步骤。
 *
 * bottomDoor 开关（默认关）：开启后只在"朝下且朝向建筑外部"的水平墙段开门，并优先取最靠下的墙；
 * 这样 2D 俯视角游戏的外门一定开在下方。关闭时维持原行为（上下左右皆可）。
 *
 * 关键：朝下开口 ≠ 正下方为空。建筑的顶墙 / 内墙正下方也是空（那是室内），单看 topology 无法
 * 可靠区分室内/室外——尤其当墙环有缺口（已开门窗）时，从边界泛洪会漏进室内，把室内误判成室外。
 * 因此优先用 region 输入判内外：
 *   - region（建筑整体区域，含墙：1=属于这栋楼，0=楼外）给定时，水平墙"朝下朝外" ⟺ 正下方
 *     region[r+1]===0（楼外）或越出网格底边——对墙缺口完全鲁棒。
 *   - region 未给时退回从边界泛洪求 exterior 的旧启发式（只有墙环闭合且外侧连到网格边界时才准）。
 */

type Grid = number[][];
interface DoorCand { r: number; c: number; dir: "H" | "V"; width: number }
// 返回 (r,c) 处水平墙的"正下方是否朝向建筑外部"。
type BelowIsExterior = (r: number, c: number) => boolean;

function makeLCG(seed: number): () => number {
  let s = (seed === 0 ? Date.now() : seed) >>> 0;
  return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 0x100000000; };
}

// 从网格四边的空格泛洪，标记所有连通到外部的空格。室内被墙围住的空格不会被标记。
function computeExterior(grid: Grid, rows: number, cols: number): boolean[][] {
  const ext: boolean[][] = Array.from({ length: rows }, () => new Array(cols).fill(false));
  const stack: Array<[number, number]> = [];
  const seed = (r: number, c: number): void => {
    if (grid[r][c] === 0 && !ext[r][c]) { ext[r][c] = true; stack.push([r, c]); }
  };
  for (let c = 0; c < cols; c++) { seed(0, c); seed(rows - 1, c); }
  for (let r = 0; r < rows; r++) { seed(r, 0); seed(r, cols - 1); }
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (stack.length) {
    const [r, c] = stack.pop()!;
    for (const [dr, dc] of dirs) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && grid[nr][nc] === 0 && !ext[nr][nc]) {
        ext[nr][nc] = true; stack.push([nr, nc]);
      }
    }
  }
  return ext;
}

// 构造"正下方朝外"判据。优先用 region（含墙的建筑整体区域）：正下方 region===0 即楼外，
// 对墙缺口鲁棒；region 缺失或尺寸不匹配时退回边界泛洪（仅闭合墙环可靠）。底边（r===rows-1）
// 的正下方越出网格，恒为外部。
function makeBelowIsExterior(grid: Grid, region: Grid | null, rows: number, cols: number): BelowIsExterior {
  if (region) {
    return (r, c) => (r === rows - 1 ? true : !region[r + 1][c]);
  }
  const ext = computeExterior(grid, rows, cols);
  return (r, c) => (r === rows - 1 ? true : grid[r + 1][c] === 0 && ext[r + 1][c]);
}

function shuffle<T>(arr: T[], rand: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function doorCandCells(d: DoorCand, cols: number): number[] {
  if (d.dir === "H") return Array.from({ length: d.width }, (_, i) => d.r * cols + d.c + i);
  return Array.from({ length: d.width }, (_, i) => (d.r + i) * cols + d.c);
}

function collectDoorPriority(grid: Grid, belowExt: BelowIsExterior, rows: number, cols: number, dw: number, bottomOnly: boolean): DoorCand[] {
  const SEG = 6, cands: DoorCand[] = [];
  for (let r = 0; r < rows; r++) {
    let s = -1;
    for (let c = 0; c <= cols; c++) {
      const isW = c < cols && grid[r][c] !== 0;
      if (isW && s === -1) s = c;
      else if (!isW && s !== -1) {
        const e = c - 1, len = e - s + 1;
        if (len >= SEG) {
          const ds = Math.floor((s + e - dw + 1) / 2), de = ds + dw - 1;
          // bottomOnly：整段门洞都必须朝下且朝向外部（排除朝向室内的顶墙 / 内墙）。
          const open = bottomOnly
            ? Array.from({ length: dw }, (_, i) => belowExt(r, ds + i)).every(Boolean)
            : (r > 0 && grid[r - 1][ds] === 0 || r < rows - 1 && grid[r + 1][ds] === 0);
          if (ds >= s && de <= e && open)
            cands.push({ r, c: ds, dir: "H", width: dw });
        }
        s = -1;
      }
    }
  }
  // 竖直墙段（朝左右开口）属于侧门，bottomOnly 时全部跳过。
  if (!bottomOnly) {
    for (let c = 0; c < cols; c++) {
      let s = -1;
      for (let r = 0; r <= rows; r++) {
        const isW = r < rows && grid[r][c] !== 0;
        if (isW && s === -1) s = r;
        else if (!isW && s !== -1) {
          const e = r - 1, len = e - s + 1;
          if (len >= SEG) {
            const ds = Math.floor((s + e - dw + 1) / 2), de = ds + dw - 1;
            if (ds >= s && de <= e && (c > 0 && grid[ds][c - 1] === 0 || c < cols - 1 && grid[ds][c + 1] === 0))
              cands.push({ r: ds, c, dir: "V", width: dw });
          }
          s = -1;
        }
      }
    }
  }
  return cands;
}

function collectDoorFallback(grid: Grid, belowExt: BelowIsExterior, rows: number, cols: number, dw: number, bottomOnly: boolean): DoorCand[] {
  const cands: DoorCand[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c <= cols - dw; c++) {
      const open = bottomOnly
        ? Array.from({ length: dw }, (_, i) => belowExt(r, c + i)).every(Boolean)
        : (r > 0 && grid[r - 1][c] === 0 || r < rows - 1 && grid[r + 1][c] === 0);
      if (Array.from({ length: dw }, (_, i) => grid[r][c + i]).every(v => v !== 0) && open)
        cands.push({ r, c, dir: "H", width: dw });
    }
  if (!bottomOnly) {
    for (let c = 0; c < cols; c++)
      for (let r = 0; r <= rows - dw; r++)
        if (Array.from({ length: dw }, (_, i) => grid[r + i][c]).every(v => v !== 0) &&
            (c > 0 && grid[r][c - 1] === 0 || c < cols - 1 && grid[r][c + 1] === 0))
          cands.push({ r, c, dir: "V", width: dw });
  }
  return cands;
}

function placeDoors(cands: DoorCand[], need: number, opened: Set<number>, doorG: Grid, cols: number): number {
  let placed = 0;
  for (const cand of cands) {
    if (placed >= need) break;
    const keys = doorCandCells(cand, cols);
    if (keys.some(k => opened.has(k))) continue;
    for (const k of keys) { opened.add(k); doorG[Math.floor(k / cols)][k % cols] = 1; }
    placed++;
  }
  return placed;
}

// 候选排序：先按 seed 打散（保证可复现的随机性），bottomOnly 时再按行号降序稳定排序，
// 使最靠下的墙段优先被选中（Node>=11 的 Array.sort 稳定，同行内仍保留打散后的顺序）。
function orderCands(cands: DoorCand[], rand: () => number, bottomOnly: boolean): void {
  shuffle(cands, rand);
  if (bottomOnly) cands.sort((a, b) => b.r - a.r);
}

function doorOne(wallGrid: Grid, doorCount: number, doorWidth: number, seedRaw: number, bottomOnly: boolean, region: Grid | null): { doorGrid: Grid; placed: number } {
  const rows = wallGrid.length, cols = wallGrid[0].length;
  const rand = makeLCG(seedRaw);
  const doorGrid: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  if (doorCount === 0) return { doorGrid, placed: 0 };
  // 朝下朝外判据只在 bottomOnly 时需要：有 region 用 region 判内外（对墙缺口鲁棒），否则退回泛洪。
  const belowExt: BelowIsExterior = bottomOnly
    ? makeBelowIsExterior(wallGrid, region, rows, cols)
    : () => false;
  const priority = collectDoorPriority(wallGrid, belowExt, rows, cols, doorWidth, bottomOnly);
  orderCands(priority, rand, bottomOnly);
  const opened = new Set<number>();
  let placed = placeDoors(priority, doorCount, opened, doorGrid, cols);
  if (placed < doorCount) {
    const fb = collectDoorFallback(wallGrid, belowExt, rows, cols, doorWidth, bottomOnly)
      .filter(c => !doorCandCells(c, cols).some(k => opened.has(k)));
    orderCands(fb, rand, bottomOnly);
    placed += placeDoors(fb, doorCount - placed, opened, doorGrid, cols);
  }
  return { doorGrid, placed };
}

// region 只有与 topology 同形（同行列数）时才采用，否则忽略以退回泛洪，避免越界索引。
function normalizeRegion(region: unknown, rows: number, cols: number): Grid | null {
  if (!Array.isArray(region) || region.length !== rows) return null;
  for (const row of region) {
    if (!Array.isArray(row) || row.length !== cols) return null;
  }
  return region as Grid;
}

export function topologyPickDoors(input: Record<string, unknown>): Record<string, unknown> {
  const topology = input.topology as Grid | undefined;
  if (!topology || topology.length === 0 || (topology[0]?.length ?? 0) === 0) {
    return { error: "topology is required" };
  }
  const count = typeof input.count === "number" ? Math.max(0, Math.round(input.count)) : 1;
  const width = typeof input.width === "number" ? Math.max(1, Math.round(input.width)) : 2;
  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  const seed = seedRaw === 0 ? Date.now() : seedRaw;
  const bottomDoor = input.bottomDoor === true;
  const region = normalizeRegion(input.region, topology.length, topology[0].length);
  const { doorGrid, placed } = doorOne(topology, count, width, seed, bottomDoor, region);
  return { topology: doorGrid, placed };
}
