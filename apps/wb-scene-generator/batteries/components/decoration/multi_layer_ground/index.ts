/**
 * multi_layer_grass: 多层地面生成
 * 原版管线内置：perlin_noise → grid_binarize → grid_mask_apply → 后处理过滤小碎片
 *
 * DataTree 数据格式：输入 inputGrid 与输出 outputGrid 均为 grid/access:item——
 * 本算子每次只处理单张网格，网格列表由引擎按 DataTree 自动逐张 fanout / 重组。
 *
 * 输入：inputGrid (grid) — 单张基准网格;
 *       layerCount (number) — 草地层数; threshold (number) — 二值化阈值(0~1);
 *       frequency (number) — 噪声频率; octaves (number) — 分形倍频;
 *       seed (number) — 随机种子
 * 输出：outputGrid (grid) — 单张多值网格（每层一个递增 id，从 max+1 起；重叠处取较高层）;
 *       nameList (array) — [{id, name, type:"tile"}]
 */

type Grid = number[][];
type NameEntry = { id: number; name: string; type: string };

// ── FastNoiseLite Perlin（完整复制自 perlin_noise 电池）────────────────────

// prettier-ignore
const GRADIENTS_2D = [
  0.130526192220052, 0.99144486137381, 0.38268343236509, 0.923879532511287, 0.608761429008721, 0.793353340291235, 0.793353340291235, 0.608761429008721,
  0.923879532511287, 0.38268343236509, 0.99144486137381, 0.130526192220051, 0.99144486137381, -0.130526192220051, 0.923879532511287, -0.38268343236509,
  0.793353340291235, -0.60876142900872, 0.608761429008721, -0.793353340291235, 0.38268343236509, -0.923879532511287, 0.130526192220052, -0.99144486137381,
  -0.130526192220052, -0.99144486137381, -0.38268343236509, -0.923879532511287, -0.608761429008721, -0.793353340291235, -0.793353340291235, -0.608761429008721,
  -0.923879532511287, -0.38268343236509, -0.99144486137381, -0.130526192220052, -0.99144486137381, 0.130526192220051, -0.923879532511287, 0.38268343236509,
  -0.793353340291235, 0.608761429008721, -0.608761429008721, 0.793353340291235, -0.38268343236509, 0.923879532511287, -0.130526192220052, 0.99144486137381,
  0.130526192220052, 0.99144486137381, 0.38268343236509, 0.923879532511287, 0.608761429008721, 0.793353340291235, 0.793353340291235, 0.608761429008721,
  0.923879532511287, 0.38268343236509, 0.99144486137381, 0.130526192220051, 0.99144486137381, -0.130526192220051, 0.923879532511287, -0.38268343236509,
  0.793353340291235, -0.60876142900872, 0.608761429008721, -0.793353340291235, 0.38268343236509, -0.923879532511287, 0.130526192220052, -0.99144486137381,
  -0.130526192220052, -0.99144486137381, -0.38268343236509, -0.923879532511287, -0.608761429008721, -0.793353340291235, -0.793353340291235, -0.608761429008721,
  -0.923879532511287, -0.38268343236509, -0.99144486137381, -0.130526192220052, -0.99144486137381, 0.130526192220051, -0.923879532511287, 0.38268343236509,
  -0.793353340291235, 0.608761429008721, -0.608761429008721, 0.793353340291235, -0.38268343236509, 0.923879532511287, -0.130526192220052, 0.99144486137381,
  0.130526192220052, 0.99144486137381, 0.38268343236509, 0.923879532511287, 0.608761429008721, 0.793353340291235, 0.793353340291235, 0.608761429008721,
  0.923879532511287, 0.38268343236509, 0.99144486137381, 0.130526192220051, 0.99144486137381, -0.130526192220051, 0.923879532511287, -0.38268343236509,
  0.793353340291235, -0.60876142900872, 0.608761429008721, -0.793353340291235, 0.38268343236509, -0.923879532511287, 0.130526192220052, -0.99144486137381,
  -0.130526192220052, -0.99144486137381, -0.38268343236509, -0.923879532511287, -0.608761429008721, -0.793353340291235, -0.793353340291235, -0.608761429008721,
  -0.923879532511287, -0.38268343236509, -0.99144486137381, -0.130526192220052, -0.99144486137381, 0.130526192220051, -0.923879532511287, 0.38268343236509,
  -0.793353340291235, 0.608761429008721, -0.608761429008721, 0.793353340291235, -0.38268343236509, 0.923879532511287, -0.130526192220052, 0.99144486137381,
  0.130526192220052, 0.99144486137381, 0.38268343236509, 0.923879532511287, 0.608761429008721, 0.793353340291235, 0.793353340291235, 0.608761429008721,
  0.923879532511287, 0.38268343236509, 0.99144486137381, 0.130526192220051, 0.99144486137381, -0.130526192220051, 0.923879532511287, -0.38268343236509,
  0.793353340291235, -0.60876142900872, 0.608761429008721, -0.793353340291235, 0.38268343236509, -0.923879532511287, 0.130526192220052, -0.99144486137381,
  -0.130526192220052, -0.99144486137381, -0.38268343236509, -0.923879532511287, -0.608761429008721, -0.793353340291235, -0.793353340291235, -0.608761429008721,
  -0.923879532511287, -0.38268343236509, -0.99144486137381, -0.130526192220052, -0.99144486137381, 0.130526192220051, -0.923879532511287, 0.38268343236509,
  -0.793353340291235, 0.608761429008721, -0.608761429008721, 0.793353340291235, -0.38268343236509, 0.923879532511287, -0.130526192220052, 0.99144486137381,
  0.130526192220052, 0.99144486137381, 0.38268343236509, 0.923879532511287, 0.608761429008721, 0.793353340291235, 0.793353340291235, 0.608761429008721,
  0.923879532511287, 0.38268343236509, 0.99144486137381, 0.130526192220051, 0.99144486137381, -0.130526192220051, 0.923879532511287, -0.38268343236509,
  0.793353340291235, -0.60876142900872, 0.608761429008721, -0.793353340291235, 0.38268343236509, -0.923879532511287, 0.130526192220052, -0.99144486137381,
  -0.130526192220052, -0.99144486137381, -0.38268343236509, -0.923879532511287, -0.608761429008721, -0.793353340291235, -0.793353340291235, -0.608761429008721,
  -0.923879532511287, -0.38268343236509, -0.99144486137381, -0.130526192220052, -0.99144486137381, 0.130526192220051, -0.923879532511287, 0.38268343236509,
  -0.793353340291235, 0.608761429008721, -0.608761429008721, 0.793353340291235, -0.38268343236509, 0.923879532511287, -0.130526192220052, 0.99144486137381,
  0.38268343236509, 0.923879532511287, 0.923879532511287, 0.38268343236509, 0.923879532511287, -0.38268343236509, 0.38268343236509, -0.923879532511287,
  -0.38268343236509, -0.923879532511287, -0.923879532511287, -0.38268343236509, -0.923879532511287, 0.38268343236509, -0.38268343236509, 0.923879532511287,
];

