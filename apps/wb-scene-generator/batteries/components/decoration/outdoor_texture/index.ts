/**
 * outdoor_texture: 根据单张掩码网格和温度/湿度参数，使用 Whittaker 双参数生物群系模型 + 多层噪声
 * 生成室外地面纹理分布（草地/泥土/碎石/沙地/湿草/落叶/苔藓/雪地）
 *
 * DataTree 数据格式：输入 inputGrid 与输出 outputGrid 均为 grid/access:item——
 * 本算子每次只处理单张网格，网格列表由引擎按 DataTree 自动逐张 fanout / 重组。
 *
 * 输入：inputGrid (grid) — 单张掩码网格; temperature (number) — 温度偏置(0-1);
 *       moisture (number) — 湿度偏置(0-1); seed (number) — 随机种子
 * 输出：outputGrid (grid) — 单张多值生物群系网格（每格为纹理 id 1～8 或 0）;
 *       nameList (array) — 实际出现的纹理条目 [{id, name, type:"tile"}]
 */

type Grid = number[][];

// ═══════════════════════════════════════════════════════════
//  RNG — 线性同余伪随机数发生器
// ═══════════════════════════════════════════════════════════

function makeLCG(seed: number): () => number {
  let s = (seed & 0xffffffff) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967295;
  };
}

// ═══════════════════════════════════════════════════════════
//  Noise — 基于哈希的值噪声 + 分形布朗运动
// ═══════════════════════════════════════════════════════════

function hash2d(x: number, y: number, seed: number): number {
  let h = (seed + Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return ((h & 0x7fffffff) >>> 0) / 0x7fffffff;
}

function smootherstep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smootherstep(x - ix);
  const fy = smootherstep(y - iy);
  const v00 = hash2d(ix, iy, seed);
  const v10 = hash2d(ix + 1, iy, seed);
  const v01 = hash2d(ix, iy + 1, seed);
  const v11 = hash2d(ix + 1, iy + 1, seed);
  return (v00 * (1 - fx) + v10 * fx) * (1 - fy) +
         (v01 * (1 - fx) + v11 * fx) * fy;
}

function fbm(x: number, y: number, octaves: number, lacunarity: number, gain: number, seed: number): number {
  let value = 0, amplitude = 1, frequency = 1, maxVal = 0;
  for (let i = 0; i < octaves; i++) {
    value += amplitude * valueNoise(x * frequency, y * frequency, seed + i * 31337);
    maxVal += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return value / maxVal;
}

// ═══════════════════════════════════════════════════════════
//  Whittaker 生物群系定义
//  tc/mc = 该群系在温度/湿度空间中的中心点
//  spread = 高斯分布标准差（越大越宽容，越容易被选中）
//  edgeBias = 正值偏好掩码边缘，负值偏好内部
//  elevBias = 正值偏好高地伪海拔，负值偏好低洼
// ═══════════════════════════════════════════════════════════

interface BiomeDef {
  id: number;
  name: string;
  tc: number;
  mc: number;
  spread: number;
  edgeBias: number;
  elevBias: number;
}

const BIOMES: BiomeDef[] = [
  { id: 1, name: "草地", tc: 0.50, mc: 0.55, spread: 0.25, edgeBias: 0,    elevBias: 0    },
  { id: 2, name: "泥土", tc: 0.62, mc: 0.28, spread: 0.22, edgeBias: 0.30, elevBias: -0.1 },
  { id: 3, name: "碎石", tc: 0.35, mc: 0.15, spread: 0.20, edgeBias: 0.40, elevBias: 0.5  },
  { id: 4, name: "沙地", tc: 0.82, mc: 0.12, spread: 0.20, edgeBias: 0.20, elevBias: -0.2 },
  { id: 5, name: "湿草", tc: 0.42, mc: 0.78, spread: 0.22, edgeBias: -0.2, elevBias: -0.3 },
  { id: 6, name: "落叶", tc: 0.30, mc: 0.48, spread: 0.22, edgeBias: 0.10, elevBias: 0.1  },
  { id: 7, name: "苔藓", tc: 0.18, mc: 0.88, spread: 0.18, edgeBias: 0.30, elevBias: -0.2 },
  { id: 8, name: "雪地", tc: 0.08, mc: 0.45, spread: 0.20, edgeBias: 0,    elevBias: 0.6  },
];

// ═══════════════════════════════════════════════════════════
//  边缘距离场 — BFS 计算掩码内每个格子到最近边界的距离
// ═══════════════════════════════════════════════════════════

const DIR4: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];

