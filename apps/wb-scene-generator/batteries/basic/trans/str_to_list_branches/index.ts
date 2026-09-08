/**
 * strToListBranches: 把列表字符串解析为元素数组，经 output access:list 炸成独立子分支。
 * 输入：str (string) — 形如 `[a,b,c]` 的列表字符串（元素可不加引号）
 * 输出：items (any, access:list) — 每个元素一个独立子分支，可直接喂 item 端口逐个 fanout
 *
 * 解析策略：先按标准 JSON 解析（含多层脱壳）；失败再退回「容错切分」：
 * 去掉最外层方括号后，按顶层逗号切分（尊重嵌套括号/引号），逐段 trim，
 * 纯数字转 number，带引号去引号，其余按字符串保留——故 [test2,test3] 也能用。
 */

function tryParseJSON(str: string): unknown[] | null {
  let current: unknown = str;
  for (let i = 0; i < 3; i++) {
    if (typeof current !== 'string') break;
    try {
      current = JSON.parse(current);
    } catch {
      break;
    }
  }
  return Array.isArray(current) ? current : null;
}

/** 按顶层逗号切分（忽略嵌套 []{}() 与引号内的逗号）。 */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let buf = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      buf += ch;
      if (ch === quote && body[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
    if (ch === '[' || ch === '{' || ch === '(') { depth++; buf += ch; continue; }
    if (ch === ']' || ch === '}' || ch === ')') { depth--; buf += ch; continue; }
    if (ch === ',' && depth === 0) { parts.push(buf); buf = ''; continue; }
    buf += ch;
  }
  if (buf.trim() !== '' || parts.length > 0) parts.push(buf);
  return parts;
}

/** 把单个 token 还原为合理的值：数字 / 去引号字符串 / 嵌套结构（JSON）/ 裸字符串。 */
function coerceToken(token: string): unknown {
  const t = token.trim();
  if (t === '') return '';
  try {
    return JSON.parse(t);
  } catch {
    /* not JSON — fall through */
  }
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t;
}

function lenientParse(str: string): unknown[] | null {
  const s = str.trim();
  if (!s.startsWith('[') || !s.endsWith(']')) return null;
  const body = s.slice(1, -1).trim();
  if (body === '') return [];
  return splitTopLevel(body).map(coerceToken);
}

export function strToListBranches(input: Record<string, unknown>): Record<string, unknown> {
  const raw = input.str;
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { items: [] };
  }
  const s = raw.trim();
  // 列表字符串 → 多元素；非列表的裸标量（如 "TEST2"）→ 单元素列表，绝不报错，
  // 以免单个输入时把下游整条链打断。
  const arr = tryParseJSON(s) ?? lenientParse(s) ?? [coerceToken(s)];
  return { items: arr };
}