const PRIME_X = 501125321;
const PRIME_Y = 1136930381;

function hashR2(seed: number, xPrimed: number, yPrimed: number): number {
  let h = seed ^ xPrimed ^ yPrimed;
  h = Math.imul(h, 0x27d4eb2d);
  return h;
}

function gradCoordR2(seed: number, xPrimed: number, yPrimed: number, xd: number, yd: number): number {
  let h = hashR2(seed, xPrimed, yPrimed);
  h ^= h >> 15;
  h &= 127 << 1;
  return xd * GRADIENTS_2D[h]! + yd * GRADIENTS_2D[h | 1]!;
}

function interpQuintic(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

function singlePerlinR2(seed: number, x: number, y: number): number {
  let x0 = Math.floor(x);
  let y0 = Math.floor(y);
  const xd0 = x - x0;
  const yd0 = y - y0;
  const xd1 = xd0 - 1;
  const yd1 = yd0 - 1;
  const xs = interpQuintic(xd0);
  const ys = interpQuintic(yd0);
  x0 = Math.imul(x0, PRIME_X);
  y0 = Math.imul(y0, PRIME_Y);
  const x1 = x0 + PRIME_X;
  const y1 = y0 + PRIME_Y;
  const xf0 = lerp(gradCoordR2(seed, x0, y0, xd0, yd0), gradCoordR2(seed, x1, y0, xd1, yd0), xs);
  const xf1 = lerp(gradCoordR2(seed, x0, y1, xd0, yd1), gradCoordR2(seed, x1, y1, xd1, yd1), xs);
  return lerp(xf0, xf1, ys) * 1.4247691104677813;
}

function calcFractalBounding(octaves: number, gain: number): number {
  let g = Math.abs(gain);
  let amp = g;
  let ampFractal = 1.0;
  for (let i = 1; i < octaves; i++) {
    ampFractal += amp;
    amp *= g;
  }
  return 1 / ampFractal;
}

function fractalFBm(seed: number, x: number, y: number, octaves: number, lacunarity: number, gain: number, bounding: number): number {
  let s = seed;
  let sum = 0;
  let amp = bounding;
  let cx = x;
  let cy = y;
  for (let i = 0; i < octaves; i++) {
    const noise = singlePerlinR2(s++, cx, cy);
    sum += noise * amp;
    amp *= lerp(1.0, Math.min(noise + 1, 2) * 0.5, 0.0);
    cx *= lacunarity;
    cy *= lacunarity;
    amp *= gain;
  }
  return sum;
}

// 完整复制自 perlin_noise 电池
function generatePerlinGrid(w: number, h: number, seed: number, frequency: number, octaves: number): Grid {
  const lacunarity = 2.0;
  const gain = 0.5;
  const bounding = calcFractalBounding(octaves, gain);
  const intSeed = Math.floor(seed);
  const grid: Grid = Array.from({ length: h }, () => new Array(w).fill(0));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const raw = fractalFBm(intSeed, x * frequency, y * frequency, octaves, lacunarity, gain, bounding);
      grid[y][x] = raw * 0.5 + 0.5;
    }
  }
  return grid;
}

