/**
 * heightAdjuster: 在高度图上自动生成穹顶中心点并叠加径向增益
 * 将穹顶点采样与径向高度增益合并为一步操作
 * 输入：heightGrid (grid) — 原始高度场；count (number) — 穹顶数量
 * 输出：heightGrid (grid) — 叠加所有穹顶后的高度场
 *
 * 固定内部参数：seed=0（时间随机）、margin=0.1、minSpacing=0.3、intensity=45、radius=0.3
 */

// ── 固定内部参数 ─────────────────────────────────────────────────────────────
const FIXED_MARGIN      = 0.1;   // 边距（归一化）
const FIXED_MIN_SPACING = 0.3;   // 点间最小间距（归一化）
const FIXED_RADIUS      = 0.3;   // 穹顶影响半径（归一化，相对最短边）
const FIXED_INTENSITY   = 45;    // 穹顶中心最大增益量（0–100 scale）

// ── 工具类型 ─────────────────────────────────────────────────────────────────
interface Point { x: number; y: number; }

// ── 伪随机数生成器（LCG，可复现） ────────────────────────────────────────────
class SeededRandom {
  private s: number;
  constructor(seed: number) {
    this.s = seed === 0 ? Date.now() : Math.abs(Math.round(seed));
    for (let i = 0; i < 8; i++) this.next();
  }
  next(): number {
    this.s = (this.s * 1664525 + 1013904223) & 0xffffffff;
    return (this.s >>> 0) / 0xffffffff;
  }
}

// ── 穹顶中心点生成（拒绝采样，保证最小间距） ─────────────────────────────────
function generateDomePoints(count: number, rng: SeededRandom): Point[] {
  const lo = FIXED_MARGIN;
  const hi = 1 - FIXED_MARGIN;
  const range = hi - lo;
  const placed: Point[] = [];
  const MAX_TRIES = 200;

  for (let i = 0; i < count; i++) {
    let placed_this = false;
    for (let t = 0; t < MAX_TRIES; t++) {
      const c: Point = { x: lo + rng.next() * range, y: lo + rng.next() * range };
      if (isFarEnough(c, placed, FIXED_MIN_SPACING)) {
        placed.push(c);
        placed_this = true;
        break;
      }
    }
    // 空间已满时取最远可用位置
    if (!placed_this) {
      let best: Point | null = null;
      let bestDist = -1;
      for (let t = 0; t < MAX_TRIES; t++) {
        const c: Point = { x: lo + rng.next() * range, y: lo + rng.next() * range };
        let minD = Infinity;
        for (const p of placed) {
          const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
          if (d < minD) minD = d;
        }
        if (minD > bestDist) { bestDist = minD; best = c; }
      }
      if (best) placed.push(best);
    }
  }
  return placed;
}

function isFarEnough(c: Point, placed: Point[], minDist: number): boolean {
  for (const p of placed) {
    if ((c.x - p.x) ** 2 + (c.y - p.y) ** 2 < minDist * minDist) return false;
  }
  return true;
}

// ── 穹顶增益（smoothstep 衰减，无边缘尖角） ───────────────────────────────────
function smoothstepFalloff(t: number): number {
  const v = 1 - t;
  return v * v * (3 - 2 * v);
}

function applyOneDome(grid: number[][], cx: number, cy: number, rPixels: number): number[][] {
  return grid.map((row, y) =>
    row.map((h, x) => {
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (dist >= rPixels) return h;
      return Math.min(100, Math.round(h + FIXED_INTENSITY * smoothstepFalloff(dist / rPixels)));
    })
  );
}

// ── 主导出函数 ────────────────────────────────────────────────────────────────
export function heightAdjuster(input: Record<string, unknown>): Record<string, unknown> {
  const rawGrid = input.heightGrid as number[][] | undefined;
  if (!rawGrid || !Array.isArray(rawGrid) || rawGrid.length === 0) {
    return { error: "heightGrid is required and must be a non-empty 2D array" };
  }

  const count = Math.max(1, Math.round(typeof input.count === "number" ? input.count : 1));

  // 归一化：噪声节点输出 0–1，转为 0–100
  let maxVal = 0;
  for (const row of rawGrid) for (const v of row) if (v > maxVal) maxVal = v;
  let grid: number[][] = maxVal <= 1.01
    ? rawGrid.map(row => row.map(v => Math.round(v * 100)))
    : rawGrid.map(row => [...row]);

  const rows = grid.length;
  const cols = grid[0].length;
  const rPixels = FIXED_RADIUS * Math.min(rows, cols);

  // 生成穹顶中心点（seed=0 使用当前时间，保证每次随机分布）
  const rng = new SeededRandom(0);
  const points = generateDomePoints(count, rng);

  // 逐点叠加穹顶增益
  for (const pt of points) {
    const cx = Math.max(0, Math.min(1, pt.x)) * (cols - 1);
    const cy = Math.max(0, Math.min(1, pt.y)) * (rows - 1);
    grid = applyOneDome(grid, cx, cy, rPixels);
  }

  return { heightGrid: grid };
}
