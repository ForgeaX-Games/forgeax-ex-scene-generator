/**
 * indoor_texture: 根据单张楼层掩码网格生成室内纹理分布（普通/青苔/裂纹/木/石板地板）
 *
 * DataTree 数据格式：输入 inputGrid 与输出 outputGrid 均为 grid/access:item——
 * 本算子每次只处理单张网格，网格列表由引擎按 DataTree 自动逐张 fanout / 重组。
 *
 * 输入：inputGrid (grid) — 单张楼层掩码网格; algorithm (string) — 算法类型; seed (number) — 随机种子
 * 输出：outputGrid (grid) — 单张多值纹理网格（每格为纹理 id 1～5 或 0）;
 *       nameList (array) — 实际出现的纹理条目 [{id, name, type:"tile"}]
 */

type Grid = number[][];

const TEXTURE_COUNT = 5; // 1=普通地板, 2=青苔地板, 3=裂纹地板, 4=木地板, 5=石板地板

// Linear Congruential Generator for deterministic randomness
function makeLCG(seed: number): () => number {
  let s = ((seed === 0 ? Date.now() : seed) & 0xffffffff) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967295;
  };
}

// Selects a texture type (1..N) from a weight array via weighted random.
// An optional additive noise on the random value biases toward later types.
function weightedSelect(weights: number[], rng: () => number, noise = 0): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let rv = rng() + noise;
  let cumulative = 0;
  for (let k = 0; k < weights.length; k++) {
    cumulative += weights[k] / total;
    if (rv <= cumulative) return k + 1;
  }
  return weights.length; // noise pushed rv > 1, fall through to last type
}

// --- Algorithm 1: Nature ---
// Positional hash noise + edge/corner distance decay.
// 青苔/裂纹 boosted near edges and corners; 木地板 mild edge boost; 石板地板 mild corner boost.
function generateByNoiseAndDistance(grid: Grid, rng: () => number): Grid {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const output: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const noiseScale = 0.1;
  const edgeDecayDist = 3;
  const cornerDecayDist = 2;

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      if (grid[i][j] === 0) continue;

      const hashNoise = (((i * 31337 + j * 1337 + 17) % 1000) + 1000) % 1000;
      const noise = (hashNoise / 1000) * noiseScale;

      const edgeDist = Math.min(i, j, rows - 1 - i, cols - 1 - j);
      const cornerDist = Math.min(
        Math.sqrt(i * i + j * j),
        Math.sqrt(i * i + (cols - 1 - j) ** 2),
        Math.sqrt((rows - 1 - i) ** 2 + j * j),
        Math.sqrt((rows - 1 - i) ** 2 + (cols - 1 - j) ** 2),
      );

      const edgeFactor = edgeDist < edgeDecayDist ? Math.max(0, 1 - edgeDist / edgeDecayDist) : 0;
      const cornerFactor = cornerDist < cornerDecayDist ? Math.max(0, 1 - cornerDist / cornerDecayDist) : 0;
      const specialBoost = edgeFactor * 0.3 + cornerFactor * 0.5;

      const base = 1 / TEXTURE_COUNT;
      const weights = [
        base,                              // 1=普通地板（无加成）
        base * (1 + specialBoost),         // 2=青苔地板（边角强加成）
        base * (1 + specialBoost),         // 3=裂纹地板（边角强加成）
        base * (1 + edgeFactor * 0.2),    // 4=木地板（边缘轻微加成）
        base * (1 + cornerFactor * 0.3),  // 5=石板地板（角落轻微加成）
      ];

      output[i][j] = weightedSelect(weights, rng, noise);
    }
  }

  return output;
}

// --- Algorithm 2: Water ---
// Assigns textures based on simulated moisture (edge-biased) and light (center-biased) values.
// Each texture type has a preferred [moisture, light] target; closer = higher score.
function generateMoistureMap(rows: number, cols: number, grid: Grid, rng: () => number): number[][] {
  const maxDist = Math.max(rows, cols) / 2;
  return Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (__, j) => {
      if (grid[i][j] === 0) return 0;
      const edgeDist = Math.min(i, j, rows - 1 - i, cols - 1 - j);
      return maxDist > 0
        ? Math.max(0, 1 - edgeDist / maxDist) * 0.5 + rng() * 0.3
        : rng() * 0.8;
    }),
  );
}

