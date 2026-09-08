/**
 * regionBoundarySmooth: 多区域边界三阶段平滑
 *
 * Phase 1 — BFS 填隙：把 0 值间隙格子填充为最近区域 ID（形成完整 Voronoi 分区）
 * Phase 2 — 高斯加权投票迭代平滑：多轮邻域投票使边界曲线更自然
 * Phase 3 — 重刻均匀间隙：在区域交界处按 gapWidth 重新雕出固定宽度间隙
 *
 * 输入：regionGrid (grid) — 多区域 ID 网格（1-based，0=间隙/空地）
 * 输出：smoothGrid (grid) — 平滑后区域 ID 网格；baseGrid (grid) — 二值掩码
 */

// ─── Phase 1: BFS 填充间隙 ────────────────────────────────────────────────────
// 从所有非零格向外 BFS 扩张，把 0 值格子填充为最先到达它的区域 ID

function fillGapsBFS(region: number[][], w: number, h: number): number[][] {
  const result = region.map(row => [...row]);
  const queue: Array<[number, number]> = [];
  let head = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (result[y][x] !== 0) queue.push([x, y]);
    }
  }

  const dirs4: Array<[number, number]> = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  while (head < queue.length) {
    const [cx, cy] = queue[head++];
    const rid = result[cy][cx];
    for (const [dx, dy] of dirs4) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      if (result[ny][nx] !== 0) continue;
      result[ny][nx] = rid;
      queue.push([nx, ny]);
    }
  }

  return result;
}

// ─── Phase 2: 高斯加权多数投票迭代平滑 ───────────────────────────────────────
// 对每个格子，统计 kernelRadius 邻域内各区域的高斯加权票数，
// 取票数最多的区域 ID，重复 iterations 次

function gaussianVoteSmooth(
  region: number[][],
  w: number,
  h: number,
  kernelRadius: number,
  iterations: number
): number[][] {
  let current = region.map(row => [...row]);
  const sigma2 = 2 * (kernelRadius / 2) * (kernelRadius / 2);

  // 预计算高斯权重表，避免重复 exp 运算
  const weightTable: number[][] = [];
  for (let dy = -kernelRadius; dy <= kernelRadius; dy++) {
    weightTable[dy + kernelRadius] = [];
    for (let dx = -kernelRadius; dx <= kernelRadius; dx++) {
      const d2 = dx * dx + dy * dy;
      weightTable[dy + kernelRadius][dx + kernelRadius] = Math.exp(-d2 / sigma2);
    }
  }

  for (let iter = 0; iter < iterations; iter++) {
    const next = current.map(row => [...row]);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const votes = new Map<number, number>();

        for (let dy = -kernelRadius; dy <= kernelRadius; dy++) {
          for (let dx = -kernelRadius; dx <= kernelRadius; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
            const rid = current[ny][nx];
            if (rid === 0) continue;
            const weight = weightTable[dy + kernelRadius][dx + kernelRadius];
            votes.set(rid, (votes.get(rid) ?? 0) + weight);
          }
        }

        if (votes.size === 0) continue;

        let bestRid = current[y][x];
        let bestWeight = -1;
        for (const [rid, weight] of votes) {
          if (weight > bestWeight) { bestWeight = weight; bestRid = rid; }
        }
        next[y][x] = bestRid;
      }
    }

    current = next;
  }

  return current;
}

// ─── Phase 3: 重刻均匀间隙 ───────────────────────────────────────────────────
// 找出所有区域边界格子（4邻中含不同区域），
// 向外 BFS 膨胀 gapWidth-1 步，所有标记格子置 0

function recarveGaps(
  region: number[][],
  w: number,
  h: number,
  gapWidth: number
): number[][] {
  if (gapWidth <= 0) return region.map(row => [...row]);

  const dirs4: Array<[number, number]> = [[0, -1], [0, 1], [-1, 0], [1, 0]];

  // 找初始边界格子
  const gapMask = Array.from({ length: h }, () => new Uint8Array(w));
  const queue: Array<[number, number, number]> = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const rid = region[y][x];
      let isBoundary = false;
      for (const [dx, dy] of dirs4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        if (region[ny][nx] !== rid) { isBoundary = true; break; }
      }
      if (isBoundary) {
        gapMask[y][x] = 1;
        queue.push([x, y, 0]);
      }
    }
  }

  // BFS 膨胀 gapWidth-1 步
  let head = 0;
  while (head < queue.length) {
    const [cx, cy, depth] = queue[head++];
    if (depth >= gapWidth - 1) continue;
    for (const [dx, dy] of dirs4) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      if (gapMask[ny][nx]) continue;
      gapMask[ny][nx] = 1;
      queue.push([nx, ny, depth + 1]);
    }
  }

  // 应用间隙掩码
  const result = region.map(row => [...row]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (gapMask[y][x]) result[y][x] = 0;
    }
  }

  return result;
}

// ─── 主导出函数 ──────────────────────────────────────────────────────────────

export function regionBoundarySmooth(
  input: Record<string, unknown>
): Record<string, unknown> {
  const rawGrid = input.regionGrid;
  if (!Array.isArray(rawGrid) || rawGrid.length === 0 || !Array.isArray(rawGrid[0])) {
    return { smoothGrid: [], baseGrid: [] };
  }
  const region = rawGrid as number[][];
  const h = region.length;
  const w = region[0].length;

  const iterations =
    typeof input.iterations === "number" ? Math.max(1, Math.round(input.iterations)) : 3;
  const kernelRadius =
    typeof input.kernelRadius === "number" ? Math.max(1, Math.round(input.kernelRadius)) : 2;
  const gapWidth =
    typeof input.gapWidth === "number" ? Math.max(0, Math.round(input.gapWidth)) : 1;

  // Phase 1: 填充间隙
  const filled = fillGapsBFS(region, w, h);

  // Phase 2: 高斯加权投票平滑
  const smoothed = gaussianVoteSmooth(filled, w, h, kernelRadius, iterations);

  // Phase 3: 重刻均匀间隙
  const smoothGrid = recarveGaps(smoothed, w, h, gapWidth);

  // 生成二值掩码
  const baseGrid = smoothGrid.map(row => row.map(v => (v > 0 ? 1 : 0)));

  return { smoothGrid, baseGrid };
}
