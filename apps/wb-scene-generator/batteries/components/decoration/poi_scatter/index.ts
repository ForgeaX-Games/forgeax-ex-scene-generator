/**
 * poiScatter: 在单张网格指定区域值上随机散布兴趣点（POI）。
 *
 * DataTree 数据格式：输入 inputGrid 与输出 outputGrid 均为 grid/access:item——
 * 本算子每次只处理单张网格，网格列表由引擎按 DataTree 自动逐张 fanout / 重组。
 *
 * 单条 / 批量两用：poiRules 与 assetNames 都接受「单条直接输入」与「列表」两种写法，
 * 批量时二者按下标一一对应（assetNames 缺位时回落到规则名）。
 *
 * 输入：inputGrid (grid) — 单张网格; poiRules (array) — POI规则; assetNames (array) — 资产名; seed (number)
 * 输出：outputGrid (grid) — 单张多值网格（每种 POI 一个递增 id）; outputNameList (array);
 *       outputAssetNames (string[], access:list) — 按行优先逐点的资产名，与 alg_field2points 的点序对齐;
 *       placedCount (number)
 */

type Grid = number[][];

interface PoiRule {
  decoration: string;
  asset: string;
  targetValue: number;
  count?: number;
  minDistance?: number;
}

interface NameEntry {
  id: number;
  name: string;
  type: string;
}

interface PlacedPoi {
  x: number;
  y: number;
  id: number;
}

class LCG {
  private state: number;
  constructor(seed: number) {
    this.state = (seed === 0 ? Date.now() : seed) >>> 0;
    if (this.state === 0) this.state = 0x6d2b79f5;
  }
  next(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }
  int(min: number, max: number): number {
    if (max <= min) return min;
    return min + Math.floor(this.next() * (max - min + 1));
  }
}

/**
 * 判断 v 是单网格 number[][]：
 *   v[0] 是数组，v[0][0] 是 number（而非数组）
 */
function isGrid(v: unknown): v is Grid {
  if (!Array.isArray(v) || v.length === 0) return false;
  const first = (v as unknown[])[0];
  if (!Array.isArray(first) || (first as unknown[]).length === 0) return false;
  return typeof (first as unknown[])[0] === "number";
}

/**
 * 判断 v 是网格列表 Grid[]（number[][][]）：
 *   v[0] 是数组，v[0][0] 也是数组（即 v[0] 是一行 number[]，v[0][0] 是 number[] 说明 v[0] 是 Grid）
 *   关键区分：v[0][0] 是 Array 而非 number
 */
function isGridList(v: unknown): v is Grid[] {
  if (!Array.isArray(v) || v.length === 0) return false;
  const first = (v as unknown[])[0];
  if (!Array.isArray(first) || (first as unknown[]).length === 0) return false;
  return Array.isArray((first as unknown[])[0]);
}

function cloneGrid(grid: Grid): Grid {
  return grid.map(row => [...row]);
}

function gridMax(grid: Grid): number {
  let max = 0;
  for (const row of grid) for (const v of row) if (v > max) max = v;
  return max;
}

/**
 * 将各种非合法 JSON 格式修复为合法 JSON，支持：
 * 1. {"名称":1:4:12} 或 {"名称":1,4,12}  → {"名称":"1,4,12"}（值为多段数字）
 * 2. {"名称",1,4,12}                      → {"名称":"1,4,12"}（逗号分隔名称与数字）
 */
function fixPoiRulesString(s: string): string {
  // 格式2：{"名称",1,4,12} → {"名称":"1,4,12"}
  s = s.replace(/\{\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*,\s*(\d+(?:\s*[，,]\s*\d+)*)\s*\}/g,
    (_m, name, nums) => `{${name}:"${nums}"}`);
  // 格式1：{"名称":1:4:12} 或 {"名称":1,4,12}（值部分为多段裸数字）
  s = s.replace(/:\s*(\d+(?:\s*[：:，,]\s*\d+)+)\s*([}\]])/g,
    (_m, nums, tail) => `:"${nums}"${tail}`);
  return s;
}

/** 规则之间的分隔符（分号 / 中文分号 / 换行）；逗号留给规则内部的数值段。 */
const RULE_SEP = /[;；\n\r]+/;
/** 规则内部「名称 / targetValue / count / minDistance」的分隔符。 */
const FIELD_SEP = /[：:，,]+/;
/** 资产名列表的分隔符（逗号与分号都允许）。 */
const NAME_SEP = /[,，;；\n\r]+/;

