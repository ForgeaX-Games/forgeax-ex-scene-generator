/**
 * g_preview —— 几何 DSL 文本预览电池。
 *
 * 行为：
 *   - 接收上游 Geometry 输入（端口名 input，与 name_list_panel UI 约定一致）
 *   - 提取 DSL 源码：优先用 geometry.source；缺失时按 statements 重建
 *   - 输出端口名 output，承载格式化后的字符串；NameListPanelNode 直接渲染该字符串
 *
 * 设计要点：
 *   - 复用 name_list_panel 节点 UI（meta.frontend.nodeType = 'name_list_panel'）
 *     该面板对非 JSON 字符串原样显示，因此 DSL 源码会以代码块的形式呈现
 *   - 输入空 geometry → 输出空字符串（面板上显示 "[]" 占位由 UI 处理）
 *   - 不修改上游数据，纯函数
 */

import {
  isGeometry,
  type Arg,
  type Geometry,
  type Statement,
} from '../../../../vendor/dist/shared/types/index.js';

export function gPreview(input: Record<string, unknown>): Record<string, unknown> {
  const val = input.input;
  if (val === undefined || val === null) return { output: '' };

  if (!isGeometry(val)) {
    return { output: typeof val === 'string' ? val : JSON.stringify(val, null, 2) };
  }

  const geom = val as Geometry;

  // source 字段是用户/上游写入的原始 DSL 文本（append 时也会维护）。
  // 若 source 已经是非空字符串，则直接展示——保留注释、空行、原始排版。
  if (typeof geom.source === 'string' && geom.source.trim().length > 0) {
    return { output: geom.source };
  }

  // 兜底：source 为空时按 statements 重建一段紧凑的 DSL，便于诊断
  // “上游产出了语句但 source 缺失”这类边界情况。
  const text = renderStatements(geom.statements);
  return { output: text };
}

function renderStatements(statements: readonly Statement[]): string {
  if (!statements || statements.length === 0) return '';
  return statements.map(renderStatement).join('\n');
}

function renderStatement(s: Statement): string {
  const argParts: string[] = [];
  for (const [k, v] of Object.entries(s.args)) {
    argParts.push(`${k}=${renderArg(v)}`);
  }
  if (s.id && !argParts.some((p) => p.startsWith('id='))) {
    argParts.push(`id=${JSON.stringify(s.id)}`);
  }
  return `${s.op}(${argParts.join(', ')})`;
}

function renderArg(a: Arg): string {
  switch (a.kind) {
    case 'number':
      return formatNumber(a.value);
    case 'string':
      return JSON.stringify(a.value);
    case 'bool':
      return a.value ? 'true' : 'false';
    case 'ref':
      return a.name;
    case 'list':
      return `[${a.items.map(renderArg).join(', ')}]`;
  }
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(6).replace(/\.?0+$/, '');
}

export default gPreview;
