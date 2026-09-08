/**
 * Bake 缓存键的 canonical 序列化。
 *
 * 给定 (opName, args)，产出一个 stable 的字符串使得：
 *   - 同样的 op + 同样的参数（无论键顺序）→ 同样的字符串
 *   - 不同的 op 或不同的参数 → 不同的字符串
 *
 * 再用 sha256 摘要它，得到一个 64 位 hex —— 就是 library blob 的 alias 前缀，
 * 同时也是 URDF <mesh filename="<sha>.obj"/> 里那个 sha。
 *
 * 为什么不直接 JSON.stringify(args)？
 *   - Record 的键顺序在 V8 里多数情况下是 insertion order，但跨电池实现就不保证了：
 *     有的 op 在电池里 `args = { length, leaf_width_a, ... }`，有的反着。
 *     不规范的话同一物体两次 bake 会算出不同 sha → 缓存全失效。
 *   - DSL 里的 list 内部已经是有序的（数组），原样保留。
 */

import { createHash } from 'crypto';
import type { Arg } from './shared-types.js';
import { DEFAULT_TESSELLATION } from './types.js';

// Bake implementation changes must invalidate previously materialized OBJ blobs.
// The key is op+args, so without a version salt a fixed baker bug could still
// load an old mesh from the library under the same <sha>.obj alias.
// v3 lowers low-poly segment defaults (profile_circle/torus/dome/fan/sweep) — bump
// so previously over-tessellated blobs are re-baked.
// v4 fixes an open-curve Catmull-Rom boundary bug in curves.ts (the duplicated
// first/last control point made the first/last spline sample collapse toward the
// world origin instead of the real path endpoint, e.g. `pipe(..., spline="catmull_rom")`)
// — bump so previously mis-baked pipe/sweep meshes are re-baked.
const BAKE_CACHE_VERSION = 'baker-v4-catmullrom-boundary-fix';

/**
 * 镶嵌指纹：把全局 tessellation 容差折进 cache key。调整 DEFAULT_TESSELLATION（deflection
 * 等）后所有 sha 改变 → 磁盘上的陈旧网格自动失效，无需手动 bump version。
 */
function tessellationFingerprint(): string {
  const t = DEFAULT_TESSELLATION;
  return [
    t.linearDeflection,
    t.angularDeflection,
    t.relativeDeflection,
    t.minLinearDeflection,
    t.maxLinearDeflection,
  ].join(':');
}

export function canonicalizeBakeKey(opName: string, args: Record<string, Arg>): string {
  return JSON.stringify({
    version: BAKE_CACHE_VERSION,
    tess: tessellationFingerprint(),
    op: opName,
    args: canonicalize(args),
  });
}

export function bakeSha256(opName: string, args: Record<string, Arg>): string {
  const canon = canonicalizeBakeKey(opName, args);
  return createHash('sha256').update(canon).digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  // Arg 是 discriminated union：保留 kind 字段，其它字段递归
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const out: Record<string, unknown> = {};
  for (const k of sortedKeys) out[k] = canonicalize(obj[k]);
  return out;
}
