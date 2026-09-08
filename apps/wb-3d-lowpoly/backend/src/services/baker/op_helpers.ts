/**
 * Op builder 共享几何助手 —— 把此前散落在各家族 ops/*.ts 里逐字重复的工具
 * （safeDelete / maybeShiftToZ0 / centeredBox / boxFloor / drawingFromPoints）
 * 收敛到一处，杜绝实现漂移。
 *
 * 约定（与既有 box/cylinder/sphere 对齐）：
 *   - 单位 = 米，Z 朝上；
 *   - 形状默认 X/Y 居中；center=true（默认）时 Z 也居中，center=false 时底面贴 Z=0。
 */

import type { BakeableShape, OpContext } from './types.js';
import { BakerError } from './errors.js';
import { optionalBool } from './arg_readers.js';
import type { Arg } from './shared-types.js';

/** 安全释放 OCCT WASM 堆上的对象。失败时静默（对象可能已被回收，不中断业务流）。 */
export function safeDelete(obj: unknown): void {
  try {
    (obj as { delete?: () => void } | null | undefined)?.delete?.();
  } catch {
    /* OCCT 对象可能已被回收 */
  }
}

/**
 * 处理 center=false：把整个 shape 沿 +Z 平移 h/2，使底面贴 Z=0。
 * center=true（默认）时原样返回（构造时已 Z 居中）。
 */
export function maybeShiftToZ0(
  shape: BakeableShape,
  h: number,
  args: Record<string, Arg>,
): BakeableShape {
  const center = optionalBool(args, 'center', true);
  return center ? shape : shape.translateZ(h / 2);
}

/** 全轴居中盒：X/Y 居中、Z∈[-h/2, h/2]。 */
export function centeredBox(ctx: OpContext, w: number, d: number, h: number): BakeableShape {
  return ctx.replicad.makeBaseBox(w, d, h).translateZ(-h / 2) as BakeableShape;
}

/** 贴地盒：X/Y 居中、Z∈[0, h]（底面落在 Z=0，makeBaseBox 的原生行为）。 */
export function boxFloor(ctx: OpContext, w: number, d: number, h: number): BakeableShape {
  return ctx.replicad.makeBaseBox(w, d, h) as BakeableShape;
}

/** `.close()` 返回的闭合 Drawing 类型（有 sketchOnPlane / cut 等方法）。 */
export type ClosedDrawing = ReturnType<ReturnType<OpContext['replicad']['draw']>['close']>;

/** 把一个 2D 点列（>=3 个，CCW）转成已 close 的 replicad Drawing。 */
export function drawingFromPoints(
  ctx: OpContext,
  points: Array<readonly [number, number]>,
): ClosedDrawing {
  if (points.length < 3) throw new BakerError('profile must contain at least 3 points');
  const pen = ctx.replicad.draw([points[0][0], points[0][1]]);
  for (let i = 1; i < points.length; i++) pen.lineTo([points[i][0], points[i][1]]);
  return pen.close();
}
