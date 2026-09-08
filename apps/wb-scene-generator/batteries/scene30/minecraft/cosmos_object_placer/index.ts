/**
 * cosmos_object_placer: 根据地形和区域网格生成装饰物、资源节点、建筑结构、敌人的放置信息
 * 输入：terrainGrid (grid) — 地形网格（接 cosmos_terrain_variation.variedGridList[0]）
 *        zoneGrid (grid, 可选) — 区域网格（接 cosmos_zone_marker.zoneGridList[0]）
 *        planetType, seed, tileSize, decorDensity, resourceMultiplier, enemyDensity
 * 输出：objectNameList (array) — [{id, name(中文), type:"asset", height}] 标准名称清单，每条对应一种对象类型
 *        objectGridList (grid[]) — 与 objectNameList 一一对应的单值网格列表，1=该位置有此对象，0=无
 */

// 区域标记（来自 cosmos_zone_marker，固定值）
const ZONE_STRUCTURE = 100;
const ZONE_CRYSTAL = 200;
const ZONE_ANCIENT = 300;

/** 标准名称清单条目 */
type ObjectNameEntry = {
  id: number;
  name: string;
  type: "asset";
  height: number;
};

/**
 * 所有可能的对象类型元数据
 * name: 中文显示名
 * height: 高度层级（0=地面，1=低矮，2=中等，3=高，4=建筑级）
 */
const OBJECT_META: Record<string, { name: string; height: number }> = {
  // 装饰物
  plant_small:    { name: "小植物",   height: 1 },
  plant_medium:   { name: "中植物",   height: 1 },
  flower:         { name: "花朵",     height: 1 },
  bush:           { name: "灌木",     height: 1 },
  grass_tuft:     { name: "草丛",     height: 1 },
  pebbles:        { name: "碎石",     height: 0 },
  ash_pile:       { name: "灰烬堆",   height: 0 },
  snow_pile:      { name: "雪堆",     height: 0 },
  lava_crack:     { name: "熔岩裂缝", height: 0 },
  slime:          { name: "黏液",     height: 0 },
  mushroom:       { name: "蘑菇",     height: 1 },
  rock_small:     { name: "小岩石",   height: 1 },
  rock_large:     { name: "大岩石",   height: 2 },
  cactus:         { name: "仙人掌",   height: 2 },
  bone:           { name: "骨骸",     height: 1 },
  dead_tree:      { name: "枯树",     height: 3 },
  ice_crystal:    { name: "冰晶",     height: 2 },
  frozen_plant:   { name: "冰冻植物", height: 1 },
  icicle:         { name: "冰锥",     height: 2 },
  ember:          { name: "余烬",     height: 1 },
  volcanic_rock:  { name: "火山石",   height: 2 },
  toxic_plant:    { name: "毒性植物", height: 1 },
  spore_pod:      { name: "孢子囊",   height: 1 },
  crater:         { name: "陨石坑",   height: 1 },
  crystal_cluster:{ name: "水晶簇",   height: 2 },
  // 资源节点
  carbon:         { name: "碳矿",     height: 1 },
  alienTissue:    { name: "异星组织", height: 1 },
  iron:           { name: "铁矿",     height: 2 },
  silicon:        { name: "硅矿",     height: 2 },
  titanium:       { name: "钛矿",     height: 2 },
  platinum:       { name: "铂矿",     height: 2 },
  hydrogen:       { name: "氢气罐",   height: 1 },
  // 建筑结构
  cargo_crate:    { name: "货物箱",   height: 2 },
  beacon:         { name: "信标",     height: 4 },
  ruins_pillar:   { name: "遗迹柱",   height: 3 },
  ancient_tree:   { name: "远古树",   height: 4 },
  giant_mushroom: { name: "巨型蘑菇", height: 4 },
  shrine:         { name: "神龛",     height: 3 },
  bone_pile:      { name: "骨骸堆",   height: 2 },
  obelisk:        { name: "方尖碑",   height: 4 },
  ruins_wall:     { name: "遗迹墙",   height: 3 },
  tech_antenna:   { name: "科技天线", height: 4 },
  ruins_tower:    { name: "遗迹塔",   height: 4 },
  monolith:       { name: "独石碑",   height: 4 },
  tech_console:   { name: "科技控制台", height: 2 },
  mining_drill:   { name: "采矿钻头", height: 3 },
  tech_generator: { name: "科技发电机", height: 3 },
  // 敌人
  swarmBug:       { name: "虫群",     height: 1 },
  spitter:        { name: "喷吐者",   height: 1 },
  crawler:        { name: "爬行者",   height: 1 },
  sandScorpion:   { name: "沙漠蝎",   height: 1 },
  floater:        { name: "漂浮体",   height: 2 },
  iceSlime:       { name: "冰史莱姆", height: 1 },
  frostBear:      { name: "霜熊",     height: 2 },
  fireElemental:  { name: "火元素",   height: 2 },
  magmaWyrm:      { name: "岩浆蠕虫", height: 3 },
  ashMite:        { name: "灰螨",     height: 1 },
  poisonWorm:     { name: "毒蠕虫",   height: 1 },
  plagueCarrier:  { name: "瘟疫携带者", height: 1 },
  toxicMushroom:  { name: "毒蘑菇",   height: 1 },
  lightningLizard:{ name: "闪电蜥蜴", height: 1 },
  voidWalker:     { name: "虚空行者", height: 2 },
};

