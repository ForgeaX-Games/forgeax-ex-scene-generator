/**
 * Geometry DSL 序列化：Statement[] → 单行文本（不含尾换行）。
 *
 * 用途：电池 append 新语句时，先在 TS 数据结构层构造 Statement，
 *       再用 formatStatement 渲染成一行 DSL 文本拼到 source 上。
 *       这样新加 op 不用关心字符串模板细节，且保证 round-trip 严格相等。
 */

import type { Arg, Statement } from './types.js';

/** 单个 Statement → "id = op(k1=v1, k2=v2, ...)" */
export function formatStatement(stmt: Statement): string {
  const kwargs = Object.entries(stmt.args)
    .map(([k, v]) => `${k}=${formatArg(v)}`)
    .join(', ');
  return `${stmt.id} = ${stmt.op}(${kwargs})`;
}

/** 整个语句列表 → 多行 DSL（行末不附加换行；调用方按需追加） */
export function formatStatements(stmts: readonly Statement[]): string {
  return stmts.map(formatStatement).join('\n');
}

export function formatArg(arg: Arg): string {
  switch (arg.kind) {
    case 'number': return formatNumber(arg.value);
    case 'string': return formatString(arg.value);
    case 'bool':   return arg.value ? 'true' : 'false';
    case 'ref':    return arg.name;
    case 'list':   return `[${arg.items.map(formatArg).join(', ')}]`;
  }
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) {
    throw new Error(`Geometry DSL serialize: non-finite number "${n}"`);
  }
  // 整数尽量整型化；浮点用紧凑 toString（去掉无意义尾零）
  if (Number.isInteger(n)) return String(n);
  return String(n);
}

function formatString(s: string): string {
  let out = '"';
  for (const ch of s) {
    switch (ch) {
      case '"':  out += '\\"'; break;
      case '\\': out += '\\\\'; break;
      case '\n': out += '\\n'; break;
      case '\t': out += '\\t'; break;
      case '\r': out += '\\r'; break;
      default:   out += ch;
    }
  }
  out += '"';
  return out;
}
