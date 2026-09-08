/**
 * regionCompassSqueeze: 以区域自身八个方位的边界锚点为受力点，对区域做局部有符号形变
 * （"揉面团"：每个方位可独立设置压缩/拉伸强度，效果按距离平滑衰减）。
 *
 * 输入：region (grid) — 0/1（或多值）区域，非零格视为前景，支持任意异形/不规则轮廓
 *       north / northeast / east / southeast / south / southwest / west / northwest (number)
 *         — 八个方位各自的力度。正数=压缩（该方位附近边界向内收缩），负数=拉伸（向外扩张），0=不施力
 *       radius (number) — 每个方位锚点的影响半径（格数），超出范围衰减为 0
 *       connectivity (number, 4 或 8) — 距离场用的邻接方式，默认 8（形变更顺滑）
 * 输出：region (grid) — 形变后的 0/1 区域，与输入同形状
 *       delta (grid) — 变化标记：-1 被压缩移除，+1 被拉伸新增，0 未变化
 *
 * 算法：
 * 1. 以区域重心为原点，在每个方位向量上取投影最远的边界格作为该方位的锚点（对非凸/异形区域也稳健）。
 * 2. 每格的净位移场 = 各方位「力度 × 到锚点欧氏距离的平滑衰减权重」之和（多方位自然叠加/过渡）。
 * 3. 用有符号"到边界"距离场（前景内=到最近背景的距离，前景外=到最近前景的负距离）与净位移场逐格比较：
 *    距离场 > 位移场 则为前景，否则为背景 —— 位移场越大局部越"收进去"，越小（负）越"鼓出来"。
 * 4. 全程在原始 grid 尺寸内运算，不改变数组大小（与 alg_region_offset 一致的边界约束）：
 *    压缩总会生效；拉伸则受当前画布内已有背景余量限制——若该方位本来就贴满画布边缘，
 *    拉伸会被裁掉（与 alg_region_offset "外扩受 bbox 限制" 同一约束，见其 README）。
 */

type Grid = number[][];
type Dir = "north" | "northeast" | "east" | "southeast" | "south" | "southwest" | "west" | "northwest";

const SQRT1_2 = Math.SQRT1_2;

const DIR_VECTORS: Record<Dir, [number, number]> = {
  // [dx(列/东为正), dy(行/南为正)]，与仓库约定一致：右=+x=东，下=+y=南
  north: [0, -1],
  northeast: [SQRT1_2, -SQRT1_2],
  east: [1, 0],
  southeast: [SQRT1_2, SQRT1_2],
  south: [0, 1],
  southwest: [-SQRT1_2, SQRT1_2],
  west: [-1, 0],
  northwest: [-SQRT1_2, -SQRT1_2],
};

const DIR_KEYS = Object.keys(DIR_VECTORS) as Dir[];

function neighborsInBounds(
  r: number,
  c: number,
  rows: number,
  cols: number,
  conn8: boolean,
): [number, number][] {
  const out: [number, number][] = [];
  if (r > 0) out.push([r - 1, c]);
  if (r < rows - 1) out.push([r + 1, c]);
  if (c > 0) out.push([r, c - 1]);
  if (c < cols - 1) out.push([r, c + 1]);
  if (conn8) {
    if (r > 0 && c > 0) out.push([r - 1, c - 1]);
    if (r > 0 && c < cols - 1) out.push([r - 1, c + 1]);
    if (r < rows - 1 && c > 0) out.push([r + 1, c - 1]);
    if (r < rows - 1 && c < cols - 1) out.push([r + 1, c + 1]);
  }
  return out;
}

function toForeground(region: Grid, rows: number, cols: number): boolean[][] {
  const fg: boolean[][] = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      fg[r][c] = (region[r]?.[c] ?? 0) !== 0;
    }
  }
  return fg;
}

/** 前景格到最近背景（含网格外缘）的 BFS 距离；网格外缘用 1 格虚拟背景 pad 实现。 */
function distanceToBackground(fg: boolean[][], rows: number, cols: number, conn8: boolean): number[][] {
  const pr = rows + 2;
  const pc = cols + 2;
  const padded: boolean[][] = Array.from({ length: pr }, () => new Array<boolean>(pc).fill(false));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      padded[r + 1][c + 1] = fg[r][c];
    }
  }

  const dist = Array.from({ length: pr }, () => new Array<number>(pc).fill(Infinity));
  const queue: [number, number][] = [];
  for (let r = 0; r < pr; r++) {
    for (let c = 0; c < pc; c++) {
      if (!padded[r][c]) {
        dist[r][c] = 0;
        queue.push([r, c]);
      }
    }
  }

  let qi = 0;
  while (qi < queue.length) {
    const [r, c] = queue[qi++]!;
    const base = dist[r][c];
    for (const [nr, nc] of neighborsInBounds(r, c, pr, pc, conn8)) {
      const nd = base + 1;
      if (nd < dist[nr][nc]) {
        dist[nr][nc] = nd;
        queue.push([nr, nc]);
      }
    }
  }

  const out = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (fg[r][c]) out[r][c] = dist[r + 1][c + 1];
    }
  }
  return out;
}