function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function choose<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function nextFloat(rng: () => number, min: number, max: number): number {
  return rng() * (max - min) + min;
}

function nextInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

// 装饰物类型按星球类型（不依赖具体地形ID枚举）
function decorTypesFor(planetType: string): string[] {
  switch (planetType) {
    case "lush":     return ["plant_small", "plant_medium", "flower", "bush", "mushroom", "grass_tuft"];
    case "desert":   return ["rock_small", "cactus", "bone", "dead_tree", "pebbles"];
    case "frozen":   return ["ice_crystal", "snow_pile", "frozen_plant", "icicle", "rock_small"];
    case "volcanic": return ["ember", "ash_pile", "volcanic_rock", "lava_crack", "rock_large"];
    case "toxic":    return ["toxic_plant", "spore_pod", "slime", "mushroom"];
    case "barren":   return ["rock_small", "rock_large", "pebbles", "crater", "bone"];
    default:         return ["rock_small", "pebbles", "grass_tuft"];
  }
}

// 资源类型按星球类型（不依赖具体地形ID枚举）
function resourceTypesFor(planetType: string): string[] {
  switch (planetType) {
    case "lush":     return ["carbon", "alienTissue", "iron"];
    case "desert":   return ["silicon", "carbon", "iron"];
    case "frozen":   return ["hydrogen", "silicon", "titanium"];
    case "volcanic": return ["iron", "titanium", "platinum"];
    case "toxic":    return ["alienTissue", "carbon", "silicon"];
    case "barren":   return ["iron", "silicon", "titanium"];
    default:         return ["iron", "carbon"];
  }
}

// 分散建筑类型按星球
function scatteredStructuresFor(planetType: string): string[] {
  const common = ["cargo_crate", "beacon", "ruins_pillar"];
  switch (planetType) {
    case "lush":     return [...common, "ancient_tree", "giant_mushroom", "shrine"];
    case "desert":   return [...common, "bone_pile", "obelisk", "ruins_wall"];
    case "frozen":   return [...common, "crystal_cluster", "tech_antenna"];
    case "volcanic": return [...common, "ruins_tower", "monolith"];
    case "toxic":    return [...common, "tech_console", "giant_mushroom"];
    case "barren":   return [...common, "mining_drill", "tech_generator"];
    default:         return common;
  }
}

// 敌人类型按星球
function enemyTypesFor(planetType: string): string[] {
  switch (planetType) {
    case "lush":     return ["swarmBug", "spitter", "crawler"];
    case "desert":   return ["spitter", "sandScorpion", "crawler"];
    case "frozen":   return ["floater", "iceSlime", "frostBear"];
    case "volcanic": return ["fireElemental", "magmaWyrm", "ashMite"];
    case "toxic":    return ["poisonWorm", "plagueCarrier", "toxicMushroom"];
    case "barren":   return ["crawler", "lightningLizard", "voidWalker"];
    default:         return ["crawler", "spitter"];
  }
}

/**
 * 从 array 输入中解析出合并的单张网格：
 * - 若传入的是 number[][][]（多张单值网格列表），将所有层合并（每格取第一个非零值）
 * - 若传入的是 number[][]（单张网格），直接返回
 * - 若传入的是空或非法数据，返回 undefined
 */
function mergeGridList(raw: unknown): number[][] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const first = raw[0];
  // 单张网格（number[][]）
  if (Array.isArray(first) && (first.length === 0 || typeof first[0] === "number")) {
    return raw as number[][];
  }
  // 多张单值网格（number[][][]）— 合并：每格取第一个非零值
  if (Array.isArray(first) && Array.isArray(first[0])) {
    const layers = raw as number[][][];
    const H = layers[0].length;
    const W = layers[0][0]?.length ?? 0;
    const merged: number[][] = Array.from({ length: H }, () => new Array(W).fill(0));
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        for (const layer of layers) {
          const v = layer[y]?.[x] ?? 0;
          if (v !== 0) { merged[y][x] = v; break; }
        }
      }
    }
    return merged;
  }
  return undefined;
}

