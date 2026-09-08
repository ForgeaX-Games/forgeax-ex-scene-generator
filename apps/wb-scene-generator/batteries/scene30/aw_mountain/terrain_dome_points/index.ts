/**
 * terrainDomePoints: 在归一化坐标空间内采样多个穹顶中心点
 * 使用拒绝采样保证任意两点间距 >= minSpacing
 * 输入：count / minSpacing / margin / seed
 * 输出：points — [{x, y}, ...] 归一化坐标点列表
 */

class SeededRandom {
  private s: number;
  constructor(seed: number) {
    this.s = seed === 0 ? Date.now() : Math.abs(Math.round(seed));
    // 预热几步避免低种子时分布不均
    for (let i = 0; i < 8; i++) this.next();
  }
  next(): number {
    // LCG，参数来自 Numerical Recipes
    this.s = (this.s * 1664525 + 1013904223) & 0xffffffff;
    return (this.s >>> 0) / 0xffffffff;
  }
}

interface Point { x: number; y: number; }

function isFarEnough(candidate: Point, placed: Point[], minDist: number): boolean {
  for (const p of placed) {
    const dx = candidate.x - p.x;
    const dy = candidate.y - p.y;
    if (dx * dx + dy * dy < minDist * minDist) return false;
  }
  return true;
}

export function terrainDomePoints(input: Record<string, unknown>): Record<string, unknown> {
  const count     = Math.max(1, Math.round(typeof input.count     === "number" ? input.count     : 3));
  const minSpacing = typeof input.minSpacing === "number" ? input.minSpacing : 0.25;
  const margin     = Math.max(0, Math.min(0.4, typeof input.margin === "number" ? input.margin : 0.1));
  const seed       = typeof input.seed === "number" ? input.seed : 0;

  const rng = new SeededRandom(seed);

  const lo = margin;
  const hi = 1 - margin;
  const range = hi - lo;

  if (range <= 0) {
    return { error: "margin is too large, leaves no valid placement area" };
  }

  const placed: Point[] = [];
  // 最大尝试次数：每个点尝试 200 次，超过则忽略（避免死循环）
  const MAX_TRIES = 200;

  for (let i = 0; i < count; i++) {
    let found = false;
    for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
      const candidate: Point = {
        x: lo + rng.next() * range,
        y: lo + rng.next() * range,
      };
      if (isFarEnough(candidate, placed, minSpacing)) {
        placed.push(candidate);
        found = true;
        break;
      }
    }
    if (!found) {
      // 空间已满，降级放置（保持尽量最远的位置）
      let bestCandidate: Point | null = null;
      let bestMinDist = -1;
      for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
        const candidate: Point = {
          x: lo + rng.next() * range,
          y: lo + rng.next() * range,
        };
        let d = Infinity;
        for (const p of placed) {
          const dd = (candidate.x - p.x) ** 2 + (candidate.y - p.y) ** 2;
          if (dd < d) d = dd;
        }
        if (d > bestMinDist) {
          bestMinDist = d;
          bestCandidate = candidate;
        }
      }
      if (bestCandidate) placed.push(bestCandidate);
    }
  }

  return { points: placed };
}
