type Grid = number[][];

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
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const xf = x - x0;
  const yf = y - y0;
  const v00 = hash2(x0, y0, seed);
  const v10 = hash2(x0 + 1, y0, seed);
  const v01 = hash2(x0, y0 + 1, seed);
  const v11 = hash2(x0 + 1, y0 + 1, seed);
  const u = fade(xf);
  const v = fade(yf);
  return lerp(lerp(v00, v10, u), lerp(v01, v11, u), v);
}

function fbm(x: number, y: number, seed: number, octaves: number, persistence: number): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + o * 1013);
    norm += amp;
    amp *= persistence;
    freq *= 2;
  }
  return norm > 0 ? sum / norm : 0;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

// 地形高度阈值
const DEEP_SEA_MAX    = 0.28;
const SHALLOW_SEA_MAX = 0.42;
const BEACH_MAX       = 0.47;
const PLAINS_MAX      = 0.76;
const HILLS_MAX       = 0.88;

/**
 * 大陆核心基准坐标（归一化 [-1,1]² 空间）。
 *
 * 设计原则：
 *   - N=1：中心固定 (0,0)，单大陆行为与原版一致。
 *   - N=2：左右对称分布，确保两块大陆均匀铺满地图左右两侧。
 *   - N=3~6：均匀分布在地图面积上，每块大陆占据相近的区域。
 *
 * 在基准坐标上叠加 seed 派生的小扰动（±0.14），
 * 使不同种子产生形态各异的世界，同时保持整体布局均匀。
 */
function makeContinentCenters(count: number, seed: number): [number, number][] {
  // 预设基准位置：核心间距要足够大，保证宽海峡；覆盖地图面积均匀分布
  const BASE_POSITIONS: Record<number, [number, number][]> = {
    1: [[0, 0]],
    2: [[-0.56, 0.0], [0.56, 0.0]],   // 比原来 ±0.44 更远，留出宽海峡
    3: [[0.0, -0.52], [-0.52, 0.34], [0.52, 0.34]],
    4: [[-0.50, -0.34], [0.50, -0.34], [-0.50, 0.34], [0.50, 0.34]],
    5: [[0.0, -0.52], [-0.52, -0.18], [0.52, -0.18], [-0.34, 0.48], [0.34, 0.48]],
    6: [[-0.52, -0.34], [0.0, -0.52], [0.52, -0.34], [-0.52, 0.34], [0.0, 0.52], [0.52, 0.34]],
  };

  const base = BASE_POSITIONS[Math.min(count, 6)] ?? BASE_POSITIONS[1];

  if (count === 1) return base; // 单大陆不加扰动，保持完全一致

  // 加入 seed 派生扰动，使每个种子产生独特布局
  const PERTURB = 0.14;
  return base.map(([bx, by], i) => {
    const dx = (hash2(i * 43 + 7, seed + 1, seed) * 2 - 1) * PERTURB;
    const dy = (hash2(seed + 3, i * 19 + 11, seed) * 2 - 1) * PERTURB;
    // 将核心限制在地图内（不超出 ±0.85，避免大陆整体跑出边界）
    return [clamp(bx + dx, -0.85, 0.85), clamp(by + dy, -0.85, 0.85)];
  });
}

