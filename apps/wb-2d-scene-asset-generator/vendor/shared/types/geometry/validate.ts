/**
 * Geometry 语义校验：parse 之后跑一遍 statements，检查
 *   1. id 唯一（SSA 约束）
 *   2. ref 指向已定义且在当前语句之前的 id（前向无依赖）
 *   3. op 在 op-registry 里登记
 *   4. 必填参数齐全 + 参数 kind 匹配
 *
 * 与 parser 的分工：parser 只管语法；validate 管语义。
 * 永不抛异常；返回 errors 数组（parser 错也会一并报告，便于一次性诊断）。
 */

import type { Arg, GeometryError, Statement } from './types.js';
import { argMatchesKind, getOpSpec } from './op-registry.js';

export interface ValidateResult {
  ok: boolean;
  errors: GeometryError[];
}

export function validateStatements(stmts: readonly Statement[]): ValidateResult {
  const errors: GeometryError[] = [];
  const known = new Set<string>();

  for (const stmt of stmts) {
    // 1. id 唯一
    if (known.has(stmt.id)) {
      errors.push({
        message: `duplicate id "${stmt.id}"`,
        line: stmt.line,
        kind: 'duplicate-id',
      });
    } else {
      known.add(stmt.id);
    }

    // 2. op 已注册
    const spec = getOpSpec(stmt.op);
    if (!spec) {
      errors.push({
        message: `unknown op "${stmt.op}"`,
        line: stmt.line,
        kind: 'unknown-op',
      });
      continue;
    }

    // 3. 必填参数检查
    for (const param of spec.params) {
      if (param.required && !(param.name in stmt.args)) {
        errors.push({
          message: `op "${stmt.op}" missing required argument "${param.name}"`,
          line: stmt.line,
          kind: 'bad-arg',
        });
      }
    }

    // 4. 参数 kind 检查 + 未知参数检查 + ref 指向校验
    const allowed = new Set(spec.params.map(p => p.name));
    for (const [k, v] of Object.entries(stmt.args)) {
      if (!allowed.has(k)) {
        errors.push({
          message: `op "${stmt.op}" got unknown argument "${k}"`,
          line: stmt.line,
          kind: 'bad-arg',
        });
        continue;
      }
      const param = spec.params.find(p => p.name === k)!;
      if (!param.kinds.some(kind => argMatchesKind(v, kind))) {
        errors.push({
          message: `op "${stmt.op}" arg "${k}" expects ${param.kinds.join('|')}, got ${v.kind}`,
          line: stmt.line,
          kind: 'bad-arg',
        });
      }
      // ref 类参数 / 列表里嵌套的 ref 都要回查 known
      checkRefs(v, known, stmt.line, errors);
    }
  }

  return { ok: errors.length === 0, errors };
}

function checkRefs(
  arg: Arg,
  known: ReadonlySet<string>,
  line: number,
  errors: GeometryError[],
): void {
  if (arg.kind === 'ref') {
    if (!known.has(arg.name)) {
      errors.push({
        message: `reference to undefined id "${arg.name}"`,
        line,
        kind: 'unknown-ref',
      });
    }
  } else if (arg.kind === 'list') {
    for (const item of arg.items) checkRefs(item, known, line, errors);
  }
}
