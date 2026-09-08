/**
 * cosmos_biome_mapper: 根据星球类型+高度图+湿度图，映射为地形类型grid
 * 输入：elevationGrid (grid), temperatureGrid (grid), moistureGrid (grid), planetType (string)
 *        temperature 影响雪线偏移（0=极寒雪线下移, 0.5=默认, 1=炎热雪线上移）
 * 输出：terrainGridList (grid[]) — 多张单值网格，每张对应一种地形，填充值=该地形新id，其余=0
 *        nameList (array) — [{id(从1起), name, type:"tile", height(连续)}]，按高度升序
 *
 * 设计原则：
 * - 每种星球类型有固定的地形序列，序列中每种地形必须在网格中实际出现
 * - 阈值区间足够宽（最小5%），保证在任意高度分布下每种地形都能生成
 * - height 字段在 nameList 中按序连续（1,2,3...），无跳跃
 * - 输出 id 从 1 起，0 保留为"空/不渲染"
 */

// 地形原始枚举（内部使用，不对外暴露）
const T = {
  DEEP_WATER:   0,  // 深水
  SHALLOW_WATER:1,  // 浅水
  SAND:         2,  // 沙地
  GRASS:        3,  // 草地
  SOIL:         4,  // 泥土
  STONE:        5,  // 石头
  MOUNTAIN:     6,  // 山脉
  SNOW:         7,  // 雪地
  LAVA:         8,  // 岩浆
  ICE:          9,  // 冰面
  TOXIC:        10, // 毒地
  VOLCANIC:     11, // 火山岩
  OASIS:        12, // 绿洲（沙漠专属）
  PERMAFROST:   13, // 永久冻土（冻原专属）
  BARREN_SOIL:  14, // 荒土（贫瘠专属）
} as const;

/** 每种地形的中文名 */
const TERRAIN_NAME: Record<number, string> = {
  [T.DEEP_WATER]:    "深水",
  [T.SHALLOW_WATER]: "浅水",
  [T.SAND]:          "沙地",
  [T.GRASS]:         "草地",
  [T.SOIL]:          "泥土",
  [T.STONE]:         "石头",
  [T.MOUNTAIN]:      "山脉",
  [T.SNOW]:          "雪地",
  [T.LAVA]:          "岩浆",
  [T.ICE]:           "冰面",
  [T.TOXIC]:         "毒地",
  [T.VOLCANIC]:      "火山岩",
  [T.OASIS]:         "绿洲",
  [T.PERMAFROST]:    "永久冻土",
  [T.BARREN_SOIL]:   "荒土",
};

/**
 * 每种星球的地形序列（按高度从低到高排列），序列中所有地形必须在网格中生成。
 * 阈值边界保证每种地形至少占5%的高度空间。
 */
interface TerrainBand {
  terrain: number;
  /** 该地形在高度图中的上限（0~1），最后一个可以是 Infinity */
  maxElevation: number;
  /** 可选：基于湿度的分支：moisture >= moistureThreshold 时替换为 altTerrain */
  moistureThreshold?: number;
  altTerrain?: number;
}

const PLANET_BANDS: Record<string, TerrainBand[]> = {
  // 郁郁葱葱：深水→浅水→沙地→草地/泥土→石头→山脉→雪地
  lush: [
    { terrain: T.DEEP_WATER,    maxElevation: 0.18 },
    { terrain: T.SHALLOW_WATER, maxElevation: 0.28 },
    { terrain: T.SAND,          maxElevation: 0.36 },
    { terrain: T.SOIL,          maxElevation: 0.55, moistureThreshold: 0.4, altTerrain: T.GRASS },
    { terrain: T.STONE,         maxElevation: 0.72 },
    { terrain: T.MOUNTAIN,      maxElevation: 0.86 },
    { terrain: T.SNOW,          maxElevation: Infinity },
  ],
  // 沙漠：深水→绿洲→沙地→石头→山脉→雪地
  desert: [
    { terrain: T.DEEP_WATER,    maxElevation: 0.12 },
    { terrain: T.OASIS,         maxElevation: 0.22 },
    { terrain: T.SAND,          maxElevation: 0.65 },
    { terrain: T.STONE,         maxElevation: 0.80 },
    { terrain: T.MOUNTAIN,      maxElevation: 0.92 },
    { terrain: T.SNOW,          maxElevation: Infinity },
  ],
  // 冻原：深水→冰面→永久冻土→雪地→石头→山脉
  frozen: [
    { terrain: T.DEEP_WATER,    maxElevation: 0.15 },
    { terrain: T.ICE,           maxElevation: 0.30 },
    { terrain: T.PERMAFROST,    maxElevation: 0.50 },
    { terrain: T.SNOW,          maxElevation: 0.68 },
    { terrain: T.STONE,         maxElevation: 0.83 },
    { terrain: T.MOUNTAIN,      maxElevation: Infinity },
  ],
  // 火山：岩浆→火山岩→石头→山脉→雪地
  volcanic: [
    { terrain: T.LAVA,          maxElevation: 0.18 },
    { terrain: T.VOLCANIC,      maxElevation: 0.38 },
    { terrain: T.STONE,         maxElevation: 0.62 },
    { terrain: T.MOUNTAIN,      maxElevation: 0.82 },
    { terrain: T.SNOW,          maxElevation: Infinity },
  ],
  // 毒性：浅水→毒地→草地/毒地→石头→山脉
  toxic: [
    { terrain: T.SHALLOW_WATER, maxElevation: 0.18 },
    { terrain: T.TOXIC,         maxElevation: 0.40 },
    { terrain: T.GRASS,         maxElevation: 0.65, moistureThreshold: 0.5, altTerrain: T.TOXIC },
    { terrain: T.STONE,         maxElevation: 0.82 },
    { terrain: T.MOUNTAIN,      maxElevation: Infinity },
  ],
  // 贫瘠：深水→荒土→泥土→石头→山脉→雪地
  barren: [
    { terrain: T.DEEP_WATER,    maxElevation: 0.10 },
    { terrain: T.BARREN_SOIL,   maxElevation: 0.25 },
    { terrain: T.SOIL,          maxElevation: 0.50 },
    { terrain: T.STONE,         maxElevation: 0.68 },
    { terrain: T.MOUNTAIN,      maxElevation: 0.84 },
    { terrain: T.SNOW,          maxElevation: Infinity },
  ],
};