function generateLightMap(rows: number, cols: number, grid: Grid, rng: () => number): number[][] {
  const ci = rows / 2;
  const cj = cols / 2;
  const maxDist = Math.sqrt(rows ** 2 + cols ** 2) / 2;
  return Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (__, j) => {
      if (grid[i][j] === 0) return 0;
      const dist = Math.sqrt((i - ci) ** 2 + (j - cj) ** 2);
      return maxDist > 0
        ? Math.max(0, 1 - dist / maxDist) * 0.7 + rng() * 0.3
        : rng();
    }),
  );
}

function generateByEnvironment(grid: Grid, rng: () => number): Grid {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const output: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));

  const moisture = generateMoistureMap(rows, cols, grid, rng);
  const light = generateLightMap(rows, cols, grid, rng);

  // [moisture target, light target] for each texture type (index 0 → value 1)
  const prefs = [
    { m: 0.3, l: 0.5 }, // 普通地板（适中）
    { m: 0.8, l: 0.3 }, // 青苔地板（潮湿+暗）
    { m: 0.2, l: 0.7 }, // 裂纹地板（干燥+亮）
    { m: 0.5, l: 0.8 }, // 木地板（适中湿度+明亮）
    { m: 0.1, l: 0.2 }, // 石板地板（极干+偏暗）
  ];

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      if (grid[i][j] === 0) continue;
      const m = moisture[i][j];
      const l = light[i][j];
      const scores = prefs.map(p => ((1 - Math.abs(m - p.m)) + (1 - Math.abs(l - p.l))) / 2);
      const total = scores.reduce((a, b) => a + b, 0);
      if (total > 0) {
        let rv = rng() * total;
        let selected = 0;
        for (let k = 0; k < scores.length; k++) {
          rv -= scores[k];
          if (rv <= 0) { selected = k; break; }
        }
        output[i][j] = selected + 1;
      } else {
        output[i][j] = Math.floor(rng() * TEXTURE_COUNT) + 1;
      }
    }
  }

  return output;
}

// --- Algorithm 3: Smooth ---
// Divides the mask into coarser clusters, assigns each cluster a texture type,
// then adds smooth blending at cluster boundaries via transition probability.
function generateByClustering(grid: Grid, rng: () => number): Grid {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const output: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));

  const clusterSize = 5;
  const transitionProb = 0.3;
  const gRows = Math.ceil(rows / clusterSize);
  const gCols = Math.ceil(cols / clusterSize);

  const clusterTexture: number[][] = Array.from({ length: gRows }, () =>
    Array.from({ length: gCols }, () => Math.floor(rng() * TEXTURE_COUNT) + 1),
  );

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      if (grid[i][j] === 0) continue;
      const gi = Math.floor(i / clusterSize);
      const gj = Math.floor(j / clusterSize);
      const iMod = i % clusterSize;
      const jMod = j % clusterSize;
      const isBoundary = iMod < 2 || iMod >= clusterSize - 2 || jMod < 2 || jMod >= clusterSize - 2;

      if (isBoundary && rng() < transitionProb) {
        const neighbors = (
          [
            [gi - 1, gj],
            [gi + 1, gj],
            [gi, gj - 1],
            [gi, gj + 1],
          ] as [number, number][]
        ).filter(([ni, nj]) => ni >= 0 && ni < gRows && nj >= 0 && nj < gCols);
        if (neighbors.length > 0) {
          const [ni, nj] = neighbors[Math.floor(rng() * neighbors.length)];
          output[i][j] = clusterTexture[ni][nj];
        } else {
          output[i][j] = clusterTexture[gi][gj];
        }
      } else {
        output[i][j] = clusterTexture[gi][gj];
      }
    }
  }

  return output;
}

