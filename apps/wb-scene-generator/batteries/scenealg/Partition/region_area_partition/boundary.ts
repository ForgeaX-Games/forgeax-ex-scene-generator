/**
 * boundary.ts
 * 四种边界后处理算法：
 *   organic      — CA 平滑（温和，自然有机感）
 *   smooth       — CA 多轮 + 更强的投票平滑
 *   rectilinear  — 矩形化（Manhattan 距离 Voronoi）
 *   voronoi      — 保持原始 Voronoi 边界（直接输出）
 */

/**
 * CA 平滑（Moore 邻域多数投票）
 * label=-1 表示不可用像素
 */
export function caSmooth(
  label: Int32Array,
  mask: Int32Array,   // 1=可用，0=不可用
  rows: number,
  cols: number,
  iterations: number,
  threshold: number    // 邻域中超过 threshold 个相同标签时才翻转，organic=4, smooth=3
): Int32Array {
  let cur = new Int32Array(label);
  const next = new Int32Array(rows * cols);

  for (let iter = 0; iter < iterations; iter++) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (!mask[idx]) { next[idx] = cur[idx]; continue; }

        // 统计 Moore 邻域（3x3）各标签票数
        const votes = new Map<number, number>();
        let selfLabel = cur[idx];
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = r + dr, nc = c + dc;
            if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
            const nidx = nr * cols + nc;
            if (!mask[nidx]) continue;
            const nb = cur[nidx];
            votes.set(nb, (votes.get(nb) ?? 0) + 1);
          }
        }

        // 找最高票标签
        let bestLabel = selfLabel, bestVote = 0;
        for (const [lbl, cnt] of votes) {
          if (cnt > bestVote) { bestVote = cnt; bestLabel = lbl; }
        }

        // 只有得票超过阈值时才更新
        next[idx] = bestVote >= threshold ? bestLabel : selfLabel;
      }
    }
    cur.set(next);
  }

  return cur;
}

/**
 * organic 风格：中等 CA 平滑（4-轮，阈值 4/8 邻居）
 */
export function organicBoundary(
  label: Int32Array,
  mask: Int32Array,
  rows: number,
  cols: number,
  iterations: number
): Int32Array {
  return caSmooth(label, mask, rows, cols, iterations, 4);
}

/**
 * smooth 风格：更强 CA 平滑（iterations*2 轮，阈值 3/8 邻居）
 */
export function smoothBoundary(
  label: Int32Array,
  mask: Int32Array,
  rows: number,
  cols: number,
  iterations: number
): Int32Array {
  return caSmooth(label, mask, rows, cols, iterations * 2, 3);
}

/**
 * voronoi 风格：直接返回原始 Voronoi 标签，不做任何后处理
 */
export function voronoiBoundary(
  label: Int32Array,
  _mask: Int32Array,
  _rows: number,
  _cols: number,
  _iterations: number
): Int32Array {
  return new Int32Array(label);
}

/**
 * rectilinear 风格：Manhattan 距离 Voronoi 重新分配，使边界呈 45°/水平/垂直直线
 * 之后再做 1-2 轮轻量 CA 去除锯齿
 */
export function rectilinearBoundary(
  label: Int32Array,
  mask: Int32Array,
  rows: number,
  cols: number,
  seeds: Array<{ x: number; y: number }>,
  areaWeights: number[],
  iterations: number
): Int32Array {
  const n = seeds.length;
  if (n === 0) return new Int32Array(label);

  const maxWeight = Math.max(...areaWeights);
  const normWeights = areaWeights.map(w => w / maxWeight);

  const newLabel = new Int32Array(rows * cols).fill(-1);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (!mask[idx]) continue;

      let bestK = 0, bestDist = Infinity;
      for (let k = 0; k < n; k++) {
        // 切比雪夫距离（Chebyshev）结合曼哈顿，产生 octagonal/矩形边界
        const dr = Math.abs(r - seeds[k].y);
        const dc = Math.abs(c - seeds[k].x);
        const manhattanDist = dr + dc;
        const effDist = manhattanDist / normWeights[k];
        if (effDist < bestDist) { bestDist = effDist; bestK = k; }
      }
      newLabel[idx] = bestK;
    }
  }

  // 轻量 CA 去毛刺
  return caSmooth(newLabel, mask, rows, cols, Math.min(2, iterations), 4);
}

/**
 * 统一分发接口
 */
export function applyBoundaryStyle(
  style: string,
  label: Int32Array,
  mask: Int32Array,
  rows: number,
  cols: number,
  seeds: Array<{ x: number; y: number }>,
  areaWeights: number[],
  iterations: number
): Int32Array {
  switch (style) {
    case 'smooth':
      return smoothBoundary(label, mask, rows, cols, iterations);
    case 'rectilinear':
      return rectilinearBoundary(label, mask, rows, cols, seeds, areaWeights, iterations);
    case 'voronoi':
      return voronoiBoundary(label, mask, rows, cols, iterations);
    case 'organic':
    default:
      return organicBoundary(label, mask, rows, cols, iterations);
  }
}
