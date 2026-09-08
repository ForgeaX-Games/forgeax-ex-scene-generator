/**
 * search: 在名称清单中搜索包含指定关键词的条目，过滤输出匹配的网格列表与名称清单。
 *
 * 匹配规则：将每个条目的 id、name、type 字段拼成一个字符串，只要搜索词命中任意位置即匹配。
 *
 * 输入：
 *   - gridList:     网格列表 number[][][]（来自 grid_split_by_value 等，每个 grid 仅含一种值）
 *   - nameListList: 名称清单 NameEntry[]（所有 grid 共用的一份清单）
 *   - mode:         搜索模式，当前仅支持"包含"
 *   - searchContent:关键词，支持字符串/字符串数组/NameEntry[]/JSON字符串化数组/逗号分隔列表
 *
 * 处理逻辑：
 *   1. 解析关键词列表（支持逗号分隔的 id 字符串、name 字符串等）
 *   2. 对每个 nameList 条目，将 id+name+type 拼成字符串，判断是否包含任意关键词
 *   3. 收集匹配条目的 id 集合
 *   4. 从 gridList 里保留"网格中存在匹配 id 值"的 grid
 *   5. 输出过滤后的 gridList 和 nameList
 */

interface NameEntry {
  id: number;
  name: string;
  type?: string;
  [key: string]: unknown;
}

function isNameEntry(v: unknown): v is NameEntry {
  return typeof v === "object" && v !== null
    && typeof (v as NameEntry).id === "number"
    && typeof (v as NameEntry).name === "string";
}

function isNumberRow(v: unknown): v is number[] {
  return Array.isArray(v) && (v.length === 0 || typeof (v as unknown[])[0] === "number");
}

function isSingleGrid(v: unknown): v is number[][] {
  return Array.isArray(v) && v.length > 0 && isNumberRow((v as unknown[])[0]);
}

function isGridList(v: unknown): v is number[][][] {
  return Array.isArray(v) && v.length > 0 && isSingleGrid((v as unknown[])[0]);
}

/**
 * 将 searchContent 解析为关键词字符串数组，支持：
 *   - 字符串：普通字符串或逗号分隔列表（"3,4,5" → ["3","4","5"]）
 *   - JSON 数组字符串："[\"草地\",\"森林\"]"
 *   - string[]：直接使用
 *   - NameEntry[]/NameEntry：取 name 字段
 */
function parseKeywords(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];

  if (isNameEntry(raw)) return [raw.name];

  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return [];
    // JSON 数组
    if (s.startsWith("[")) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) return parseKeywords(parsed);
      } catch { /* 非 JSON，继续 */ }
    }
    // 逗号分隔列表
    if (s.includes(",")) {
      return s.split(",").map(x => x.trim()).filter(Boolean);
    }
    return [s];
  }

  if (Array.isArray(raw)) {
    const result: string[] = [];
    for (const item of raw as unknown[]) {
      if (typeof item === "string" && item) result.push(item.trim());
      else if (isNameEntry(item)) result.push(item.name);
    }
    return result;
  }

  return [];
}

/**
 * 将 nameListList 输入规范化为 NameEntry[]（一份共用清单）
 * 支持：
 *   - NameEntry[]：直接使用
 *   - NameEntry[][]：打平为 NameEntry[]
 *   - 单个 NameEntry：包装为数组
 */
function parseNameList(raw: unknown): NameEntry[] {
  if (!raw) return [];
  if (isNameEntry(raw)) return [raw];
  if (!Array.isArray(raw)) return [];

  const arr = raw as unknown[];
  if (arr.length === 0) return [];

  // NameEntry[]
  if (isNameEntry(arr[0])) {
    return arr.filter(isNameEntry) as NameEntry[];
  }

  // NameEntry[][] → 打平
  if (Array.isArray(arr[0])) {
    const flat: NameEntry[] = [];
    for (const sub of arr as unknown[][]) {
      for (const item of sub) {
        if (isNameEntry(item)) flat.push(item);
      }
    }
    return flat;
  }

  return [];
}

export function search(input: Record<string, unknown>): Record<string, unknown> {
  const mode = typeof input.mode === "string" ? input.mode : "包含";
  const keywords = parseKeywords(input.searchContent);

  // 规范化 gridList → number[][][]
  let grids: number[][][] = [];
  const rawGridList = input.gridList;
  if (isGridList(rawGridList)) {
    grids = rawGridList;
  } else if (isSingleGrid(rawGridList)) {
    grids = [rawGridList];
  }

  // 规范化 nameList（nameListList 端口，实际可能是共用清单）
  const nameList = parseNameList(input.nameListList);

  // 关键词为空 → 全部透传
  if (keywords.length === 0) {
    return { outputGridList: grids, outputNameList: nameList };
  }

  // 对每个条目：将 id、name、type 拼成搜索字符串，包含任意关键词即匹配
  const matchedIds = new Set<number>();
  const outputNameList: NameEntry[] = [];

  for (const entry of nameList) {
    const searchStr = [
      String(entry.id),
      entry.name,
      entry.type ?? "",
    ].join(" ").toLowerCase();

    const matched = mode === "包含"
      && keywords.some(kw => searchStr.includes(kw.toLowerCase()));

    if (matched) {
      matchedIds.add(entry.id);
      outputNameList.push(entry);
    }
  }

  // 过滤 gridList：保留网格中存在匹配 id 值的 grid
  const outputGridList: number[][][] = [];
  for (const grid of grids) {
    const hasMatch = grid.some(row => row.some(val => val !== 0 && matchedIds.has(val)));
    if (hasMatch) {
      outputGridList.push(grid);
    }
  }

  return { outputGridList, outputNameList };
}
