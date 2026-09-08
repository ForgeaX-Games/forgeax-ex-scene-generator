type Grid = number[][];

interface NameEntry {
  id: number;
  name: string;
  type?: string;
}

function isGrid(value: unknown): value is Grid {
  return Array.isArray(value)
    && value.length > 0
    && Array.isArray(value[0])
    && ((value[0] as unknown[]).length === 0 || typeof (value[0] as unknown[])[0] === "number");
}

function makeGrid(rows: number, cols: number, fill = 0): Grid {
  return Array.from({ length: rows }, () => new Array(cols).fill(fill));
}

function num(input: Record<string, unknown>, key: string, fallback: number): number {
  const value = input[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function int(input: Record<string, unknown>, key: string, fallback: number): number {
  return Math.round(num(input, key, fallback));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function resolveSeed(seed: unknown): number {
  const raw = typeof seed === "number" && Number.isFinite(seed) ? seed : 0;
  return raw === 0 ? 123456789 : raw >>> 0;
}

function hash2(x: number, y: number, seed: number): number {
  let h = (seed | 0) ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const xf = x - x0, yf = y - y0;
  const u = fade(xf), v = fade(yf);
  return lerp(
    lerp(hash2(x0, y0, seed), hash2(x0 + 1, y0, seed), u),
    lerp(hash2(x0, y0 + 1, seed), hash2(x0 + 1, y0 + 1, seed), u),
    v
  );
}

function fbm(x: number, y: number, seed: number, octaves: number): number {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum  += amp * valueNoise(x * freq, y * freq, seed + o * 1013);
    norm += amp; amp *= 0.5; freq *= 2;
  }
  return norm > 0 ? sum / norm : 0;
}

const DIR4: Array<[number, number]> = [[-1, 0], [1, 0], [0, -1], [0, 1]];

// ── Step 1: BFS 距离变换 ─────────────────────────────────────────────────
// 返回每个陆地像素到最近海洋边缘的步数；海洋像素返回 0。
function coastDistance(landGrid: Grid): number[][] {
  const rows = landGrid.length, cols = landGrid[0]?.length ?? 0;
  const dist: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const queue: [number, number, number][] = [];

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!landGrid[y][x]) continue;
      let isCoast = false;
      for (const [dx, dy] of DIR4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !landGrid[ny][nx]) {
          isCoast = true; break;
        }
      }
      if (isCoast) { dist[y][x] = 1; queue.push([y, x, 1]); }
    }
  }

  let head = 0;
  while (head < queue.length) {
    const [y, x, d] = queue[head++];
    for (const [dx, dy] of DIR4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !landGrid[ny][nx]) continue;
      if (dist[ny][nx] !== 0) continue;  // 已访问
      dist[ny][nx] = d + 1;
      queue.push([ny, nx, d + 1]);
    }
  }

  return dist;
}

// ── Step 2: 区域边界法提取沿海道路骨架 ────────────────────────────────────
//
// 与 connected_roads 完全相同的机制（保证宽度一致 + 连续无断点）：
//   1. 按"扰动后距海岸距离"把陆地切成两个区域：
//        region 1 = 沿海带（effDist < coastDist）
//        region 2 = 内陆  （effDist >= coastDist）
//   2. 提取两区域之间的边界（extractInternalBorders 同款逻辑）。
//
// 区域平铺整块陆地，其边界天然是一条连续闭合曲线 → 不会有断点；
// 边界宽度与 connected_roads 的内部边界完全一致（两侧各标记 1px）。
function buildCoastalBand(
  dist: number[][], landGrid: Grid,
  cols: number, rows: number,
  coastDist: number,
  perturbAmp: number, seed: number
): Grid {
  // 两层噪声：大尺度弯折（占 70%）+ 中尺度细节（占 30%）
  const s1 = 0.035, s2 = 0.10;
  const amp1 = perturbAmp * 0.7, amp2 = perturbAmp * 0.3;

  // Step A: 按扰动距离切分两区域
  const region = makeGrid(rows, cols, 0);  // 0=海, 1=沿海带, 2=内陆
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!landGrid[y][x] || dist[y][x] === 0) continue;
      const p1 = (fbm(x * s1, y * s1, seed,         3) - 0.5) * 2 * amp1;
      const p2 = (fbm(x * s2, y * s2, seed + 55555, 3) - 0.5) * 2 * amp2;
      const effDist = dist[y][x] + p1 + p2;
      region[y][x] = effDist < coastDist ? 1 : 2;
    }
  }

  // Step B: 提取沿海带与内陆之间的边界（两侧均标记，与 connected_roads 一致）
  const road = makeGrid(rows, cols, 0);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const v = region[y][x];
      if (v <= 0) continue;
      for (const [dx, dy] of DIR4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const w = region[ny][nx];
        if (w > 0 && w !== v) { road[y][x] = 1; break; }
      }
    }
  }
  return road;
}

