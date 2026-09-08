import type { Diagnostic } from './apply-batch-types.js'

// 2026-07-01 复盘 (postmortem): Sino 在一次场景搭建 session 里把 createNode 的
// 节点 id 字段写成了 `id`（内核 Op 类型只认 `nodeId`）。`applyBatch` 的 HTTP 边界
// 对 ops 数组只有 TS 类型、没有真正的运行时 schema 校验（`ops as never`），于是
// `op.nodeId` 实际是 `undefined`——而 JS 允许用 `undefined` 当对象 key（会被强转
// 成字符串 "undefined"），旧代码在这里毫无防御地直接
// `graph.nodes[op.nodeId] = {...}`，静默造出一个 id 字面量是 "undefined" 的
// "僵尸节点"，`applyBatch` 还照样回 `status:'ok'`。Sino 之后所有想连到这个节点
// "真实" id（比如 "seed"）的 op 全部查无此节点，只能反复试错才能定位到问题出在
// 最初那次 createNode 用错了字段名。`requireIdentifier` 把"标识符字段缺失/类型
// 错误"在第一时间变成一条指名 opIndex + 期望字段名（命中同批次常见别名如 `id`
// 时还会给出提示）的显式错误，绝不再让 undefined 静默溜进图里。
export function requireIdentifier(
  rec: Record<string, unknown>,
  field: string,
  opType: string,
  opIndex: number,
  aliasCandidates: readonly string[] = ['id'],
): Diagnostic | null {
  const value = rec[field]
  if (typeof value === 'string' && value.trim().length > 0) return null
  const hitAlias = aliasCandidates.find(
    (a) => a !== field && typeof rec[a] === 'string' && (rec[a] as string).trim().length > 0,
  )
  const gotDesc = value === undefined ? 'missing' : `invalid value ${JSON.stringify(value)}`
  const aliasHint = hitAlias
    ? ` — this op has a "${hitAlias}" field instead; the required field name for ${opType} is "${field}", not "${hitAlias}"`
    : ''
  return {
    opIndex,
    severity: 'error',
    message: `${opType} op[${opIndex}] is missing a valid "${field}" (${gotDesc})${aliasHint}`,
  }
}

/** Loud diagnostic for a connect/disconnect endpoint that resolves to no live node — see requireIdentifier's 2026-07-01 postmortem note above: this is the other half of the same failure mode (a LATER op referencing an id that was never actually created). */
export function unresolvedNodeRef(opIndex: number, opType: string, field: string, nodeId: string): Diagnostic {
  return {
    opIndex,
    severity: 'error',
    message:
      `${opType} op[${opIndex}]: "${field}" nodeId "${nodeId}" does not exist — not created earlier in this ` +
      'batch and not present in the existing graph. Check for a field-name typo in the createNode op that ' +
      'was supposed to create it (e.g. "id" instead of "nodeId"), or a plain id mismatch.',
  }
}
