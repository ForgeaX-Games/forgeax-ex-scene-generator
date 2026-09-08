/**
 * trackSkeletonGenerate: 赛道骨架生成
 * 用极坐标排列 + 随机半径波动的方式生成闭合多边形骨架。
 * 每个控制点按等分角度排布，赋予随机半径（在椭圆轨道上波动），
 * 偶尔插入"发卡弯"顶点（小半径点）产生尖角回折效果。
 *
 * 输入：width (number) — 空间宽度; height (number) — 空间高度;
 *       pointCount (number) — 控制点数量; perturbScale (number) — 随机波动幅度 [0,1];
 *       margin (number) — 边界留白; seed (number) — 随机种子
 * 输出：skeleton (array) — [{x,y}...] 闭合多边形顶点（JSON 字符串）
 */

type Point = { x: number; y: number };

function makeLCG(seed: number): () => number {
  let s = (seed ^ 0x12345678) >>> 0;
  if (s === 0) s = 1;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * 极坐标多边形生成：
 * - 控制点按等分角度（加小抖动）排布
 * - 每个点的半径在 [minR, maxR] 范围内随机
 * - hairpinChance 概率下插入小半径点模拟发卡弯
 */
function generatePolarPolygon(
  cx: number, cy: number,
  rx: number, ry: number,
  pointCount: number,
  perturbScale: number,
  hairpinChance: number,
  rng: () => number
): Point[] {
  const pts: Point[] = [];
  const angleStep = (Math.PI * 2) / pointCount;
  // 轴向半径波动范围
  const minFactor = 1 - perturbScale * 0.7;
  const maxFactor = 1 + perturbScale * 0.4;

  for (let i = 0; i < pointCount; i++) {
    // 角度带微小抖动，防止等距排列太均匀
    const angleJitter = (rng() - 0.5) * angleStep * 0.45;
    const angle = i * angleStep + angleJitter;

    let rFactor: number;
    if (rng() < hairpinChance) {
      // 发卡弯：极小半径形成尖角回折
      rFactor = minFactor * (0.25 + rng() * 0.25);
    } else {
      rFactor = minFactor + rng() * (maxFactor - minFactor);
    }

    pts.push({
      x: cx + Math.cos(angle) * rx * rFactor,
      y: cy + Math.sin(angle) * ry * rFactor,
    });
  }
  return pts;
}

/**
 * 对多边形每条边插入扰动中点，增加弯道细节
 */
function subdivideAndPerturb(
  pts: Point[],
  perturbScale: number,
  cx: number, cy: number,
  rx: number, ry: number,
  rng: () => number
): Point[] {
  const n = pts.length;
  const result: Point[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    result.push(a);

    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    // 法线方向（相对边向量）
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const elen = Math.sqrt(ex * ex + ey * ey) || 1;
    const nx = -ey / elen;
    const ny = ex / elen;
    const displacement = (rng() - 0.5) * perturbScale * elen * 0.6;
    result.push({ x: mx + nx * displacement, y: my + ny * displacement });
  }
  return result;
}

export function trackSkeletonGenerate(input: Record<string, unknown>): Record<string, unknown> {
  const width = typeof input.width === "number" ? Math.round(input.width) : 100;
  const height = typeof input.height === "number" ? Math.round(input.height) : 100;
  const pointCount = typeof input.pointCount === "number" ? Math.max(6, Math.round(input.pointCount)) : 10;
  const perturbScale = typeof input.perturbScale === "number" ? Math.max(0, Math.min(1, input.perturbScale)) : 0.4;
  const margin = typeof input.margin === "number" ? Math.max(0, Math.round(input.margin)) : 10;
  const seedRaw = typeof input.seed === "number" ? input.seed : 0;

  if (width <= 0 || height <= 0) return { error: "width 和 height 必须大于 0" };

  const baseSeed = seedRaw === 0 ? Date.now() : seedRaw;
  const rng = makeLCG(baseSeed);

  const innerW = width - margin * 2;
  const innerH = height - margin * 2;
  const cx = width / 2;
  const cy = height / 2;
  // 椭圆半轴稍小于可用空间的 45%，确保波动后不超出边界
  const rx = innerW * 0.42;
  const ry = innerH * 0.42;

  // 发卡弯概率：pointCount 越多，概率越低（否则太多尖角）
  const hairpinChance = Math.min(0.35, 2.5 / pointCount);

  // 生成极坐标多边形
  const basePts = generatePolarPolygon(cx, cy, rx, ry, pointCount, perturbScale, hairpinChance, rng);

  // 细分一次，插入扰动中点，增加弯道细节
  const rng2 = makeLCG(baseSeed + 999983);
  const skeleton = subdivideAndPerturb(basePts, perturbScale * 0.5, cx, cy, rx, ry, rng2);

  // 最终裁剪到边界内（防止极端情况超出）
  const clamped = skeleton.map(p => ({
    x: Math.max(margin, Math.min(width - margin, p.x)),
    y: Math.max(margin, Math.min(height - margin, p.y)),
  }));

  return { skeleton: JSON.stringify(clamped) };
}