function stripQuotes(s: string): string {
  return s.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
}

function stripBrackets(s: string): string {
  return s.trim().replace(/^\[|\]$/g, "").trim();
}

function makeRule(name: string, nums: readonly unknown[]): PoiRule {
  const n = nums.map(v => Number(v));
  const decoration = name.trim() === "" ? "poi" : name.trim();
  return {
    decoration,
    asset: decoration,
    targetValue: isNaN(n[0]) ? 1 : n[0],
    count: isNaN(n[1]) ? 5 : Math.max(1, Math.round(n[1])),
    minDistance: isNaN(n[2]) ? 8 : Math.max(1, n[2]),
  };
}

/** 裸文本规则：`樱花树:1:6:4`、`樱花树,1,6,4`，或省略名称的 `1:6:4`。 */
function parseBareRule(text: string): PoiRule | null {
  const parts = stripBrackets(text).split(FIELD_SEP).map(stripQuotes).filter(p => p !== "");
  if (parts.length === 0) return null;
  const named = parts[0] !== "" && isNaN(Number(parts[0]));
  return makeRule(named ? parts[0] : "", named ? parts.slice(1) : parts);
}

/**
 * 把 poiRules 的原始输入摊成「一条一项」的条目列表，支持：
 *   数组 / 单个对象 / JSON 字符串（数组或单对象）/ 分号分隔的裸文本。
 */
function toRuleEntries(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") return [raw];
  if (typeof raw !== "string") return [];

  const s = raw.trim();
  if (s === "") return [];
  if (s.startsWith("[") || s.startsWith("{")) {
    try {
      const parsed = JSON.parse(fixPoiRulesString(s));
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      // 非合法 JSON（如 [樱花树:1:6:4；松树:1:3:5]），落到裸文本切分
    }
  }
  return stripBrackets(s).split(RULE_SEP).map(t => t.trim()).filter(t => t !== "");
}

/** 单个条目 → 规则列表（多键对象一次展开成多条）。 */
function parseRuleEntry(item: unknown): PoiRule[] {
  // 数组格式：["名称", targetValue, count, minDistance]
  if (Array.isArray(item)) {
    const named = typeof item[0] === "string" && isNaN(Number(item[0]));
    return [makeRule(named ? (item[0] as string) : "", named ? item.slice(1) : item)];
  }

  let r: Record<string, unknown>;
  if (typeof item === "string") {
    const s = item.trim();
    if (s.startsWith("{")) {
      try {
        r = JSON.parse(fixPoiRulesString(s)) as Record<string, unknown>;
      } catch {
        const bare = parseBareRule(s);
        return bare ? [bare] : [];
      }
    } else {
      const bare = parseBareRule(s);
      return bare ? [bare] : [];
    }
  } else if (item && typeof item === "object") {
    r = item as Record<string, unknown>;
  } else {
    return [];
  }

  // 旧格式：{decoration, targetValue, count, minDistance}
  if (typeof r.decoration === "string" || r.targetValue !== undefined) {
    return [{
      decoration: typeof r.decoration === "string" ? r.decoration : "poi",
      asset: typeof r.decoration === "string" ? r.decoration : "poi",
      targetValue: typeof r.targetValue === "number" ? r.targetValue : 1,
      count: typeof r.count === "number" ? Math.max(1, Math.round(r.count)) : 5,
      minDistance: typeof r.minDistance === "number" ? Math.max(1, r.minDistance) : 8,
    }];
  }

  // 简化格式：键=名称，值=targetValue:count:minDistance；多键对象展开成多条规则
  return Object.keys(r).map(name =>
    makeRule(name, String(r[name]).split(FIELD_SEP).map(stripQuotes)),
  );
}

/**
 * 解析 POI 规则。单条与批量同一入口：
 * 简化格式：`{"洞穴":"1:4:12"}` / `[{"洞穴":1:4:12}, {"营火":4:8:6}]` / `{"洞穴":"1:4:12","营火":"4:8:6"}`
 * 裸文本：  `洞穴:1:4:12` / `洞穴:1:4:12；营火:4:8:6`
 * 旧格式：  `[{decoration, targetValue, count, minDistance}]`
 */
function parsePoiRules(raw: unknown): PoiRule[] {
  return toRuleEntries(raw).flatMap(parseRuleEntry);
}