function computeEdgeDistMap(grid: Grid): number[][] {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const dist: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(-1));
  const queue: [number, number][] = [];

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      if (grid[i][j] === 0) continue;
      let border = false;
      for (const [di, dj] of DIR4) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || ni >= rows || nj < 0 || nj >= cols || grid[ni][nj] === 0) {
          border = true;
          break;
        }
      }
      if (border) {
        dist[i][j] = 0;
        queue.push([i, j]);
      }
    }
  }

  let head = 0;
  while (head < queue.length) {
    const [ci, cj] = queue[head++];
    for (const [di, dj] of DIR4) {
      const ni = ci + di, nj = cj + dj;
      if (ni >= 0 && ni < rows && nj >= 0 && nj < cols &&
          grid[ni][nj] !== 0 && dist[ni][nj] === -1) {
        dist[ni][nj] = dist[ci][cj] + 1;
        queue.push([ni, nj]);
      }
    }
  }

  return dist;
}

// ═══════════════════════════════════════════════════════════
//  Whittaker 生物群系分类 — 单网格处理核心
// ═══════════════════════════════════════════════════════════

function processOneGrid(grid: Grid, temperature: number, moisture: number, seed: number): Grid {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  if (rows === 0 || cols === 0) return [];

  const output: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const rng = makeLCG(seed);

  const scale = Math.max(rows, cols);
  const noiseFreq = 8.0 / scale;

  const tempSeed   = seed;
  const moistSeed  = seed + 777773;
  const elevSeed   = seed + 555557;
  const detailSeed = seed + 333331;
  const warpSeed   = seed + 111113;

  const edgeDist = computeEdgeDistMap(grid);
  let maxEdgeDist = 1;
  for (const row of edgeDist) for (const d of row) if (d > maxEdgeDist) maxEdgeDist = d;

  // 边缘影响衰减半径：取 maxEdgeDist 的 30%
  const edgeDecayRadius = Math.max(1, maxEdgeDist * 0.3);

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      if (grid[i][j] === 0) continue;

      const nx = j * noiseFreq;
      const ny = i * noiseFreq;

      // 域扭曲：用低频噪声扭曲采样坐标，产生有机形状
      const warpAmount = 3.0;
      const warpX = (fbm(nx * 0.5, ny * 0.5, 2, 2.0, 0.5, warpSeed) - 0.5) * warpAmount;
      const warpY = (fbm(nx * 0.5 + 5.2, ny * 0.5 + 1.3, 2, 2.0, 0.5, warpSeed) - 0.5) * warpAmount;
      const wnx = nx + warpX;
      const wny = ny + warpY;

      // 多层噪声采样（基于扭曲后坐标）
      const tempNoise  = fbm(wnx, wny, 4, 2.0, 0.50, tempSeed);
      const moistNoise = fbm(wnx * 1.3 + 3.7, wny * 1.3 + 2.1, 4, 2.0, 0.50, moistSeed);
      const elevNoise  = fbm(wnx * 0.6, wny * 0.6, 3, 2.0, 0.45, elevSeed);
      const detailNoise = fbm(nx * 3.0, ny * 3.0, 2, 2.0, 0.50, detailSeed);

      // 混合用户全局偏置与局部噪声变化
      const variationScale = 0.45;
      const localTemp  = clamp01(temperature + (tempNoise - 0.5) * variationScale * 2);
      const localMoist = clamp01(moisture + (moistNoise - 0.5) * variationScale * 2);
      const elevation  = elevNoise;

      // 边缘因子：0=边缘，1=深处内部
      const eDist = edgeDist[i][j];
      const edgeFactor = eDist >= 0 ? Math.min(1, eDist / edgeDecayRadius) : 0;

      // 为每个生物群系计算适应度得分
      const scores = new Array<number>(BIOMES.length);
      for (let b = 0; b < BIOMES.length; b++) {
        const biome = BIOMES[b];

        // 高斯距离核：离群系中心越近分数越高
        const dt = (localTemp - biome.tc) / biome.spread;
        const dm = (localMoist - biome.mc) / biome.spread;
        let fitness = Math.exp(-0.5 * (dt * dt + dm * dm));

        // 边缘偏好修正
        if (biome.edgeBias > 0) {
          fitness *= 1 + biome.edgeBias * (1 - edgeFactor);
        } else if (biome.edgeBias < 0) {
          fitness *= 1 + Math.abs(biome.edgeBias) * edgeFactor;
        }

        // 海拔偏好修正
        if (biome.elevBias > 0) {
          fitness *= 1 + biome.elevBias * elevation;
        } else if (biome.elevBias < 0) {
          fitness *= 1 + Math.abs(biome.elevBias) * (1 - elevation);
        }

        // 高频细节噪声引入微观随机性
        fitness *= 0.8 + detailNoise * 0.4;

        scores[b] = Math.max(0, fitness);
      }

      // 加权随机选择
      const total = scores.reduce((a, b) => a + b, 0);
      if (total <= 0) { output[i][j] = 1; continue; }

      let rv = rng() * total;
      let selected = 0;
      for (let b = 0; b < scores.length; b++) {
        rv -= scores[b];
        if (rv <= 0) { selected = b; break; }
      }
      output[i][j] = BIOMES[selected].id;
    }
  }

  // 后处理：邻域一致性平滑 + 生态过渡修正
  smoothPass(output, grid, rng);
  smoothPass(output, grid, rng);
  transitionPass(output, grid);

  return output;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ═══════════════════════════════════════════════════════════
