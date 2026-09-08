/**
 * portRouter: 按「规则 + 参数」从多个动态输入端口中选一个，原样透传到输出。
 *
 * 输入：
 *   - rules  (string, access:tree) — 规则串，形如 [{A:2},{C:3}]：键 → 动态端口下标，按书写顺序匹配。
 *   - params (string, access:tree) — 生效键集合串，形如 (A,C)。
 *   - port_0, port_1, ... (any, access:tree) — 候选动态端口，整树透传。
 * 输出：
 *   - value (any, access:tree) — 命中规则对应下标的动态端口（port_<n>）的输入，原样透传。
 *
 * 选择逻辑：遍历规则（书写顺序），取第一个「键 ∈ 参数集合」的规则，选用其下标的端口。
 * 无命中、或该端口未连接时，不产生输出。
 *
 * 端口 access 全为 tree（无 fanout）：dispatcher 整树透传，函数只调用一次；
 * rules/params 未连线时由 meta 默认值以原始字符串注入，连线时为 DataTree，统一用 getScalar 取标量。
 */

import { DataTree } from '@forgeax/node-runtime';

function getScalar(input: Record<string, unknown>, name: string): unknown {
  const v = input[name];
  // instanceof 在跨模块动态 import 下可能失效，兼容 duck-type
  if (v instanceof DataTree) {
    for (const b of v.branches()) return b.items[0];
    return undefined;
  }
  if (v !== null && typeof v === 'object' && typeof (v as { branches?: unknown }).branches === 'function') {
    for (const b of (v as DataTree<unknown>).branches()) return b.items[0];
    return undefined;
  }
  return v;
}

function parseRules(raw: unknown): Array<{ key: string; port: number }> {
  const s = raw == null ? '' : String(raw);
  const out: Array<{ key: string; port: number }> = [];
  const re = /([A-Za-z0-9_]+)\s*:\s*(-?\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    out.push({ key: m[1], port: Number.parseInt(m[2], 10) });
  }
  return out;
}

function parseParams(raw: unknown): Set<string> {
  const s = raw == null ? '' : String(raw);
  return new Set(s.split(/[^A-Za-z0-9_]+/).filter(Boolean));
}

export function portRouter(input: Record<string, unknown>): Record<string, unknown> {
  const rules = parseRules(getScalar(input, 'rules'));
  const params = parseParams(getScalar(input, 'params'));
  if (rules.length === 0) return {};

  let selected = -1;
  for (const rule of rules) {
    if (params.has(rule.key)) {
      selected = rule.port;
      break;
    }
  }
  if (selected < 0) return {};

  const value = input[`port_${selected}`];
  if (value === undefined) return {};
  return { value };
}
