/**
 * trackMeshRasterize: 赛道栅格化
 * 将中心线点序列按指定轨道宽度沿法线偏移，
 * 将赛道区域填充到二维网格中，输出 outputGrid + outputNameList。
 *
 * 输入：centerline (array) — [{x,y}...] JSON 字符串;
 *       width (number) — 网格宽度; height (number) — 网格高度;
 *       trackWidth (number) — 赛道宽度（格子数）;
 *       trackId (number) — 赛道掩码值; bgId (number) — 背景掩码值
 * 输出：outputGrid (grid) — 二维网格; outputNameList (array) — 名称清单
 */

type Point = { x: number; y: number };

function parsePoints(raw: unknown): Point[] | null {
  if (typeof raw === "string") {
    try { return JSON.parse(raw) as Point[]; } catch { return null; }
  }
  if (Array.isArray(raw)) return raw as Point[];
  return null;
}

/** 初始化全背景的二维网格 */
function createGrid(width: number, height: number, bgId: number): number[][] {
  return Array.from({ length: height }, () => new Array(width).fill(bgId));
}

/** 在网格某格涂色（带边界检查） */
function setCell(grid: number[][], gx: number, gy: number, id: number): void {
  if (gy >= 0 && gy < grid.length && gx >= 0 && gx < grid[0].length) {
    grid[gy][gx] = id;
  }
}

/** 用圆形笔刷在指定位置涂色 */
function paintCircle(grid: number[][], cx: number, cy: number, r: number, id: number): void {
  const ri = Math.ceil(r);
  const r2 = r * r;
  const ix = Math.round(cx);
  const iy = Math.round(cy);
  for (let dy = -ri; dy <= ri; dy++) {
    for (let dx = -ri; dx <= ri; dx++) {
      if (dx * dx + dy * dy <= r2) {
        setCell(grid, ix + dx, iy + dy, id);
      }
    }
  }
}

/**
 * 在 (x0,y0)→(x1,y1) 之间用圆笔刷画填充线段
 * 对每个 Bresenham 步骤都画圆，保证无间隙
 */
function paintThickLine(
  grid: number[][],
  x0: number, y0: number,
  x1: number, y1: number,
  r: number, id: number
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.sqrt(dx * dx + dy * dy);
  // 沿线段均匀采样，步长为 1 格确保无间隙
  const steps = Math.max(1, Math.ceil(dist));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    paintCircle(grid, x0 + dx * t, y0 + dy * t, r, id);
  }
}

export function trackMeshRasterize(input: Record<string, unknown>): Record<string, unknown> {
  const width = typeof input.width === "number" ? Math.round(input.width) : 100;
  const height = typeof input.height === "number" ? Math.round(input.height) : 100;
  const trackWidth = typeof input.trackWidth === "number" ? Math.max(1, input.trackWidth) : 8;
  const trackId = typeof input.trackId === "number" ? Math.round(input.trackId) : 1;
  const bgId = typeof input.bgId === "number" ? Math.round(input.bgId) : 0;

  if (width <= 0 || height <= 0) return { error: "width 和 height 必须大于 0" };

  const pts = parsePoints(input.centerline);
  if (!pts || pts.length < 3) {
    return { error: "centerline 输入无效或顶点不足" };
  }

  const grid = createGrid(width, height, bgId);
  const radius = trackWidth / 2;
  const n = pts.length;

  // 在相邻采样点之间画填充线段（包括首尾相连闭合）
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    paintThickLine(grid, a.x, a.y, b.x, b.y, radius, trackId);
  }

  const outputNameList = [
    { id: bgId, name: "背景" },
    { id: trackId, name: "赛道" },
  ];

  return { outputGrid: grid, outputNameList };
}