/**
 * 解析资产名：支持单个名称、JSON 数组、以及 `a,b` / `a；b` / `[a,b]` 等裸文本列表。
 */
function parseAssetNames(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (Array.isArray(raw)) return raw.map(v => stripQuotes(String(v))).filter(v => v !== "");

  if (typeof raw !== "string") return [stripQuotes(String(raw))].filter(v => v !== "");
  const s = raw.trim();
  if (s === "") return [];
  if (s.startsWith("[")) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.map(v => stripQuotes(String(v))).filter(v => v !== "");
    } catch {
      // 非合法 JSON（如 [樱花树,松树]），落到裸文本切分
    }
  }
  return stripBrackets(s).split(NAME_SEP).map(stripQuotes).filter(v => v !== "");
}

/**
 * 在单个网格上按规则散布 POI 点。
 * allPlaced 用于跨规则的间距约束（传入时已包含之前规则放置的点）。
 */
function scatterOnGrid(
  grid: Grid,
  rules: PoiRule[],
  baseId: number,
  maxAttempts: number,
  rng: LCG,
): { outputGrid: Grid; placed: PlacedPoi[]; nameList: NameEntry[]; assetById: Map<number, string>; count: number } {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const out: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const allPlaced: PlacedPoi[] = [];
  const nameList: NameEntry[] = [];
  const assetById = new Map<number, string>();
  let totalCount = 0;
  let currentId = baseId;

  for (const rule of rules) {
    const poiId = currentId++;
    assetById.set(poiId, rule.asset);
    const count = rule.count ?? 5;
    const minDist = rule.minDistance ?? 8;
    const minDist2 = minDist * minDist;
    let placed = 0;

    for (let idx = 0; idx < count; idx++) {
      let found = false;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const x = rng.int(0, cols - 1);
        const y = rng.int(0, rows - 1);

        if (grid[y][x] !== rule.targetValue) continue;

        const tooClose = allPlaced.some(p => {
          const dx = p.x - x, dy = p.y - y;
          return dx * dx + dy * dy < minDist2;
        });
        if (tooClose) continue;

        out[y][x] = poiId;
        allPlaced.push({ x, y, id: poiId });
        found = true;
        break;
      }
      if (found) placed++;
    }

    if (placed > 0) {
      nameList.push({ id: poiId, name: rule.decoration, type: "asset" });
      totalCount += placed;
    }
  }

  return { outputGrid: out, placed: allPlaced, nameList, assetById, count: totalCount };
}

const MAX_ATTEMPTS = 1000;

export function poiScatter(input: Record<string, unknown>): Record<string, unknown> {
  const rawGrid = input.inputGrid;
  const rawRules = input.poiRules;
  const seedRaw = typeof input.seed === "number" ? input.seed : 0;

  if (!isGrid(rawGrid)) return { error: "inputGrid is required (number[][])" };
  const grid = rawGrid as Grid;

  const rules = parsePoiRules(rawRules);
  if (rules.length === 0) return { error: "poiRules must be a non-empty array of {decoration, targetValue}" };

  // 资产名按下标与规则一一对应；只给一个名称时广播到全部规则，缺位则回落到规则名。
  const assets = parseAssetNames(input.assetNames);
  if (assets.length > 0) {
    rules.forEach((rule, i) => {
      rule.asset = assets[i] ?? (assets.length === 1 ? assets[0] : rule.decoration);
    });
  }

  const baseSeed = seedRaw === 0 ? Date.now() : seedRaw;
  const rng = new LCG(baseSeed);
  const baseId = gridMax(grid) + 1;

  // 单张多值网格：每种 POI 一个递增 id
  const { outputGrid, nameList, assetById, count } = scatterOnGrid(grid, rules, baseId, MAX_ATTEMPTS, rng);

  // 仅保留实际写入网格的 POI 条目
  const present = new Set<number>();
  for (const row of outputGrid) for (const v of row) if (v !== 0) present.add(v);
  const outputNameList: NameEntry[] = nameList.filter(e => present.has(e.id));

  // 行优先逐点的资产名，与 alg_field2points 的采样点顺序严格对齐
  const outputAssetNames: string[] = [];
  for (const row of outputGrid) {
    for (const v of row) {
      if (v !== 0) outputAssetNames.push(assetById.get(v) ?? "poi");
    }
  }

  return { outputGrid, outputNameList, outputAssetNames, placedCount: count };
}