// --- Algorithm 4: Mixed ---
// Hybrid: cluster-based foundation → 30% environment blend → edge/corner preference pass.
function generateHybrid(grid: Grid, rng: () => number): Grid {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;

  const base = generateByClustering(grid, rng);
  const env = generateByEnvironment(grid, rng);

  // 30% environment blend
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      if (grid[i][j] !== 0 && rng() < 0.3) base[i][j] = env[i][j];
    }
  }

  // Edge/corner preference: corners lean toward 青苔/石板, edges lean toward all special textures
  const cornerTypes = [2, 5]; // 青苔地板、石板地板偏好出现在角落
  const edgeTypes = [2, 3, 4, 5]; // 边缘偏好任意特殊纹理
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      if (grid[i][j] === 0) continue;
      const edgeDist = Math.min(i, j, rows - 1 - i, cols - 1 - j);
      const isCorner =
        (i < 3 && j < 3) ||
        (i < 3 && j >= cols - 3) ||
        (i >= rows - 3 && j < 3) ||
        (i >= rows - 3 && j >= cols - 3);

      if (isCorner && rng() < 0.6) {
        if (rng() < 0.6) base[i][j] = cornerTypes[Math.floor(rng() * cornerTypes.length)];
      } else if (edgeDist < 3 && rng() < 0.4) {
        base[i][j] = edgeTypes[Math.floor(rng() * edgeTypes.length)];
      }
    }
  }

  return base;
}

function processOneGrid(grid: Grid, algorithm: string, effectiveSeed: number): Grid {
  const rng = makeLCG(effectiveSeed);
  switch (algorithm) {
    case "water":  return generateByEnvironment(grid, rng);
    case "smooth": return generateByClustering(grid, rng);
    case "mixed":  return generateHybrid(grid, rng);
    default:       return generateByNoiseAndDistance(grid, rng);
  }
}

/** 纹理种类固定表：id 与名称对应关系。 */
const TEXTURE_NAMES: { id: number; name: string }[] = [
  { id: 1, name: "普通地板" },
  { id: 2, name: "青苔地板" },
  { id: 3, name: "裂纹地板" },
  { id: 4, name: "木地板"   },
  { id: 5, name: "石板地板" },
];

/** 解析单张二维网格（number[][]）；非法返回 null。
 * DataTree 模型下引擎按 access:item 对网格列表自动 fanout，本算子每次只收到一张网格。 */
function parseGrid(raw: unknown): Grid | null {
  if (!raw || !Array.isArray(raw) || raw.length === 0) return null;
  if (Array.isArray(raw[0]) && typeof (raw[0] as unknown[])[0] === "number") {
    return raw as Grid;
  }
  return null;
}

export function indoorTexture(input: Record<string, unknown>): Record<string, unknown> {
  const grid = parseGrid(input.inputGrid);
  if (!grid) return { error: "inputGrid is required" };
  if (grid.length === 0 || !grid[0] || grid[0].length === 0) return { error: "inputGrid is empty" };

  const algorithm = typeof input.algorithm === "string" ? input.algorithm : "nature";
  const seed = typeof input.seed === "number" ? Math.floor(input.seed) : 0;
  const baseSeed = seed === 0 ? Date.now() : seed;

  // 单张多值纹理网格（每格为纹理 id 1～5 或 0）
  const outputGrid = processOneGrid(grid, algorithm, baseSeed);

  // 仅输出实际出现的纹理条目，按 id 1→5 有序
  const present = new Set<number>();
  for (const row of outputGrid) for (const v of row) if (v !== 0) present.add(v);

  const nameList: { id: number; name: string; type: string }[] = [];
  for (let tid = 1; tid <= TEXTURE_COUNT; tid++) {
    if (!present.has(tid)) continue;
    const meta = TEXTURE_NAMES.find(t => t.id === tid);
    nameList.push({ id: tid, name: meta?.name ?? `类型${tid}`, type: "tile" });
  }

  return { outputGrid, nameList };
}