//  后处理 — 邻域一致性平滑
//  孤立格（少于 2 个同类邻居）有概率被周围多数群系吞并
// ═══════════════════════════════════════════════════════════

function smoothPass(output: Grid, mask: Grid, rng: () => number): void {
  const rows = output.length;
  const cols = output[0]?.length ?? 0;
  const snapshot = output.map(row => [...row]);

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      if (mask[i][j] === 0) continue;

      const freq = new Map<number, number>();
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          if (di === 0 && dj === 0) continue;
          const ni = i + di, nj = j + dj;
          if (ni >= 0 && ni < rows && nj >= 0 && nj < cols && snapshot[ni][nj] !== 0) {
            freq.set(snapshot[ni][nj], (freq.get(snapshot[ni][nj]) ?? 0) + 1);
          }
        }
      }

      const selfCount = freq.get(snapshot[i][j]) ?? 0;
      if (selfCount < 2 && rng() < 0.6) {
        let maxBiome = snapshot[i][j], maxCount = selfCount;
        for (const [biome, count] of freq) {
          if (count > maxCount) { maxBiome = biome; maxCount = count; }
        }
        output[i][j] = maxBiome;
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════
//  后处理 — 生态过渡修正
//  处理不合理的生物群系邻接（如沙地直接挨着湿草），
//  在过渡带插入中间类型
// ═══════════════════════════════════════════════════════════

const TRANSITION_RULES: Map<string, number> = new Map([
  ["4-5", 2], // 沙地↔湿草 → 泥土
  ["4-7", 2], // 沙地↔苔藓 → 泥土
  ["4-6", 2], // 沙地↔落叶 → 泥土
  ["4-8", 3], // 沙地↔雪地 → 碎石
  ["3-5", 1], // 碎石↔湿草 → 草地
  ["3-7", 6], // 碎石↔苔藓 → 落叶
  ["5-8", 1], // 湿草↔雪地 → 草地
  ["2-8", 3], // 泥土↔雪地 → 碎石
]);

function transitionPass(output: Grid, mask: Grid): void {
  const rows = output.length;
  const cols = output[0]?.length ?? 0;
  const snapshot = output.map(row => [...row]);

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      if (mask[i][j] === 0) continue;
      const self = snapshot[i][j];

      for (const [di, dj] of DIR4) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || ni >= rows || nj < 0 || nj >= cols) continue;
        const neighbor = snapshot[ni][nj];
        if (neighbor === 0 || neighbor === self) continue;

        const lo = Math.min(self, neighbor);
        const hi = Math.max(self, neighbor);
        const key = `${lo}-${hi}`;
        const transition = TRANSITION_RULES.get(key);
        if (transition !== undefined) {
          output[i][j] = transition;
          break;
        }
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════
//  归一化输入：支持单网格或网格列表
// ═══════════════════════════════════════════════════════════

/** 解析单张二维网格（number[][]）；非法返回 null。
 * DataTree 模型下引擎按 access:item 对网格列表自动 fanout，本算子每次只收到一张网格。 */
function parseGrid(raw: unknown): Grid | null {
  if (!raw || !Array.isArray(raw) || raw.length === 0) return null;
  if (Array.isArray(raw[0]) && typeof (raw[0] as unknown[])[0] === "number") {
    return raw as Grid;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════
//  主导出
// ═══════════════════════════════════════════════════════════

const TEXTURE_COUNT = BIOMES.length; // 8

/**
 * 8 套「同一类 tile」的变体命名主题；每套 8 个名称与纹理 id 1～8 一一对应。
 * 每次运行用 seed 随机选**一整套**，避免同一清单里混用草地/沙地/孢子等不同材质组。
 */
// 每个 id 对应一组候选名，每次运行用 seed 在组内随机取一个（同 seed 可复现）
const TILE_VARIANT_THEMES: string[][] = [
  // id=1 草地系
  ["新生草地", "青翠草地", "浓绿草地", "深荫草地", "浅黄草地", "枯黄草地", "斑秃草地", "霜灰草地",
   "嫩绿草地", "翠绿草坪", "鲜活草地", "碧草地", "春意草地", "生机草地"],
  // id=2 泥土系
  ["湿润泥地", "干裂泥地", "板结土面", "深色泥面", "浅色泥面", "车辙泥地", "蹄印泥地", "硬化泥壳",
   "干燥泥地", "裸土地面", "粗糙泥地", "沙质土地", "灰褐土地", "尘土地面", "黄土地面", "风化土地"],
  // id=3 碎石系
  ["细砾石面", "粗砾石面", "灰褐碎石", "深色砾石", "浅色砾石", "混杂碎石", "岩屑碎石", "风化碎石",
   "碎石地面", "砾石铺地", "破碎岩面", "粗砾地面", "石砾铺面", "岩屑地面", "乱石地面"],
  // id=4 沙地系
  ["金黄沙面", "浅黄沙面", "深黄沙面", "干结沙面", "贝壳碎沙", "盐碱白沙", "风蚀沙纹", "浮沙表层",
   "细沙地面", "干沙铺地", "灼热沙地", "金沙地面", "沙粒地面", "沙漠地面", "浮沙地面", "沙质地面"],
  // id=5 湿润系
  ["浸水草皮", "湿泞草面", "反光湿草", "暗绿水草", "沼缘草毯", "渍水草斑", "泥泞草缝", "积水草洼",
   "浸水地面", "湿润草地", "潮湿泥地", "积水地面", "渗水地面", "泥泞地面", "湿泞草地", "沼泽草地"],
  // id=6 枯败系
  ["浅褐落叶层", "深褐落叶层", "潮腐落叶", "干脆落叶", "橡叶堆积", "针叶散铺", "混叶腐殖", "裸土落叶",
   "落叶地面", "枯黄草地", "干枯草地", "凋零草地", "枯萎地面", "褪色草地", "霜枯地面", "暮秋草地"],
  // id=7 苔藓系
  ["浅绿苔面", "深绿苔面", "湿苔斑块", "干苔裂片", "霉绿斑点", "菌落色块", "孢子晕圈", "褪色苔壳",
   "感染地面", "苔藓铺地", "霉斑地面", "绿苔地面", "青苔覆地", "孢子地面", "腐蚀地面", "幽绿地面"],
  // id=8 雪霜系
  ["新雪覆面", "压实雪壳", "融雪泥泞", "霜晶地面", "冰壳地面", "污雪地面", "吹雪纹理", "冻土结霜",
   "灰黄地面", "霜冻地面", "枯雪地面", "白霜铺地", "冻土地面", "积雪地面", "银白地面"],
];

export function outdoorTexture(input: Record<string, unknown>): Record<string, unknown> {
  const grid = parseGrid(input.inputGrid);
  if (!grid) return { error: "inputGrid is required" };
  if (grid.length === 0 || !grid[0] || grid[0].length === 0) return { error: "inputGrid is empty" };

  const temperature = clamp01(typeof input.temperature === "number" ? input.temperature : 0.5);
  const moisture    = clamp01(typeof input.moisture    === "number" ? input.moisture    : 0.5);
  const seedRaw     = typeof input.seed === "number" ? Math.floor(input.seed) : 0;
  const baseSeed = seedRaw === 0 ? Date.now() : seedRaw;

  // 单张多值生物群系网格（每格为纹理 id 1～8 或 0）
  const outputGrid = processOneGrid(grid, temperature, moisture, baseSeed);

  // 用 seed 选定一整套「同材质 tile 变体」8 连名
  const nameRng = makeLCG(baseSeed);
  const poolIdx = Math.floor(nameRng() * TILE_VARIANT_THEMES.length);
  const pool = [...TILE_VARIANT_THEMES[poolIdx]];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(nameRng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const pickedNames = pool.slice(0, TEXTURE_COUNT);

  // 仅输出实际出现的纹理条目，按 id 1→8 有序
  const present = new Set<number>();
  for (const row of outputGrid) for (const v of row) if (v !== 0) present.add(v);

  const nameList: { id: number; name: string; type: string }[] = [];
  for (let tid = 1; tid <= TEXTURE_COUNT; tid++) {
    if (!present.has(tid)) continue;
    nameList.push({ id: tid, name: pickedNames[tid - 1] ?? `变体${tid}`, type: "tile" });
  }

  return { outputGrid, nameList };
}
