/**
 * Geometry DSL 序列化：Statement[] → 单行文本（不含尾换行）。
 *
 * 用途：电池 append 新语句时，先在 TS 数据结构层构造 Statement，
 *       再用 formatStatement 渲染成一行 DSL 文本拼到 source 上。
 *       这样新加 op 不用关心字符串模板细节，且保证 round-trip 严格相等。
 */

import type { Arg, Statement } from './types.js';

/**
 * 单个 Statement → "id = op(k1=v1, k2=v2, ...)"。
 *
 * 参数按 key 名排序输出（不是 args 的插入顺序）：DSL 语义上参数顺序无关（parse 时按
 * 名字装回 Record），排序纯粹是为了让输出文本对同一逻辑语句总是确定、稳定。这一点很
 * 重要——`backend/src/services/baker/canonical.ts` 的 `bakeSha256` 对单 op 的 args 排序
 * 后再算缓存 key，而子图/装配体 bake（`baker.service.ts` 的 `bakeGeometryShape` /
 * `bakeColoredAssembly`）是把这里生成的 DSL 文本整段喂给 `bakeSha256` 当 key 的一部分
 * （见 `subgraph.ts` 的 `reachableSubgraphSource`）。两处如果排序方式不一致，同一逻辑
 * 子图经不同代码路径构造出的 Statement（args 插入顺序不同）就会算出不同的文本、不同的
 * sha，导致该复用缓存时却缓存未命中。
 */
export function formatStatement(stmt: Statement): string {
  const keys = Object.keys(stmt.args).sort();
  const kwargs = keys
    .map((k) => `${k}=${formatArg(stmt.args[k]!)}`)
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