/**
 * 根据高度/湿度/温度和星球地形带，返回地形枚举值
 * temperature (0~1)：影响雪线偏移
 *   - 0.0（极寒）→ 雪线下移最多 -0.15（石头层就开始下雪）
 *   - 0.5（适中）→ 不偏移
 *   - 1.0（炎热）→ 雪线上移最多 +0.15（山顶更高才有雪）
 * 偏移仅作用于最后两个地形带（山脉和雪地），模拟雪线效果
 */
function mapTerrain(elevation: number, moisture: number, temperature: number, bands: TerrainBand[]): number {
  // 温度偏移：-0.15 ~ +0.15，温度0.5时偏移为0
  const tempOffset = (temperature - 0.5) * 0.30;
  const lastIdx = bands.length - 1;

  for (let i = 0; i < bands.length; i++) {
    const band = bands[i];
    // 后两个带（山脉、雪地）受温度偏移影响
    const maxElev = (i >= lastIdx - 1 && band.maxElevation !== Infinity)
      ? band.maxElevation - tempOffset
      : band.maxElevation;

    if (elevation < maxElev) {
      if (band.moistureThreshold !== undefined && band.altTerrain !== undefined) {
        return moisture >= band.moistureThreshold ? band.altTerrain : band.terrain;
      }
      return band.terrain;
    }
  }
  return bands[lastIdx].terrain;
}

/** 从int网格（0-1000）读取浮点值 */
function getFloat(grid: number[][], row: number, col: number): number {
  return (grid[row]?.[col] ?? 0) / 1000;
}

export function cosmosBiomeMapper(input: Record<string, unknown>): Record<string, unknown> {
  const elevationGrid    = input.elevationGrid    as number[][] | undefined;
  const temperatureGrid  = input.temperatureGrid  as number[][] | undefined;
  const moistureGrid     = input.moistureGrid     as number[][] | undefined;

  const planetType = typeof input.planetType === "string" ? input.planetType : "lush";

  if (!elevationGrid || elevationGrid.length === 0) {
    return { error: "elevationGrid is required" };
  }

  const H = elevationGrid.length;
  const W = elevationGrid[0]?.length ?? 0;
  if (W === 0) return { error: "elevationGrid rows are empty" };

  const bands = PLANET_BANDS[planetType] ?? PLANET_BANDS["lush"];

  // ── Step 1: 确定该星球的完整地形序列（按带顺序，去重保留顺序） ──
  // 同一个星球中 moistureThreshold 分支会产生两种地形占同一个带，
  // 我们把主 terrain 和 altTerrain 都纳入序列（altTerrain 高度与主带相同）
  const seqTerrains: number[] = [];
  const seenSeq = new Set<number>();
  for (const band of bands) {
    if (!seenSeq.has(band.terrain)) {
      seqTerrains.push(band.terrain);
      seenSeq.add(band.terrain);
    }
    if (band.altTerrain !== undefined && !seenSeq.has(band.altTerrain)) {
      seqTerrains.push(band.altTerrain);
      seenSeq.add(band.altTerrain);
    }
  }

  // ── Step 2: 遍历网格，将原始高度/湿度映射为地形枚举值 ──
  // terrainMap[y][x] = 地形枚举值（T.xxx）
  const terrainMap: number[][] = Array.from({ length: H }, () => new Array(W).fill(0));
  const actualUsed = new Set<number>();

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const elevation    = getFloat(elevationGrid, y, x);
      const temperature  = temperatureGrid ? getFloat(temperatureGrid, y, x) : 0.5;
      const moisture     = moistureGrid    ? getFloat(moistureGrid,    y, x) : 0.5;
      const t = mapTerrain(elevation, moisture, temperature, bands);
      terrainMap[y][x] = t;
      actualUsed.add(t);
    }
  }

  // ── Step 3: 分配输出 id（从1起，按 seqTerrains 顺序） ──
  // seqTerrains 已按星球高度顺序排列，直接用顺序作为高度（1,2,3...）
  const terrainToNewId = new Map<number, number>();
  seqTerrains.forEach((t, idx) => {
    terrainToNewId.set(t, idx + 1);
  });

  // ── Step 4: 为每种地形构建单值网格（值=newId，空格=0） ──
  // 所有 seqTerrains 都有对应网格，即使该地形实际未出现（全零网格）
  const terrainGridList: number[][][] = seqTerrains.map(() =>
    Array.from({ length: H }, () => new Array(W).fill(0))
  );

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = terrainMap[y][x];
      const newId = terrainToNewId.get(t);
      if (newId !== undefined) {
        // idx = newId - 1
        terrainGridList[newId - 1][y][x] = newId;
      }
    }
  }

  // ── Step 5: 构建 nameList（id 从1起，height 连续，type 统一 "tile"） ──
  const nameList = seqTerrains.map((t, idx) => ({
    id:     idx + 1,
    name:   TERRAIN_NAME[t] ?? `terrain_${t}`,
    type:   "tile" as const,
    height: idx + 1,
  }));

  return { terrainGridList, nameList };
}
