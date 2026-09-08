/**
 * Geometry 构造 / 派生纯函数。
 *
 * 与 scene/tree.ts 同范式：所有 mutation 都是返回新 Geometry 的纯函数。
 * Geometry 值在出函数前 Object.freeze，下游禁止就地改动。
 */

import type { Arg, Geometry, Statement } from './types.js';
import { parseDSL } from './parser.js';
import { formatStatement, formatStatements } from './serialize.js';

/** 空 Geometry —— 用作 pipeline 入口 / 缺省值。version 从 0 起步。 */
export function makeGeometry(): Geometry {
  return Object.freeze({
    source: '',
    statements: Object.freeze([] as Statement[]),
    version: 0,
  }) as Geometry;
}

/** 从 DSL 文本解析重建一个 Geometry；focus 缺省指向最后一条语句的 id。 */
export function geometryFromSource(source: string): Geometry {
  const { statements } = parseDSL(source);
  const focus = statements.length > 0 ? statements[statements.length - 1]!.id : undefined;
  return Object.freeze({
    source,
    statements: Object.freeze(statements),
    ...(focus !== undefined ? { focus } : {}),
    version: 1,
  }) as Geometry;
}

export function geometryFromStatements(
  statements: readonly Statement[],
  opts?: { readonly previous?: Geometry; readonly focus?: string; readonly version?: number },
): Geometry {
  const rewritten = Object.freeze(statements.map((stmt, index) => Object.freeze({
    ...stmt,
    args: Object.freeze({ ...stmt.args }),
    line: index + 1,
  }) as Statement));
  const focus = opts?.focus ?? opts?.previous?.focus ?? rewritten[rewritten.length - 1]?.id;
  return Object.freeze({
    source: formatStatements(rewritten),
    statements: rewritten,
    ...(focus !== undefined ? { focus } : {}),
    version: opts?.version ?? ((opts?.previous?.version ?? 0) + 1),
  }) as Geometry;
}

/**
 * 在末尾追加一条语句，返回新 Geometry。
 *
 * 调用方负责保证 id 在当前 geom 内未被使用（v1 不在 append 处再扫一遍 —— 留给 validate）；
 * 但提供 freshId() 工具帮电池生成不冲突的名字。
 */
export function append(geom: Geometry, stmt: Statement): Geometry {
  const line = formatStatement(stmt);
  // 重新装配 statement 对象，把 line（行号）改成新的真实行号
  // 真实行号 = 原 source 行数 + 1（不含末尾空行的额外）
  const trimmed = geom.source.replace(/\n+$/, '');
  const newLineNo = trimmed === '' ? 1 : trimmed.split('\n').length + 1;
  const rewritten = Object.freeze({ ...stmt, line: newLineNo, args: Object.freeze({ ...stmt.args }) }) as Statement;

  const newSource = trimmed === '' ? line : `${trimmed}\n${line}`;
  const newStatements = Object.freeze([...geom.statements, rewritten]);

  return Object.freeze({
    source: newSource,
    statements: newStatements,
    focus: rewritten.id,
    version: geom.version + 1,
  }) as Geometry;
}

/**
 * 便捷追加：直接给 op + args，自动构造 Statement + append。
 * 99% 的电池调这个就够了。
 */
export function emit(
  geom: Geometry,
  id: string,
  op: string,
  args: Readonly<Record<string, Arg>>,
): Geometry {
  const stmt: Statement = Object.freeze({
    id,
    op,
    args: Object.freeze({ ...args }),
    line: 0, // append 会改写
  }) as Statement;
  return append(geom, stmt);
}

/**
 * 生成一个在当前 geom 中尚未使用的 id。
 * 命名规则：{prefix}{n}，n 从 1 开始；冲突就递增。
 */
export function freshId(geom: Geometry, prefix: string): string {
  const used = new Set(geom.statements.map(s => s.id));
  let i = 1;
  while (used.has(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}

/** 是不是合法的 SSA id（DSL 用作标识符的同一套规则） */
export function isValidId(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

// ── Arg 构造捷径（电池侧高频使用） ─────────────────────────────────────

export const num    = (v: number): Arg => ({ kind: 'number', value: v });
export const str    = (v: string): Arg => ({ kind: 'string', value: v });
export const bool   = (v: boolean): Arg => ({ kind: 'bool', value: v });
export const ref    = (name: string): Arg => ({ kind: 'ref', name });
export const list   = (items: Arg[]): Arg => ({ kind: 'list', items: Object.freeze(items) });

/** 数字列表的捷径：`numList([0.1, 0.2, 0.3])` */
export const numList = (vs: number[]): Arg => list(vs.map(num));
