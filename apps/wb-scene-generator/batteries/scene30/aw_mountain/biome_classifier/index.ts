/**
 * biomeClassifier: 三场地块分类器（算法与旧版完全一致，仅端口命名更新）
 * 输入：field1（主场）/ field2（次场）/ field3（三场）→ 0–100 数值网格
 * 输出：terrainGrid（地块 ID 1–7 整数网格）；terrainNameList（实际出现的地形名称清单）
 *
 * 地块 ID → 名称 → 渲染色（调色板 index = ID - 1）
 *   1 = 森林山顶（红色   #e05555）— field1 极低区
 *   2 = 森林山脚（深橙色 #e07730）— field1 次低区
 *   3 = 草地    （橙色   #e0a830）— field1 低地，field3 偏高
 *   4 = 沙滩    （黄绿色 #c8d430）— field1 低地，field2 偏高
 *   5 = 山脚    （草绿色 #6aba30）— field1 中等
 *   6 = 山坡    （翠绿色 #30ba7a）— field1 中高
 *   7 = 山顶    （青蓝色 #30bab8）— field1 极高
 */

interface TerrainThresholds {
  f1LowA: number;          // field1 < f1LowA → 森林山顶（1）
  f1LowB: number;          // field1 < f1LowB → 森林山脚（2）
  f1MidMax: number;        // field1 < f1MidMax → 低地区（3 or 4）
  f1FootMax: number;       // field1 < f1FootMax → 山脚（5）
  f1SlopeMax: number;      // field1 < f1SlopeMax → 山坡（6）；≥ → 山顶（7）
  f2ThreshHigh: number;    // field2 > f2ThreshHigh → 沙滩（4）优先
  f3ThreshHigh: number;    // field3 > f3ThreshHigh → 草地（3）
}

// Perlin 噪声呈钟形分布（集中 40–60），阈值按实际百分位对齐：
// <35 ≈10%（森林山顶）→ 35–42 ≈10%（森林山脚）→ 42–58 ≈40%（低地草地/沙滩）
// → 58–67 ≈15%（山脚）→ 67–76 ≈15%（山坡）→ ≥76 ≈10%（穹顶增益后可稳定出现，山顶）
const DEFAULT_THRESHOLDS: TerrainThresholds = {
  f1LowA: 35,
  f1LowB: 42,
  f1MidMax: 58,
  f1FootMax: 67,
  f1SlopeMax: 76,
  f2ThreshHigh: 55,
  f3ThreshHigh: 45,
};

function parseThresholds(raw: unknown): TerrainThresholds {
  if (typeof raw === "string" && raw.trim()) {
    try {
      return { ...DEFAULT_THRESHOLDS, ...JSON.parse(raw) };
    } catch {
      // fall through
    }
  }
  return { ...DEFAULT_THRESHOLDS };
}

function classifyCell(f1: number, f2: number, f3: number, t: TerrainThresholds): number {
  if (f1 < t.f1LowA) return 1;        // 森林山顶
  if (f1 < t.f1LowB) return 2;        // 森林山脚
  if (f1 < t.f1MidMax) {
    if (f3 > t.f3ThreshHigh) return 3; // 草地
    if (f2 > t.f2ThreshHigh) return 4; // 沙滩
    return 3;                           // 默认草地
  }
  if (f1 < t.f1FootMax) return 5;     // 山脚
  if (f1 < t.f1SlopeMax) return 6;    // 山坡
  return 7;                            // 山顶
}

interface NameEntry {
  id: number;
  name: string;
}

const TERRAIN_NAMES: Record<number, string> = {
  1: "森林山顶",
  2: "森林山脚",
  3: "草地",
  4: "沙滩",
  5: "山脚",
  6: "山坡",
  7: "山顶",
};

function buildTerrainNameList(grid: number[][]): NameEntry[] {
  const present = new Set<number>();
  for (const row of grid) for (const v of row) if (v !== 0) present.add(v);
  return [...present].sort((a, b) => a - b).map(id => ({
    id,
    name: TERRAIN_NAMES[id] ?? `地形${id}`,
  }));
}

function normalizeGrid(grid: number[][]): number[][] {
  let maxVal = 0;
  for (const row of grid) for (const v of row) if (v > maxVal) maxVal = v;
  return maxVal <= 1.01 ? grid.map(row => row.map(v => Math.round(v * 100))) : grid;
}

export function biomeClassifier(input: Record<string, unknown>): Record<string, unknown> {
  const rawF1 = input.field1 as number[][] | undefined;
  if (!rawF1 || !Array.isArray(rawF1) || rawF1.length === 0) {
    return { error: "field1 is required and must be a non-empty 2D array" };
  }

  const f1 = normalizeGrid(rawF1);
  const rows = f1.length;
  const cols = f1[0].length;

  const rawF2 = input.field2 as number[][] | undefined;
  const rawF3 = input.field3 as number[][] | undefined;
  const f2 = rawF2 ? normalizeGrid(rawF2) : null;
  const f3 = rawF3 ? normalizeGrid(rawF3) : null;

  const t = parseThresholds(input.thresholds);

  const terrainGrid: number[][] = Array.from({ length: rows }, (_, y) =>
    Array.from({ length: cols }, (__, x) => {
      const v1 = f1[y][x];
      const v2 = f2?.[y]?.[x] ?? 50;
      const v3 = f3?.[y]?.[x] ?? 50;
      return classifyCell(v1, v2, v3, t);
    })
  );

  const terrainNameList = buildTerrainNameList(terrainGrid);

  return { terrainGrid, terrainNameList };
}
