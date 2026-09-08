/**
 * GeometrySummary：geometry 端口的紧凑摘要，仅用于前端 tooltip / panel 单行展示。
 *
 * 与 scene 端口一致：wire 上传输的是原始 geometry 端口值，summary 只在前端从已有
 * 端口值本地现算（summarizeGeometry），不经过广播路径（曾经的
 * summarizeGeometryForBroadcast 已删除，无调用方）。
 *
 * Sentinel `__kind: 'geometry-summary'` 让前端 formatter 识别 + 定制渲染。
 */

import type { Geometry, Statement } from './types.js';

export interface GeometrySummary {
  readonly __kind: 'geometry-summary';
  /** 总行数（含注释/空行） */
  readonly lineCount: number;
  /** 已解析的语句数 */
  readonly statementCount: number;
  /** 按 op 分类的计数；常用：part / joint / shape primitives */
  readonly opCounts: Readonly<Record<string, number>>;
  /** 当前焦点 id（最近一条新增语句的 id），缺省时为 null */
  readonly focus: string | null;
  /** 端口版本号 */
  readonly version: number;
  /**
   * 头若干行预览 —— 给 tooltip 用，限制长度避免大文本上 WS。
   * 缺省 6 行；超出 6 行的末尾补 "... +N more"。
   */
  readonly preview: string;
}

const PREVIEW_LINES = 6;

export function summarizeGeometry(geom: Geometry): GeometrySummary {
  const opCounts: Record<string, number> = {};
  for (const s of geom.statements) {
    opCounts[s.op] = (opCounts[s.op] ?? 0) + 1;
  }

  const allLines = geom.source.split('\n');
  const lineCount = geom.source === '' ? 0 : allLines.length;

  let preview: string;
  if (allLines.length <= PREVIEW_LINES) {
    preview = geom.source;
  } else {
    const head = allLines.slice(0, PREVIEW_LINES).join('\n');
    preview = `${head}\n... +${allLines.length - PREVIEW_LINES} more`;
  }

  return {
    __kind: 'geometry-summary',
    lineCount,
    statementCount: geom.statements.length,
    opCounts: Object.freeze(opCounts),
    focus: geom.focus ?? null,
    version: geom.version,
    preview,
  };
}

export function isGeometrySummary(value: unknown): value is GeometrySummary {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { __kind?: unknown }).__kind === 'geometry-summary'
  );
}

/** tooltip / panel 共用的紧凑一行展示 */
export function formatGeometrySummary(s: GeometrySummary): string {
  const focusPart = s.focus ? ` focus=${s.focus}` : '';
  const opsList = Object.entries(s.opCounts)
    .map(([k, v]) => `${k}:${v}`)
    .join(' ');
  return `geometry lines=${s.lineCount} stmts=${s.statementCount}${focusPart} [${opsList}]`;
}

/** 把 Statement 一行格式化（不依赖 serialize.ts，避免循环依赖）—— 仅给摘要展示用。 */
export function formatStatementCompact(s: Statement): string {
  const kw = Object.entries(s.args)
    .map(([k]) => k)
    .join(',');
  return `${s.id}=${s.op}(${kw})`;
}
