/**
 * g_rock —— 在 Geometry DSL 末尾追加 rock(radius, irregularity, seed, detail, stretch) 一行。
 *
 * 不规则石头/岩块 primitive：icosphere 细分 + 基于 seed 的确定性顶点位移（baker 侧实现，
 * 见 backend/src/services/baker/ops/rock.ts）。用于地形装饰/瓦砾，不是规则占位方块。
 *   - radius        基准半径（米）——必填
 *   - irregularity  凹凸幅度占半径的比例，0~1，默认 0.35
 *   - seed          整数随机种子；同参数复算形状不变，默认 0
 *   - detail        icosphere 细分级别 0~2，默认 1（越大越圆润越多面）
 *   - stretch(sx,sy,sz)  非等比拉伸，做椭圆/长条状石头，默认 [1,1,1]
 *
 * 产物是三角网格（非 OCCT 实体），不能参与 union/difference/intersection——继承
 * pipe/sweep/section_loft 的既有限制。
 */
import {
  emit,
  freshId,
  isValidId,
  makeGeometry,
  num,
  numList,
  parseGeometryPort,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

export function gRock(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();
  const fail = (error: string): Record<string, unknown> => ({ geometry: incoming, id: '', error });

  const radius = Number(input.radius ?? 0.3);
  if (!Number.isFinite(radius) || radius <= 0) return fail('rock: radius must be a positive finite number');

  const irregularity = Number(input.irregularity ?? 0.35);
  if (!Number.isFinite(irregularity) || irregularity < 0 || irregularity > 1) {
    return fail('rock: irregularity must be within [0, 1]');
  }

  const seed = Number(input.seed ?? 0);
  if (!Number.isFinite(seed)) return fail('rock: seed must be a finite number');

  const detail = Math.round(Number(input.detail ?? 1));
  if (!Number.isFinite(detail) || detail < 0 || detail > 2) return fail('rock: detail must be an integer in [0, 2]');

  const sx = Number(input.sx ?? 1);
  const sy = Number(input.sy ?? 1);
  const sz = Number(input.sz ?? 1);
  if (![sx, sy, sz].every((s) => Number.isFinite(s) && s > 0)) {
    return fail('rock: sx/sy/sz (stretch) must be positive finite numbers');
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'rock');
  if (!isValidId(id)) return fail(`invalid id "${id}" (must match [A-Za-z_][A-Za-z0-9_]*)`);

  const args: Record<string, Arg> = {
    radius: num(radius),
    irregularity: num(irregularity),
    seed: num(seed),
    detail: num(detail),
    stretch: numList([sx, sy, sz]),
  };

  const next = emit(incoming, id, 'rock', args);
  return { geometry: next, id, error: '' };
}

export default gRock;