/** 背景格到最近前景的 BFS 距离；只在原始网格内搜索（不把网格外当前景源）。 */
function distanceToForeground(fg: boolean[][], rows: number, cols: number, conn8: boolean): number[][] {
  const dist = Array.from({ length: rows }, () => new Array<number>(cols).fill(Infinity));
  const queue: [number, number][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (fg[r][c]) {
        dist[r][c] = 0;
        queue.push([r, c]);
      }
    }
  }

  let qi = 0;
  while (qi < queue.length) {
    const [r, c] = queue[qi++]!;
    const base = dist[r][c];
    for (const [nr, nc] of neighborsInBounds(r, c, rows, cols, conn8)) {
      const nd = base + 1;
      if (nd < dist[nr][nc]) {
        dist[nr][nc] = nd;
        queue.push([nr, nc]);
      }
    }
  }
  return dist;
}

function smoothstep01(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function regionCompassSqueeze(input: Record<string, unknown>): Record<string, unknown> {
  const region = input.region as Grid | undefined;
  if (!region || region.length === 0 || (region[0]?.length ?? 0) === 0) {
    return { error: "region is required" };
  }

  const rows = region.length;
  const cols = region[0]!.length;
  const fg = toForeground(region, rows, cols);
  const hasForeground = fg.some((row) => row.some((v) => v));

  const strengths: Record<Dir, number> = {} as Record<Dir, number>;
  let anyStrength = false;
  for (const key of DIR_KEYS) {
    const raw = input[key];
    const v = typeof raw === "number" && Number.isFinite(raw) ? clamp(raw, -64, 64) : 0;
    strengths[key] = v;
    if (v !== 0) anyStrength = true;
  }

  const radius = clamp(typeof input.radius === "number" ? input.radius : 10, 1, 128);
  const conn8 = typeof input.connectivity === "number" ? Math.round(input.connectivity) === 8 : true;

  const normalized: Grid = fg.map((row) => row.map((v) => (v ? 1 : 0)));

  if (!hasForeground || !anyStrength) {
    const delta = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
    return { region: normalized, delta };
  }

  let sumR = 0;
  let sumC = 0;
  let count = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (fg[r][c]) {
        sumR += r;
        sumC += c;
        count++;
      }
    }
  }
  const centroidR = sumR / count;
  const centroidC = sumC / count;

  const boundary: [number, number][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!fg[r][c]) continue;
      const onEdge = r === 0 || r === rows - 1 || c === 0 || c === cols - 1;
      const nearBg =
        (r > 0 && !fg[r - 1][c]) ||
        (r < rows - 1 && !fg[r + 1][c]) ||
        (c > 0 && !fg[r][c - 1]) ||
        (c < cols - 1 && !fg[r][c + 1]);
      if (onEdge || nearBg) boundary.push([r, c]);
    }
  }
  const candidates: [number, number][] = boundary.length > 0 ? boundary : [[Math.round(centroidR), Math.round(centroidC)]];

  const anchors: Partial<Record<Dir, [number, number]>> = {};
  const TIE_EPS = 1e-6;
  for (const key of DIR_KEYS) {
    if (strengths[key] === 0) continue;
    const [dx, dy] = DIR_VECTORS[key];
    const px = -dy;
    const py = dx;

    // 先找该方位投影最大值（最靠该方位一侧）。
    let bestScore = -Infinity;
    for (const [r, c] of candidates) {
      const score = (c - centroidC) * dx + (r - centroidR) * dy;
      if (score > bestScore) bestScore = score;
    }
    // 在投影并列最大的候选里（矩形/多边形一条直边上会有很多并列点），
    // 取垂直方向投影绝对值最小的那个——即该直边的中点，而不是任取第一个（易落到角上）。
    let best: [number, number] = candidates[0]!;
    let bestPerp = Infinity;
    for (const [r, c] of candidates) {
      const score = (c - centroidC) * dx + (r - centroidR) * dy;
      if (score < bestScore - TIE_EPS) continue;
      const perp = Math.abs((c - centroidC) * px + (r - centroidR) * py);
      if (perp < bestPerp) {
        bestPerp = perp;
        best = [r, c];
      }
    }
    anchors[key] = best;
  }

  const distBg = distanceToBackground(fg, rows, cols, conn8);
  const distFg = distanceToForeground(fg, rows, cols, conn8);

  const out: Grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  const delta: Grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let netShift = 0;
      for (const key of DIR_KEYS) {
        const anchor = anchors[key];
        if (!anchor) continue;
        const [ar, ac] = anchor;
        const d = Math.hypot(c - ac, r - ar);
        if (d >= radius) continue;
        const weight = smoothstep01(1 - d / radius);
        netShift += strengths[key] * weight;
      }

      const wasFg = fg[r][c];
      const fgDist = distFg[r][c];
      const sd = wasFg ? distBg[r][c] : -(Number.isFinite(fgDist) ? fgDist : 1e9);
      const isFg = sd > netShift;

      out[r][c] = isFg ? 1 : 0;
      delta[r][c] = isFg === wasFg ? 0 : isFg ? 1 : -1;
    }
  }

  return { region: out, delta };
}
