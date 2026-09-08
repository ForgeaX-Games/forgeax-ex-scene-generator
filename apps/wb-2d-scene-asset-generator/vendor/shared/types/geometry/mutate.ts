/**
 * Geometry mutate helpers —— 在原 SSA Geometry 之上做"小手术"返回新 Geometry。
 *
 * 设计要点：
 *   - 严格保持 SSA：不增加 / 重命名 statement，只就地改写其 args
 *   - 输入 Geometry 不可变；返回的新 Geometry 也是冻结的（与 makeGeometry 一致）
 *   - source 由 statements 重新序列化生成；行号自动重排（geometryFromSource 解析后重建）
 *
 * 当前提供的算子：
 *   - withPartOrigin(geom, partId, [ox,oy,oz])  — 改写 part 的 origin（list of 3 numbers）
 *   - withPartPose(geom, partId, origin, rpy?)   — 同时改写 part 的 origin / rpy
 *
 * 适用电池：
 *   - g_align_centers / g_place_on_face：算出原点偏移后，把它写回 child part 的 origin
 *     输出新的 Geometry，让用户后续可以直接接 g_to_urdf / g_preview，无需手动把 ox/oy/oz
 *     再插回上游 g_part。
 */

import type { Arg, Geometry, Statement } from './types.js';
import { list, num } from './make.js';
import { geometryFromSource } from './make.js';
import { formatStatements } from './serialize.js';

/**
 * 返回一份新的 Geometry，把 partId 对应的 part 语句的 `origin` 参数改写为
 * `[ox, oy, oz]`。其它 part / shape / joint / material 全部原样保留。
 *
 * 找不到 partId 或目标 op 不是 'part' → 抛异常（避免静默丢失偏移）。
 *
 * 注意：source 会被重新序列化，原 source 中的注释 / 空行 / 自定义排版都会丢失；
 * 这是当前 articraft 风格 placement 工具链的可接受代价 —— DSL 主导是 statements，
 * source 仅做诊断展示。后续如果需要保留原始排版，可以走"按行替换"的更精细路径。
 */
export function withPartOrigin(
  geom: Geometry,
  partId: string,
  origin: readonly [number, number, number],
): Geometry {
  return withPartPose(geom, partId, origin);
}

/** 返回一份新的 Geometry，把 partId 对应 part 的 `origin` / `rpy` 参数改写。 */
export function withPartPose(
  geom: Geometry,
  partId: string,
  origin: readonly [number, number, number],
  rpy?: readonly [number, number, number],
): Geometry {
  const target = geom.statements.find(s => s.id === partId);
  if (!target) {
    throw new Error(`withPartPose: part id "${partId}" not found in geometry`);
  }
  if (target.op !== 'part') {
    throw new Error(`withPartPose: id "${partId}" is op "${target.op}", expected "part"`);
  }

  const newOrigin: Arg = list([num(origin[0]), num(origin[1]), num(origin[2])]);
  const newRpy: Arg | undefined = rpy ? list([num(rpy[0]), num(rpy[1]), num(rpy[2])]) : undefined;

  const newStatements: Statement[] = geom.statements.map((s) => {
    if (s.id !== partId) return s;
    const newArgs: Record<string, Arg> = { ...s.args, origin: newOrigin };
    if (newRpy) newArgs.rpy = newRpy;
    return Object.freeze({
      ...s,
      args: Object.freeze(newArgs),
    }) as Statement;
  });

  // 用 statements 重新串成 source，再 parse 一遍以恢复严格 SSA + 重新计算 line。
  // 这条路径与 emit/append 的语义对齐，是最保险的"重写一行 args"方法。
  const newSource = formatStatements(newStatements);
  return geometryFromSource(newSource);
}
