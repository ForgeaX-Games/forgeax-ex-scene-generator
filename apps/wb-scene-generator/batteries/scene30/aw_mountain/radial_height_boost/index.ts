/**
 * radialHeightBoost: 在高度图多个位置叠加径向穹顶增益，制造台地/山体的同心圆层叠效果
 * 输入：heightGrid (grid) — 原始高度场；points (array) — {x,y} 归一化中心点列表；
 *       radius (number) — 影响半径（归一化）
 * 输出：heightGrid (grid) — 叠加所有穹顶后的高度场
 *
 * intensity 和 falloff 为固定参数：intensity=45（smoothstep衰减）
 */

// 固定内部参数，不作为输入端口暴露
const FIXED_INTENSITY = 45;

interface Point { x: number; y: number; }

function smoothstepFalloff(normalizedDist: number): number {
  const t = 1 - normalizedDist;
  return t * t * (3 - 2 * t); // smoothstep，边缘平滑无尖角
}

function applyOneDome(
  grid: number[][],
  cx: number,
  cy: number,
  rPixels: number
): number[][] {
  const rows = grid.length;
  const cols = grid[0].length;
  return grid.map((row, y) =>
    row.map((h, x) => {
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (dist >= rPixels) return h;
      const boost = FIXED_INTENSITY * smoothstepFalloff(dist / rPixels);
      return Math.min(100, Math.round(h + boost));
    })
  );
}

export function radialHeightBoost(input: Record<string, unknown>): Record<string, unknown> {
  const rawGrid = input.heightGrid as number[][] | undefined;
  if (!rawGrid || !Array.isArray(rawGrid) || rawGrid.length === 0) {
    return { error: "heightGrid is required and must be a non-empty 2D array" };
  }

  // Auto-detect 0–1 scale (from noise generators) and normalize to 0–100
  let maxVal = 0;
  for (const row of rawGrid) for (const v of row) if (v > maxVal) maxVal = v;
  let grid = maxVal <= 1.01
    ? rawGrid.map(row => row.map(v => Math.round(v * 100)))
    : rawGrid;

  const radius = typeof input.radius === "number" ? input.radius : 0.3;
  if (radius <= 0) return { error: "radius must be greater than 0" };

  const rows = grid.length;
  const cols = grid[0].length;
  const rPixels = radius * Math.min(rows, cols);

  // 解析点列表：支持 {x,y} 对象格式
  const rawPoints = input.points;
  const points: Point[] = [];
  if (Array.isArray(rawPoints)) {
    for (const p of rawPoints) {
      if (p && typeof p === "object" && typeof p.x === "number" && typeof p.y === "number") {
        points.push({ x: p.x, y: p.y });
      }
    }
  }

  // 无有效点时，回退为地图中心单个穹顶
  if (points.length === 0) {
    points.push({ x: 0.5, y: 0.5 });
  }

  // 依次对每个点叠加穹顶增益
  for (const pt of points) {
    const cx = Math.max(0, Math.min(1, pt.x)) * (cols - 1);
    const cy = Math.max(0, Math.min(1, pt.y)) * (rows - 1);
    grid = applyOneDome(grid, cx, cy, rPixels);
  }

  return { heightGrid: grid };
}
