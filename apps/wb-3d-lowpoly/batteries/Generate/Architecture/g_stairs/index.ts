/**
 * g_stairs —— 追加 `id = stairs(total_rise=..., run=..., width=..., step_count=...)`。
 *
 * 直梯段：逐级叠高的盒体融合成实心楼梯。
 */

import {
  bool,
  emit,
  freshId,
  isValidId,
  makeGeometry,
  num,
  parseGeometryPort,
  str,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

const VALID_TYPES = new Set(['straight', 'spiral']);

export function gStairs(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const totalRise = Number(input.total_rise ?? 2.8);
  const run = Number(input.run ?? 0.28);
  const width = Number(input.width ?? 1.0);
  const stepCount = Math.round(Number(input.step_count ?? 14));
  const type = String(input.type ?? 'straight').trim().toLowerCase();
  if (![totalRise, run, width].every(Number.isFinite) || totalRise <= 0 || run <= 0 || width <= 0) {
    return { geometry: incoming, id: '', error: 'stairs: total_rise, run, width must be positive finite numbers' };
  }
  if (!Number.isFinite(stepCount) || stepCount < 1) {
    return { geometry: incoming, id: '', error: 'stairs: step_count must be >= 1' };
  }
  // `run` = 每一级踏步的进深（真实楼梯 0.2~0.4m），最容易和"整段楼梯水平总长"搞混——
  // 填错的典型症状是每级踏步被拉成几米深、整段楼梯长出 step_count 倍。>1.2m 已经不可能
  // 是单级踏步，直接拦下来并给出等价的每级 run，而不是静默生成离谱几何。
  if (run > 1.2) {
    const perStep = run / stepCount;
    return {
      geometry: incoming,
      id: '',
      error: `stairs: run=${run} looks like a total flight length, not a per-step tread depth ` +
        `(real treads are ~0.2-0.4m). If you meant a total run of ${run}m over ${stepCount} steps, ` +
        `pass run=${perStep.toFixed(3)} instead.`,
    };
  }
  if (!VALID_TYPES.has(type)) {
    return { geometry: incoming, id: '', error: `stairs: type must be straight or spiral, got "${type}"` };
  }

  const args: Record<string, Arg> = {
    total_rise: num(totalRise),
    run: num(run),
    width: num(width),
    step_count: num(stepCount),
  };

  if (type === 'spiral') {
    args.type = str('spiral');
    const radius = Number(input.radius ?? Math.max(width, 1.0));
    const innerRadius = Number(input.inner_radius ?? Math.max(0.05, radius * 0.12));
    const sweepDeg = Number(input.sweep_deg ?? 270);
    if (![radius, innerRadius].every(Number.isFinite) || radius <= 0 || innerRadius <= 0 || innerRadius >= radius) {
      return { geometry: incoming, id: '', error: 'stairs(spiral): need 0 < inner_radius < radius' };
    }
    if (!Number.isFinite(sweepDeg) || Math.abs(sweepDeg) < 1e-3) {
      return { geometry: incoming, id: '', error: 'stairs(spiral): sweep_deg must be a non-zero number' };
    }
    args.radius = num(radius);
    args.inner_radius = num(innerRadius);
    args.sweep_deg = num(sweepDeg);
  }

  const treadThickness = Number(input.tread_thickness ?? 0);
  if (Number.isFinite(treadThickness) && treadThickness > 0) args.tread_thickness = num(treadThickness);
  if (input.open_riser === true || String(input.open_riser ?? '').toLowerCase() === 'true') {
    args.open_riser = bool(true);
  }
  if (type !== 'spiral') {
    const landingDepth = Number(input.landing_depth ?? 0);
    if (Number.isFinite(landingDepth) && landingDepth > 0) {
      args.landing_depth = num(landingDepth);
      const landingAfter = Math.round(Number(input.landing_after ?? NaN));
      if (Number.isFinite(landingAfter) && landingAfter >= 1 && landingAfter <= stepCount) {
        args.landing_after = num(landingAfter);
      }
    }
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'stair');
  if (!isValidId(id)) return { geometry: incoming, id: '', error: `invalid id "${id}"` };

  return { geometry: emit(incoming, id, 'stairs', args), id };
}

export default gStairs;