// 完整复制自 grid_binarize 电池
function binarizeGrid(src: Grid, threshold: number): Grid {
  const h = src.length;
  const w = src[0].length;
  return Array.from({ length: h }, (_, y) => {
    const row = src[y];
    const out = new Array<number>(w);
    for (let x = 0; x < w; x++) {
      out[x] = row[x] > threshold ? 1 : 0;
    }
    return out;
  });
}

// 完整复制自 grid_mask_apply 电池（grid 全填 fillValue，mask=1 保留，mask=0 变 0）
function applyMask(fillValue: number, mask: Grid): Grid {
  const h = mask.length;
  const w = mask[0].length;
  return Array.from({ length: h }, (_, y) => {
    const maskRow = mask[y];
    const out = new Array<number>(w);
    for (let x = 0; x < w; x++) {
      out[x] = maskRow[x] === 1 ? fillValue : 0;
    }
    return out;
  });
}

// ── 后处理：BFS 洪泛标记连通区域，过滤面积小于 minArea 的碎片 ──────────

function filterSmallRegions(grid: Grid, fillValue: number, minArea: number): Grid {
  const h = grid.length;
  const w = grid[0].length;
  const visited = Array.from({ length: h }, () => new Uint8Array(w));
  const result: Grid = Array.from({ length: h }, (_, y) => [...grid[y]]);
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  for (let sy = 0; sy < h; sy++) {
    for (let sx = 0; sx < w; sx++) {
      if (visited[sy][sx] || grid[sy][sx] !== fillValue) continue;

      // BFS 找出当前连通区域的所有格子
      const cells: [number, number][] = [];
      const queue: [number, number][] = [[sy, sx]];
      visited[sy][sx] = 1;
      while (queue.length > 0) {
        const [r, c] = queue.shift()!;
        cells.push([r, c]);
        for (const [dr, dc] of dirs) {
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < h && nc >= 0 && nc < w && !visited[nr][nc] && grid[nr][nc] === fillValue) {
            visited[nr][nc] = 1;
            queue.push([nr, nc]);
          }
        }
      }

      // 面积不足则清除
      if (cells.length < minArea) {
        for (const [r, c] of cells) {
          result[r][c] = 0;
        }
      }
    }
  }
  return result;
}

