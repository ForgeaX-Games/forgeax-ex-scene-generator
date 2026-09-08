/**
 * 共享的"四元组列表"解析器。
 *
 * `g_wall` 的 openings（每项 [x, width, sill, head]）与 `g_floor_slab` 的 holes
 * （每项 [x, y, w, d]）都是"数组 × 4 个有限数"的电池输入解析，逐字重复。抽到这里
 * 复用，去掉 parseOpenings / parseHoles 两份近乎相同的实现（去冗余 / SSOT）。
 *
 * 输入可以是已解析的数组，或 JSON 字符串（电池输入常以字符串传入）。
 * 空值（undefined / null / ''）视为"未提供" → 返回空列表。
 */

/** parseQuadList 的可定制错误文案（保持各电池原有的错误信息一致）。 */
export interface QuadListMessages {
  /** JSON.parse 失败时的错误 */
  readonly json: string;
  /** 顶层不是数组时的错误 */
  readonly notArray: string;
  /** 某一项不是 4 个有限数时的错误 */
  readonly badRow: string;
}

/**
 * 把 value 解析为 number[4][]（每项恰好 4 个有限数）。
 * 成功返回 number[][]；失败返回 { error }（调用方判 `Array.isArray` 分流）。
 */
export function parseQuadList(
  value: unknown,
  messages: QuadListMessages,
): number[][] | { error: string } {
  if (value === undefined || value === null || value === '') return [];
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return { error: messages.json };
    }
  }
  if (!Array.isArray(parsed)) return { error: messages.notArray };
  const out: number[][] = [];
  for (const row of parsed) {
    if (!Array.isArray(row) || row.length !== 4 || !row.every(n => Number.isFinite(Number(n)))) {
      return { error: messages.badRow };
    }
    out.push(row.map(Number));
  }
  return out;
}
