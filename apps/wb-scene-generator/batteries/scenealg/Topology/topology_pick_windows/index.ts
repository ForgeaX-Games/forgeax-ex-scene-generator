/**
 * topologyPickWindows: 在输入拓扑上挑 count 个宽度为 width 的「对外」窗段。
 *
 * 输入：topology (grid)，count (number)，width (number)，random (boolean)，seed (number)
 * 输出：topology (grid) — 窗位置 0/1
 *
 * 算法本体（isValidHWindow / isValidVWindow / collectWinCands /
 * winCells / winExclusion / pickWindows / uniformPick / windowOne）
 * 完整照搬自 components/interests/building_generator 的开窗步骤。
 */

type Grid = number[][];
interface WinCand { r: number; c: number; dir: "H" | "V"; width: number }

function makeLCG(seed: number): () => number {
  let s = (seed === 0 ? Date.now() : seed) >>> 0;
  return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 0x100000000; };
}

function shuffle<T>(arr: T[], rand: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function isValidHWindow(grid: Grid, rows: number, cols: number, r: number, c: number, w: number): boolean {
  const lo = c - 1, hi = c + w;
  if (lo >= 0 && grid[r][lo] === 0) return false;
  if (hi < cols && grid[r][hi] === 0) return false;
  for (let i = 0; i < w; i++) {
    if (r <= 0 || grid[r - 1][c + i] !== 0) return false;
    if (r >= rows - 1 || grid[r + 1][c + i] !== 0) return false;
  }
  return true;
}

function isValidVWindow(grid: Grid, rows: number, cols: number, r: number, c: number, w: number): boolean {
  const lo = r - 1, hi = r + w;
  if (lo >= 0 && grid[lo][c] === 0) return false;
  if (hi < rows && grid[hi][c] === 0) return false;
  for (let i = 0; i < w; i++) {
    if (c <= 0 || grid[r + i][c - 1] !== 0) return false;
    if (c >= cols - 1 || grid[r + i][c + 1] !== 0) return false;
  }
  return true;
}

function collectWinCands(grid: Grid, rows: number, cols: number, w: number): WinCand[] {
  const cands: WinCand[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c <= cols - w; c++)
      if (Array.from({ length: w }, (_, i) => grid[r][c + i]).every(v => v !== 0) &&
          isValidHWindow(grid, rows, cols, r, c, w))
        cands.push({ r, c, dir: "H", width: w });
  for (let c = 0; c < cols; c++)
    for (let r = 0; r <= rows - w; r++)
      if (Array.from({ length: w }, (_, i) => grid[r + i][c]).every(v => v !== 0) &&
          isValidVWindow(grid, rows, cols, r, c, w))
        cands.push({ r, c, dir: "V", width: w });
  return cands;
}

function winCells(cand: WinCand, cols: number): number[] {
  if (cand.dir === "H") return Array.from({ length: cand.width }, (_, i) => cand.r * cols + cand.c + i);
  return Array.from({ length: cand.width }, (_, i) => (cand.r + i) * cols + cand.c);
}

function winExclusion(cand: WinCand, cols: number): number[] {
  const cs = winCells(cand, cols);
  if (cand.dir === "H") {
    if (cand.c - 1 >= 0) cs.push(cand.r * cols + (cand.c - 1));
    cs.push(cand.r * cols + (cand.c + cand.width));
  } else {
    if (cand.r - 1 >= 0) cs.push((cand.r - 1) * cols + cand.c);
    cs.push((cand.r + cand.width) * cols + cand.c);
  }
  return cs;
}

function pickWindows(cands: WinCand[], count: number, cols: number): WinCand[] {
  const occ = new Set<number>(), result: WinCand[] = [];
  for (const c of cands) {
    if (result.length >= count) break;
    const cs = winCells(c, cols); if (cs.some(k => occ.has(k))) continue;
    winExclusion(c, cols).forEach(k => occ.add(k)); result.push(c);
  }
  return result;
}

function uniformPick<T>(arr: T[], count: number): T[] {
  if (count <= 0 || arr.length === 0) return [];
  if (count >= arr.length) return [...arr];
  const step = arr.length / count;
  return Array.from({ length: count }, (_, i) => arr[Math.floor(i * step + step / 2)]);
}

function windowOne(wallGrid: Grid, windowCount: number, windowWidth: number, randomEnable: boolean, seedRaw: number): Grid {
  const rows = wallGrid.length, cols = wallGrid[0].length;
  const windowGrid: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  if (windowCount === 0) return windowGrid;
  const cands = collectWinCands(wallGrid, rows, cols, windowWidth);
  if (cands.length === 0) return windowGrid;
  let ordered: WinCand[];
  if (randomEnable) {
    const rand = makeLCG(seedRaw);
    const sh = [...cands]; shuffle(sh, rand); ordered = sh;
  } else {
    ordered = uniformPick(
      [...cands].sort((a, b) => a.dir.localeCompare(b.dir) || a.r - b.r || a.c - b.c),
      windowCount,
    );
  }
  const chosen = pickWindows(ordered, windowCount, cols);
  for (const w of chosen)
    for (const k of winCells(w, cols)) {
      const r = Math.floor(k / cols), c = k % cols;
      windowGrid[r][c] = 1;
    }
  return windowGrid;
}

export function topologyPickWindows(input: Record<string, unknown>): Record<string, unknown> {
  const topology = input.topology as Grid | undefined;
  if (!topology || topology.length === 0 || (topology[0]?.length ?? 0) === 0) {
    return { error: "topology is required" };
  }
  const count = typeof input.count === "number" ? Math.max(0, Math.round(input.count)) : 2;
  const width = typeof input.width === "number" ? Math.max(1, Math.round(input.width)) : 2;
  const randomEnable = input.random !== false && input.random !== "false";
  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  const seed = seedRaw === 0 ? Date.now() : seedRaw;
  return { topology: windowOne(topology, count, width, randomEnable, seed) };
}