// ── 工具函数 ──────────────────────────────────────────────────────────────

function gridMax(grid: Grid): number {
  let max = 0;
  for (const row of grid) for (const v of row) if (v > max) max = v;
  return max;
}

/** 解析单张二维网格（number[][]）；非法返回 null。
 * DataTree 模型下引擎按 access:item 对网格列表自动 fanout，本算子每次只收到一张网格。 */
function parseGrid(raw: unknown): Grid | null {
  if (!raw || !Array.isArray(raw) || raw.length === 0) return null;
  if (Array.isArray(raw[0]) && typeof (raw[0] as unknown[])[0] === "number") {
    return raw as Grid;
  }
  return null;
}

// ===== 主导出函数 =====

export function multiLayerGrass(input: Record<string, unknown>): Record<string, unknown> {
  const baseGrid = parseGrid(input.inputGrid);
  if (!baseGrid) return { error: "inputGrid is required" };
  if (baseGrid.length === 0 || baseGrid[0].length === 0) return { error: "inputGrid is empty" };

  const layerCount = typeof input.layerCount === "number" ? Math.max(1, Math.round(input.layerCount)) : 4;
  const threshold = typeof input.threshold === "number" ? Math.min(1, Math.max(0, input.threshold)) : 0.6;
  const frequency = typeof input.frequency === "number" ? Math.max(0.001, input.frequency) : 0.02;
  const octaves = typeof input.octaves === "number" ? Math.max(1, Math.min(8, Math.round(input.octaves))) : 5;
  const rawSeed = typeof input.seed === "number" ? input.seed : 0;
  const baseSeed = rawSeed === 0 ? (Date.now() & 0x7fffffff) : rawSeed;

  const layerNames = [
    "浅色土地", "深色土地", "斑驳地面", "苔藓地面", "荒草土地", "枯草地面", "杂草土地", "野草地面",
    "砂砾土地", "泥泞地面", "碎石土地", "腐叶地面", "干裂土地", "湿润地面", "沙质土地", "板结地面",
  ];

  const rows = baseGrid.length;
  const cols = baseGrid[0].length;
  const totalPixels = rows * cols;
  const minArea = Math.max(1, Math.floor(totalPixels / 200));

  // targetValue 自动从基准网格推断最大值
  const targetValue = gridMax(baseGrid);
  const baseLayerId = targetValue + 1;

  // 单张多值网格：每层一个递增 id，重叠处取较高层（后层覆盖前层）
  const outputGrid: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const nameList: NameEntry[] = [];

  for (let i = 0; i < layerCount; i++) {
    const fillValue = baseLayerId + i;
    const layerSeed = baseSeed + i * 999983;

    // Step 1: perlin_noise
    const noiseGrid = generatePerlinGrid(cols, rows, layerSeed, frequency, octaves);
    // Step 2: grid_binarize
    const binarized = binarizeGrid(noiseGrid, threshold);
    // Step 3: grid_mask_apply（只在目标区域内生效：基准网格值 === targetValue 才允许写入）
    let layer: Grid = Array.from({ length: rows }, (_, r) => {
      const out = new Array<number>(cols);
      for (let c = 0; c < cols; c++) {
        out[c] = (baseGrid[r][c] === targetValue && binarized[r][c] === 1) ? fillValue : 0;
      }
      return out;
    });
    // Step 4: 后处理——过滤面积 < totalPixels/200 的碎片连通区域
    layer = filterSmallRegions(layer, fillValue, minArea);

    // 合并到多值网格：较高层覆盖较低层
    let hasAny = false;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (layer[r][c] === fillValue) { outputGrid[r][c] = fillValue; hasAny = true; }
      }
    }

    if (hasAny) {
      nameList.push({ id: fillValue, name: layerNames[Math.floor(Math.random() * layerNames.length)]!, type: 'tile' });
    }
  }

  return { outputGrid, nameList };
}
