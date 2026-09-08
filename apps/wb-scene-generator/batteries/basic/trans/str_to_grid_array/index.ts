/**
 * strToGridArray: 递归解析任意格式字符串，提取所有有效 grid（二维整数数组）并收集为 array 输出
 * 输入：str (string) — 任意内容的字符串
 * 输出：array (array) — 所有找到的 grid 列表，每个元素为 number[][]
 */

type Grid2D = number[][];

/**
 * 判断一个值是否为有效的 grid（number[][]）
 * 要求：非空数组，每个元素为非空数组，且所有元素均为数字
 */
function isValidGrid(val: unknown): val is Grid2D {
  if (!Array.isArray(val) || val.length === 0) return false;
  for (const row of val) {
    if (!Array.isArray(row) || row.length === 0) return false;
    for (const cell of row) {
      if (typeof cell !== "number" || !isFinite(cell)) return false;
    }
  }
  return true;
}

/**
 * 递归遍历任意 JSON 结构，将所有满足 grid 条件的值收集到 results 中
 */
function collectGrids(node: unknown, results: Grid2D[], visited: Set<unknown>): void {
  if (node === null || node === undefined) return;
  if (typeof node !== "object") return;

  // 防止循环引用
  if (visited.has(node)) return;
  visited.add(node);

  if (isValidGrid(node)) {
    results.push(node as Grid2D);
    // grid 本身已收集，不再深入其内部行数组
    return;
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      collectGrids(item, results, visited);
    }
  } else {
    for (const key of Object.keys(node as object)) {
      collectGrids((node as Record<string, unknown>)[key], results, visited);
    }
  }
}

/**
 * 尝试将字符串解析为 JSON，若失败则返回 null
 * 同时处理字符串被多次 JSON.stringify 的情况（双重编码）
 */
function tryParseJSON(str: string): unknown {
  let current: unknown = str;
  // 最多尝试 3 层解包（避免无限循环）
  for (let i = 0; i < 3; i++) {
    if (typeof current !== "string") break;
    try {
      current = JSON.parse(current);
    } catch {
      break;
    }
  }
  return current === str ? null : current;
}

export function strToGridArray(input: Record<string, unknown>): Record<string, unknown> {
  const str = input.str;

  if (typeof str !== "string" || str.trim() === "") {
    return { error: "str is required and must be a non-empty string", array: [] };
  }

  const parsed = tryParseJSON(str.trim());
  if (parsed === null) {
    return { error: "str could not be parsed as JSON", array: [] };
  }

  const results: Grid2D[] = [];
  const visited = new Set<unknown>();
  collectGrids(parsed, results, visited);

  return { array: results };
}
