/**
 * tessSymDeform: 镶嵌格对称边替换变形
 *
 * 真正的镶嵌对称变形（Symmetric Edge Substitution）：
 * 对每条共享边定义同一条曲线，相邻格子从各自视角看到的是同一条边的正反两面，
 * 数学上自动保证"每块形状相同且边界精确咬合"，不破坏全等性。
 *
 * 算法：
 *  1. 计算每个格子的质心（centroid）
 *  2. 对每个像素 P（在格子 T 中），检查所有 4-邻域像素：
 *     - 若邻域像素属于格子 T'，则 P 位于 T-T' 共享边附近
 *     - 定义法向量 n = normalize(cT' - cT)（从 T 指向 T'）
 *     - 定义边方向 e = rotate90(n)
 *     - 计算 P 到边中线的有符号距离 d = dot(P - M, n)
 *     - 计算 P 沿边的归一化位置 t = dot(P - M, e) / edgeLen + 0.5
 *     - 变形边位置：bump = amplitude × sin(2π × t)
 *       （2π 确保面积守恒：一半正、一半负）
 *     - 若 d ≥ bump：P 应属于 T'（跨越了变形边）
 *  3. 输出新的 regionGrid
 *
 * 对称性证明：
 *   从 T' 视角看同一条边：n' = -n，e' = -e，t' = 1 - t
 *   bump' = sin(2π(1-t)) = -sin(2πt) = -bump
 *   T' 侧的像素 d' = -d，判断条件 d' ≥ bump' 等价于 -d ≥ -bump 即 d ≤ bump
 *   与 T 侧的条件（d < bump）完全一致，两侧用同一条曲线。✓
 */

// ─── 质心计算 ─────────────────────────────────────────────────────────────────

function computeCentroids(
  grid: number[][], w: number, h: number
): Map<number, { x: number; y: number }> {
  const sums = new Map<number, { sx: number; sy: number; count: number }>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const id = grid[y][x];
      if (!sums.has(id)) sums.set(id, { sx: 0, sy: 0, count: 0 });
      const s = sums.get(id)!;
      s.sx += x; s.sy += y; s.count++;
    }
  }
  const centers = new Map<number, { x: number; y: number }>();
  for (const [id, s] of sums) {
    centers.set(id, { x: s.sx / s.count, y: s.sy / s.count });
  }
  return centers;
}

// ─── 自动估算格子边长（相邻格质心间距的中位数）──────────────────────────────

function estimateEdgeLen(
  grid: number[][], w: number, h: number,
  centers: Map<number, { x: number; y: number }>
): number {
  const dists: number[] = [];
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const T = grid[y][x];
      const cT = centers.get(T);
      if (!cT) continue;
      for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
        const nx = x + dx, ny = y + dy;
        if (nx >= w || ny >= h) continue;
        const T2 = grid[ny][nx];
        if (T2 === T) continue;
        const cT2 = centers.get(T2);
        if (!cT2) continue;
        const d = Math.hypot(cT2.x - cT.x, cT2.y - cT.y);
        if (d > 0) dists.push(d);
      }
    }
  }
  if (dists.length === 0) return 10;
  dists.sort((a, b) => a - b);
  return dists[Math.floor(dists.length / 2)];
}

// ─── 主导出函数 ──────────────────────────────────────────────────────────────

export function tessSymDeform(
  input: Record<string, unknown>
): Record<string, unknown> {
  const regionGrid = input.regionGrid as number[][] | undefined;
  if (!regionGrid || !regionGrid.length) {
    return { error: "regionGrid is required" };
  }

  const h = regionGrid.length;
  const w = regionGrid[0].length;

  const amplitude = typeof input.amplitude === "number" ? input.amplitude : 3;
  const edgeLenInput = typeof input.edgeLen === "number" && input.edgeLen > 0
    ? input.edgeLen : 0;

  // 计算每个格子的质心
  const centers = computeCentroids(regionGrid, w, h);

  // 自动估算或使用指定边长
  const edgeLen = edgeLenInput > 0 ? edgeLenInput : estimateEdgeLen(regionGrid, w, h, centers);

  // 输出 grid（先复制）
  const output: number[][] = regionGrid.map(row => [...row]);

  // 四连通方向
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const T = regionGrid[y][x];
      const cT = centers.get(T);
      if (!cT) continue;

      // 遍历 4 邻域，找到相邻的不同格子
      for (const [ddx, ddy] of DIRS) {
        const nx = x + ddx, ny = y + ddy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const T2 = regionGrid[ny][nx];
        if (T2 === T) continue;

        const cT2 = centers.get(T2);
        if (!cT2) continue;

        // 法向量（从 T 指向 T2）
        const dvx = cT2.x - cT.x, dvy = cT2.y - cT.y;
        const dvLen = Math.hypot(dvx, dvy);
        if (dvLen < 0.5) continue;
        const nvx = dvx / dvLen, nvy = dvy / dvLen;

        // 边方向（法向量旋转 90°）
        const evx = -nvy, evy = nvx;

        // 共享边中点（两质心中点）
        const mx = (cT.x + cT2.x) / 2;
        const my = (cT.y + cT2.y) / 2;

        // P 相对于边中点的坐标
        const rpx = x - mx, rpy = y - my;

        // 有符号距离（正值表示 P 在 T2 一侧）
        const signedDist = rpx * nvx + rpy * nvy;

        // 沿边位置，归一化到 [0, 1]
        const sAlong = rpx * evx + rpy * evy;
        const t = sAlong / edgeLen + 0.5;

        // 超出边范围则不处理（避免角点处的混乱）
        if (t < 0 || t > 1) continue;

        // 变形边偏移量：sin(2πt) 保证面积守恒、端点为 0
        const bump = amplitude * Math.sin(2 * Math.PI * t);

        // 若 P 跨越了变形边（signedDist ≥ bump），则 P 属于 T2
        if (signedDist >= bump) {
          output[y][x] = T2;
          break; // 已重新分类，跳过其他邻域
        }
      }
    }
  }

  return { warpedGrid: output };
}