export function gtaHeightmap(input: Record<string, unknown>): Record<string, unknown> {
  const mask = isGrid(input.grid) ? input.grid : null;
  const width  = mask ? mask[0]?.length ?? 1 : Math.max(8, int(input, "width", 240));
  const height = mask ? mask.length          : Math.max(8, int(input, "height", 140));

  const seed           = resolveSeed(input.seed);
  const scale          = clamp(num(input, "scale", 4), 1, 16);
  const octaves        = clamp(int(input, "octaves", 5), 1, 8);
  const persistence    = clamp(num(input, "persistence", 0.5), 0.1, 0.9);
  const falloff        = clamp(num(input, "falloff", 0.55), 0, 1);
  const landRatio      = clamp(num(input, "landRatio", 0.50), 0.05, 0.80);
  const continentCount = clamp(int(input, "continentCount", 1), 1, 6);

  const centers = makeContinentCenters(continentCount, seed);

  // 大陆半径：
  //   N=1 → landRatio*1.5（单大陆行为不变）
  //   N>1 → (landRatio*1.5) / sqrt(N) * 0.90
  //     每块大陆缩小，使相邻大陆之间在基准位置上留出足够的衰减空间形成自然海峡。
  //     √N 缩放保证 N 块大陆总覆盖面积与单大陆近似相等。
  const BASE_R = landRatio * 1.5;
  const contR  = continentCount === 1 ? BASE_R : BASE_R / Math.sqrt(continentCount) * 0.90;

  // 域扭曲幅度：与 contR 成比例——大陆越小扭曲幅度越小，保持视觉比例一致
  //   AMP1（大尺度 f=0.55）：≈ 0.9 个大陆半径的位移 → 整体轮廓大幅弯折
  //   AMP2（中尺度 f=2.20）：≈ 0.4 个大陆半径的位移 → 半岛/海湾节奏
  const AMP1 = contR * 0.90;
  const AMP2 = contR * 0.40;

  const raw = makeGrid(height, width, 0);
  let min = Infinity;
  let max = -Infinity;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask && (mask[y]?.[x] ?? 0) === 0) {
        raw[y][x] = -1;
        continue;
      }

      const nx = (x / width) * scale;
      const ny = (y / height) * scale;
      const px = (x / Math.max(1, width - 1)) * 2 - 1;
      const py = (y / Math.max(1, height - 1)) * 2 - 1;

      let h = 0;

      if (continentCount === 1) {
        // ── 单大陆：与 worldmap_height 完全相同的公式 ────────────────────────
        const rawFbm = fbm(nx, ny, seed, octaves, persistence);
        const d = Math.min(1, Math.hypot(px, py) / Math.SQRT2);
        h = Math.max(0, rawFbm - falloff * smoothstep(0.25, 1.0, d));

      } else {
        // ── 多大陆：每块大陆独立生成，取最大值合并 ──────────────────────────
        //
        // 核心原则——"同一套收敛机制"：
        //   单大陆海岸线 = terrainH - falloff·f(d/R) = 0 的等值线（由噪声自然收敛）
        //   多大陆时，为每块大陆独立跑同样的公式：
        //     · 独立种子（si）→ 每块大陆地形纹理唯一
        //     · 独立双层域扭曲（ci 偏移噪声坐标）→ 每块大陆边界弯折方向不同
        //     · 独立从自身圆心衰减 → 边缘自然形成海岸
        //   final_h = max(各大陆贡献)
        //   海峡 = 所有大陆贡献均自然衰减到 ≤0 的区域，无任何 Voronoi 直线痕迹。

        for (let ci = 0; ci < centers.length; ci++) {
          const [cx, cy] = centers[ci];
          const si = (seed + ci * 99991) >>> 0;  // 每块大陆的独立种子

          // 本大陆自己的地形噪声（坐标偏移使各大陆纹理不重叠）
          const terrainH = fbm(nx + ci * 47.3, ny + ci * 31.7, si, octaves, persistence);

          // Layer 1：大尺度域扭曲（每块大陆独立弯折，ci 偏移防止同向）
          const f1 = 0.55;
          const w1x = (x / width)  * f1;
          const w1y = (y / height) * f1;
          let wpx = px + (fbm(w1x + ci * 23.7 + 41.3, w1y + 9.7,               si + 77777, 2, 0.50) - 0.5) * AMP1;
          let wpy = py + (fbm(w1y + 6.4,               w1x + ci * 17.3 + 28.1,  si + 88888, 2, 0.50) - 0.5) * AMP1;

          // Layer 2：中尺度域扭曲（半岛/海湾轮廓，叠加在 Layer 1 之上）
          const f2 = 2.20;
          const w2x = (x / width)  * f2;
          const w2y = (y / height) * f2;
          wpx += (fbm(w2x + ci * 11.1 + 19.7, w2y + 53.1,            si + 33333, 3, 0.58) - 0.5) * AMP2;
          wpy += (fbm(w2y + 37.4,               w2x + ci * 9.3 + 11.8, si + 44444, 3, 0.58) - 0.5) * AMP2;

          // 到本大陆核心的距离（扭曲坐标空间）
          const d      = Math.hypot(wpx - cx, wpy - cy);
          const localD = d / Math.max(0.001, contR);

          // 同一套收敛机制：terrainH - falloff·f(localD) 的零点即本大陆海岸线
          const contrib = Math.max(0, terrainH - falloff * smoothstep(0.18, 1.0, localD));
          if (contrib > h) h = contrib;
        }
      }

      raw[y][x] = h;
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }

  // 归一化到 0~1（掩码外为 -1）
  const span = max - min || 1;
  const heightMap: Grid = raw.map(row =>
    row.map(h => (h < 0 ? -1 : clamp((h - min) / span, 0, 1)))
  );

  // ── 初始地形类型图（-1=掩码外, 0~5=深海/浅海/沙滩/平原/丘陵/山地）────────
  const typeMap: number[][] = heightMap.map(row => row.map(h => {
    if (h < 0)                return -1;
    if (h < DEEP_SEA_MAX)    return 0;
    if (h < SHALLOW_SEA_MAX) return 1;
    if (h < BEACH_MAX)       return 2;
    if (h < PLAINS_MAX)      return 3;
    if (h < HILLS_MAX)       return 4;
    return 5;
  }));

  // ── 后处理：清除过小孤立区域（BFS 连通分量，小于阈值则并入邻接最大面积类型）
  const MIN_REGION = 6;  // 小于此像素数的连通域视为噪点
  const DIRS: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const visited = makeGrid(height, width, 0);

  for (let y0 = 0; y0 < height; y0++) {
    for (let x0 = 0; x0 < width; x0++) {
      if (visited[y0][x0] || typeMap[y0][x0] < 0) continue;

      const type = typeMap[y0][x0];
      const region: [number, number][] = [];
      const queue: [number, number][] = [[y0, x0]];
      visited[y0][x0] = 1;

      while (queue.length > 0) {
        const [ry, rx] = queue.shift()!;
        region.push([ry, rx]);
        for (const [dy, dx] of DIRS) {
          const ny = ry + dy, nx = rx + dx;
          if (ny >= 0 && ny < height && nx >= 0 && nx < width
              && !visited[ny][nx] && typeMap[ny][nx] === type) {
            visited[ny][nx] = 1;
            queue.push([ny, nx]);
          }
        }
      }

      if (region.length < MIN_REGION) {
        // 统计各邻接类型的接触边数
        const borderCount: Record<number, number> = {};
        for (const [ry, rx] of region) {
          for (const [dy, dx] of DIRS) {
            const ny = ry + dy, nx = rx + dx;
            if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
              const t = typeMap[ny][nx];
              if (t >= 0 && t !== type) {
                borderCount[t] = (borderCount[t] ?? 0) + 1;
              }
            }
          }
        }

        // 并入接触最多的邻接类型（无邻接则保持原类型）
        let best = type;
        let bestCnt = 0;
        for (const [t, cnt] of Object.entries(borderCount)) {
          if (cnt > bestCnt) { bestCnt = cnt; best = Number(t); }
        }
        for (const [ry, rx] of region) typeMap[ry][rx] = best;
      }
    }
  }

  // ── 由清洗后的 typeMap 生成六个地形掩码 ───────────────────────────────────
  const deepSeaGrid    = makeGrid(height, width, 0);
  const shallowSeaGrid = makeGrid(height, width, 0);
  const beachGrid      = makeGrid(height, width, 0);
  const plainsGrid     = makeGrid(height, width, 0);
  const hillsGrid      = makeGrid(height, width, 0);
  const mountainGrid   = makeGrid(height, width, 0);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      switch (typeMap[y][x]) {
        case 0: deepSeaGrid[y][x]    = 1; break;
        case 1: shallowSeaGrid[y][x] = 1; break;
        case 2: beachGrid[y][x]      = 1; break;
        case 3: plainsGrid[y][x]     = 1; break;
        case 4: hillsGrid[y][x]      = 1; break;
        case 5: mountainGrid[y][x]   = 1; break;
      }
    }
  }

  return {
    heightMap,
    deepSeaGrid,
    shallowSeaGrid,
    beachGrid,
    plainsGrid,
    hillsGrid,
    mountainGrid,
  };
}