export function cosmosObjectPlacer(input: Record<string, unknown>): Record<string, unknown> {
  // 两个输入端口均为 array 类型，内部自动合并为单张网格
  const terrainGrid = mergeGridList(input.terrainGrid);
  const zoneGrid = mergeGridList(input.zoneGrid);

  const planetType = typeof input.planetType === "string" ? input.planetType : "lush";
  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  const decorDensityMult = typeof input.decorDensity === "number" ? input.decorDensity : 0.15;
  const resourceMult = typeof input.resourceMultiplier === "number" ? input.resourceMultiplier : 0.34;
  const enemyDensityMult = typeof input.enemyDensity === "number" ? input.enemyDensity : 1.0;

  if (!terrainGrid || terrainGrid.length === 0) {
    return { error: "terrainGrid is required" };
  }

  const seed = seedRaw === 0 ? Date.now() : seedRaw;
  const rng = mulberry32(seed);

  const H = terrainGrid.length;
  const W = terrainGrid[0]?.length ?? 0;

  // typeIndex: 对象名称 -> 在 nameSlots 中的下标（0-indexed）
  const typeIndex = new Map<string, number>();
  // nameSlots: 按注册顺序记录每种对象类型名称
  const nameSlots: string[] = [];
  // perTypeGrids: 每种类型一张 H×W 单值网格（0/1）
  const perTypeGrids: number[][][] = [];

  /** 获取或注册类型下标，并确保对应网格已初始化 */
  function getOrRegister(objName: string): number {
    let idx = typeIndex.get(objName);
    if (idx === undefined) {
      idx = nameSlots.length;
      nameSlots.push(objName);
      typeIndex.set(objName, idx);
      perTypeGrids.push(Array.from({ length: H }, () => new Array(W).fill(0)));
    }
    return idx;
  }

  const DECOR_RATE = 0.02 * decorDensityMult;
  const RESOURCE_RATE = 0.02 * resourceMult;

  const decorTypes = decorTypesFor(planetType);
  const resourceTypes = resourceTypesFor(planetType);
  const structureTypes = scatteredStructuresFor(planetType);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const terrain = terrainGrid[y][x];
      // 0 代表空/不渲染，跳过
      if (terrain === 0) continue;

      const zone = zoneGrid ? (zoneGrid[y]?.[x] ?? 0) : 0;

      // 水晶区域覆盖
      if (zone === ZONE_CRYSTAL && rng() < 0.3) {
        nextFloat(rng, 0.6, 1.2);
        nextInt(rng, 0, 4);
        perTypeGrids[getOrRegister("crystal_cluster")][y][x] = 1;
        continue;
      }

      // 远古区域无对象放置
      if (zone === ZONE_ANCIENT) continue;

      // 结构区域：偶尔生成散落建筑
      if (zone === ZONE_STRUCTURE && rng() < 0.08) {
        const objName = choose(rng, structureTypes);
        nextFloat(rng, 0.8, 1.2);
        nextInt(rng, 0, 3);
        rng(); // damaged roll
        perTypeGrids[getOrRegister(objName)][y][x] = 1;
        continue;
      }

      // 普通地形：装饰物
      if (rng() < DECOR_RATE) {
        const objName = choose(rng, decorTypes);
        nextFloat(rng, 0.8, 1.2);
        perTypeGrids[getOrRegister(objName)][y][x] = 1;
        continue;
      }

      // 资源节点
      if (rng() < RESOURCE_RATE) {
        const objName = choose(rng, resourceTypes);
        perTypeGrids[getOrRegister(objName)][y][x] = 1;
        continue;
      }
    }
  }

  // 敌人生成：按区块（32x32）计算，每区块1-4个
  const CHUNK = 32;
  const chunkCols = Math.ceil(W / CHUNK);
  const chunkRows = Math.ceil(H / CHUNK);
  const enemyTypes = enemyTypesFor(planetType);

  for (let cy = 0; cy < chunkRows; cy++) {
    for (let cx = 0; cx < chunkCols; cx++) {
      const count = Math.max(1, Math.floor(nextInt(rng, 1, 4) * enemyDensityMult));
      for (let i = 0; i < count; i++) {
        const lx = nextInt(rng, 2, CHUNK - 3);
        const ly = nextInt(rng, 2, CHUNK - 3);
        const gx = cx * CHUNK + lx;
        const gy = cy * CHUNK + ly;
        if (gx >= W || gy >= H) continue;
        // 只在非零地形格放敌人
        if ((terrainGrid[gy]?.[gx] ?? 0) === 0) continue;
        const objName = choose(rng, enemyTypes);
        perTypeGrids[getOrRegister(objName)][gy][gx] = 1;
      }
    }
  }

  // 构建最终输出
  const objectNameList: ObjectNameEntry[] = [];
  const objectGridList: number[][][] = [];

  nameSlots.forEach((key, idx) => {
    const grid = perTypeGrids[idx];
    const meta = OBJECT_META[key] ?? { name: key, height: 1 };
    objectNameList.push({ id: idx + 1, name: meta.name, type: "asset", height: meta.height });
    objectGridList.push(grid);
  });

  return { objectNameList, objectGridList };
}
