/**
 * Arg 读取助手——把 DSL Arg 拆成 TS 原生值。
 *
 * 与 g_to_urdf/index.ts 里同名 helper 是一对兄弟：那边读 part/joint 参数生成
 * URDF XML，这边读 shape 参数喂给 OCCT 几何函数。两边语义一致，本仓库内重复实现
 * 是因为电池层 (materials/) 和服务层 (backend/) 不允许互相 import。
 *
 * required 系列：缺值时抛 BakerError —— baker.service 会把它包成有用的错误信息
 * 返回给上层，不让它继续把 NaN / undefined 喂给 OCCT 导致 segfault。
 */

import type { Arg } from './shared-types.js';
import { BakerError } from './errors.js';

export function readNumber(a: Arg | undefined): number | undefined {
  if (!a || a.kind !== 'number') return undefined;
  return Number.isFinite(a.value) ? a.value : undefined;
}

export function readBool(a: Arg | undefined): boolean | undefined {
  if (!a || a.kind !== 'bool') return undefined;
  return a.value;
}

export function readString(a: Arg | undefined): string | undefined {
  if (!a || a.kind !== 'string') return undefined;
  return a.value;
}

export function readNumList(a: Arg | undefined, n?: number): number[] | undefined {
  if (!a || a.kind !== 'list') return undefined;
  const out: number[] = [];
  for (const item of a.items) {
    if (item.kind !== 'number' || !Number.isFinite(item.value)) return undefined;
    out.push(item.value);
  }
  if (n !== undefined && out.length !== n) return undefined;
  return out;
}

// ── required 系列：缺则抛 ──────────────────────────────────────────────

export function requireNumber(args: Record<string, Arg>, name: string, op: string): number {
  const v = readNumber(args[name]);
  if (v === undefined) {
    throw new BakerError(`${op}: required param "${name}" missing or not a finite number`);
  }
  return v;
}

export function requireNumList(
  args: Record<string, Arg>,
  name: string,
  n: number,
  op: string,
): number[] {
  const v = readNumList(args[name], n);
  if (!v) {
    throw new BakerError(`${op}: required param "${name}" missing or not a list of ${n} numbers`);
  }
  return v;
}

export function optionalNumber(
  args: Record<string, Arg>,
  name: string,
  fallback: number,
): number {
  const v = readNumber(args[name]);
  return v === undefined ? fallback : v;
}

export function optionalBool(
  args: Record<string, Arg>,
  name: string,
  fallback: boolean,
): boolean {
  const v = readBool(args[name]);
  return v === undefined ? fallback : v;
}

export function optionalString(
  args: Record<string, Arg>,
  name: string,
  fallback: string,
): string {
  const v = readString(args[name]);
  return v === undefined ? fallback : v;
}
