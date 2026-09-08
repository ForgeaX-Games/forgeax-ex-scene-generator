/**
 * trackSplineSmooth: 赛道样条平滑
 * 对骨架多边形顶点序列执行 Catmull-Rom 样条插值，
 * 生成光滑的闭合中心线采样点序列。
 *
 * 输入：skeleton (array) — [{x,y}...] JSON 字符串;
 *       samplesPerSegment (number) — 每段插值采样点数;
 *       tension (number) — 张力系数 [0,1]，越小越贴近控制点
 * 输出：centerline (array) — [{x,y}...] JSON 字符串（平滑曲线点列）
 */

type Point = { x: number; y: number };

/**
 * Catmull-Rom 插值：在 p1→p2 段上计算 t 处的点
 * tension 控制切线长度（alpha = 0.5 为向心 Catmull-Rom）
 */
function catmullRomPoint(
  p0: Point, p1: Point, p2: Point, p3: Point,
  t: number, tension: number
): Point {
  const t2 = t * t;
  const t3 = t2 * t;
  const s = (1 - tension) / 2;

  return {
    x: s * ((-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
         + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2
         + (-p0.x + p2.x) * t)
       + p1.x,
    y: s * ((-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
         + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2
         + (-p0.y + p2.y) * t)
       + p1.y,
  };
}

function smoothClosed(pts: Point[], samplesPerSegment: number, tension: number): Point[] {
  const n = pts.length;
  if (n < 3) return pts.slice();

  const result: Point[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];

    for (let s = 0; s < samplesPerSegment; s++) {
      const t = s / samplesPerSegment;
      result.push(catmullRomPoint(p0, p1, p2, p3, t, tension));
    }
  }
  return result;
}

export function trackSplineSmooth(input: Record<string, unknown>): Record<string, unknown> {
  const skeletonRaw = input.skeleton;
  const samplesPerSegment = typeof input.samplesPerSegment === "number"
    ? Math.max(3, Math.round(input.samplesPerSegment))
    : 30;
  const tension = typeof input.tension === "number"
    ? Math.max(0, Math.min(1, input.tension))
    : 0.5;

  // skeleton 可能是 array 或 JSON 字符串
  let pts: Point[] = [];
  if (typeof skeletonRaw === "string") {
    try {
      pts = JSON.parse(skeletonRaw) as Point[];
    } catch {
      return { error: "skeleton 解析失败，请检查 JSON 格式" };
    }
  } else if (Array.isArray(skeletonRaw)) {
    pts = skeletonRaw as Point[];
  } else {
    return { error: "skeleton 输入不能为空" };
  }

  if (!Array.isArray(pts) || pts.length < 3) {
    return { error: "skeleton 至少需要 3 个顶点" };
  }

  const centerline = smoothClosed(pts, samplesPerSegment, tension);
  return { centerline: JSON.stringify(centerline) };
}