// ── Step 3: 平滑（线段保留式多数表决）──────────────────────────────────
// 沿海道路是细线而非面积，不能用面积平滑的高 birthLimit。
// 规则：8 邻居中道路数 n：
//   n >= 5 → 变成道路（填补小空隙）
//   n == 0 → 清除（孤立噪点）
//   其余  → 保持原值（线段本身不受影响）
function smoothRoad(road: Grid, landGrid: Grid, iterations: number): Grid {
  const rows = road.length, cols = road[0]?.length ?? 0;
  let cells = road.map(r => r.slice());
  for (let it = 0; it < iterations; it++) {
    const next = cells.map(r => r.slice());
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (!landGrid[y]?.[x]) continue;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
            if (cells[ny][nx]) n++;
          }
        }
        next[y][x] = n >= 5 ? 1 : n === 0 ? 0 : cells[y][x];
      }
    }
    cells = next;
  }
  return cells;
}

// ── Step 4: 分段过滤 ─────────────────────────────────────────────────────
// 基于以陆地质心为原点的方位角做低频噪声：
//   噪声频率 = segCount（绕一圈出现约 segCount 次波峰/波谷）
//   阈值 = 1 - segLength（道路存在的比例）
// 方位角空间保证分段沿海岸线均匀分布，不受地图宽高比影响。
function applySegments(
  road: Grid, landGrid: Grid,
  rows: number, cols: number,
  seed: number, segCount: number, segLength: number
): Grid {
  if (segCount <= 1 && segLength >= 1.0) return road;

  // 计算陆地质心（用于方位角参数化）
  let cx = 0, cy = 0, total = 0;
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++)
      if (landGrid[y][x]) { cx += x; cy += y; total++; }
  if (total > 0) { cx /= total; cy /= total; }
  else { cx = cols / 2; cy = rows / 2; }

  const out = makeGrid(rows, cols, 0);
  // segCount 控制分段频率；segLength 控制占空比（有路的比例）
  // 两层噪声：主层（沿方位角，决定段数）+ 细节层（2D，让边缘参差）
  const freqScale = segCount * 0.55 / Math.PI;
  const edgeSoft  = 0.12;  // 边缘过渡带宽（softstep），避免硬切

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!road[y][x]) continue;

      const angle = Math.atan2(y - cy, x - cx);
      const t  = (angle / Math.PI + 1) * 0.5;
      const nx = t * freqScale;

      // 主控噪声（方位角方向）+ 少量 2D 细节
      const mainNoise   = valueNoise(nx, 0.5, seed + 9999);
      const detailNoise = valueNoise(x * 0.05, y * 0.05, seed + 8888);
      const segNoise    = mainNoise * 0.80 + detailNoise * 0.20;

      // 带软边缘的阈值：段落边缘用 smoothstep 过渡，而非硬切
      const lo = 1 - segLength;
      const hi = lo + edgeSoft;
      if (segNoise <= lo) continue;          // 确定空缺
      if (segNoise >= hi) { out[y][x] = 1; continue; } // 确定有路
      // 过渡区域：按概率保留（模拟渐变断头）
      const prob = (segNoise - lo) / (hi - lo);
      if (valueNoise(x * 0.2, y * 0.2, seed + 7777) < prob) out[y][x] = 1;
    }
  }
  return out;
}

// ── Step 5: 膨胀（roadWidth px）──────────────────────────────────────────
function dilate(road: Grid, landGrid: Grid, radius: number): Grid {
  if (radius <= 0) return road.map(r => r.slice());
  const rows = road.length, cols = road[0]?.length ?? 0;
  const out = makeGrid(rows, cols, 0);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!road[y][x]) continue;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > radius * radius) continue;
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && landGrid[ny][nx])
            out[ny][nx] = 1;
        }
      }
    }
  }
  return out;
}

// ── 主函数 ────────────────────────────────────────────────────────────────
export function coastalRoads(input: Record<string, unknown>): Record<string, unknown> {
  if (!isGrid(input.landGrid)) return { error: "landGrid is required" };
  const landGrid  = input.landGrid as Grid;
  const rows = landGrid.length, cols = landGrid[0]?.length ?? 0;
  const seed       = resolveSeed(input.seed);
  const coastDist  = clamp(int(input, "coastDist", 5), 1, 30);
  const roadWidth  = clamp(int(input, "roadWidth", 1), 1, 7);
  const perturbAmp = clamp(num(input, "perturbAmp", 6), 0, 20);
  const smoothIter = clamp(int(input, "smoothIter", 0), 0, 6);
  const segCount   = clamp(int(input, "segCount", 1), 1, 12);
  const segLength  = clamp(num(input, "segLength", 1.0), 0.1, 1.0);
  // dilation 半径 = floor((roadWidth-1)/2)，与 connected_roads 完全一致
  const dilRadius = Math.floor((roadWidth - 1) / 2);

  // Step 1: BFS 距离变换
  const dist = coastDistance(landGrid);

  // Step 2: 噪声扰动 → 1px 骨架（宽度由 dilation 控制）
  let road = buildCoastalBand(dist, landGrid, cols, rows, coastDist, perturbAmp, seed);

  // Step 3: 平滑
  road = smoothRoad(road, landGrid, smoothIter);

  // Step 4: 分段过滤
  road = applySegments(road, landGrid, rows, cols, seed, segCount, segLength);

  // Step 5: 宽度膨胀
  road = dilate(road, landGrid, dilRadius);

  const NAMES: NameEntry[] = [{ id: 1, name: "沿海道路", type: "tile" }];
  return { roadGrid: road, outputNameList: NAMES };
}
