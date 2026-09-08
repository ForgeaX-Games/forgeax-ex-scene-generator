/**
 * Panels 家族 —— perforated_panel / slot_panel / vent_grille。
 *
 * 三者都是"XY 平面薄板 + 各种切槽 / 切孔"模式，所以共用一些 helper：
 *   - centeredBox：复用 brackets 的 z 居中盒
 *   - centeredAxisPositions `_centered_axis_positions`：从原点
 *     向两侧均匀展开整数个位置，使得 |pos| ≤ limit。stagger 时偶数行多偏移 pitch/2。
 *
 * vent_grille 有大量 sub-spec（slats / frame_profile / mounts /
 * sleeve），DSL 没承载它们，v1 全走默认值：
 *   - slats.profile="flat" / direction="down" / inset=0 / divider_count=0
 *   - frame_profile.style="flush" (无 chamfer/fillet 侧)
 *   - mounts.style="none"
 *   - sleeve.style="full"  → 后部带壁厚 duct_wall、深度 duct_depth 的盒套
 *
 * ⚠️ 仅供内部库使用，DSL 不可达（不是死代码）：对应的 `Generate/Parts/g_*` 电池已在
 * `3b752a7c`（"重整 Generate/Parts 为 CAD/Parts"）中删除，op-registry.ts / dsl-to-graph.ts
 * 已同步移除这些 op（见 CHANGELOG "Removed"）。这里的形状构建函数保留供内部测试直接调用。
 */

import type { OpBuilder, BakeableShape } from '../types.js';
import { BakerError } from '../errors.js';
import { csgCut, csgFuse } from '../csg_helpers.js';
import { centeredBox, maybeShiftToZ0 } from '../op_helpers.js';
import {
  optionalBool, optionalNumber, optionalString,
  readNumList, requireNumber, requireNumList,
} from '../arg_readers.js';
import type { Arg } from '../shared-types.js';

// ── 公共助手 ─────────────────────────────────────────────────────────

function filletVerticalEdges(shape: BakeableShape, r: number): BakeableShape {
  if (r <= 0) return shape;
  return shape.fillet(r, (e) => e.inDirection([0, 0, 1]));
}

/** `_centered_axis_positions`：从中点向两侧用 pitch 均匀采样。 */
function centeredAxisPositions(limit: number, pitch: number): number[] {
  if (limit < -1e-9) return [];
  if (limit <= 1e-9) return [0];
  const count = Math.floor((2 * limit) / pitch) + 1;
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, i) => (i - (count - 1) * 0.5) * pitch);
}

/** pitch 可以是 number 或 [px, py]；都规整化成 (px, py)。 */
function normalizePitch2D(args: Record<string, Arg>): [number, number] {
  const raw = args.pitch;
  if (!raw) throw new BakerError('panel: pitch required');
  if (raw.kind === 'number') return [raw.value, raw.value];
  if (raw.kind === 'list') {
    const items = readNumList(raw, 2);
    if (!items) throw new BakerError('panel: pitch list must be 2 numbers [px, py]');
    return [items[0], items[1]];
  }
  throw new BakerError('panel: pitch must be number or [px, py]');
}

// ── perforated_panel ───────────────────────────────────────────────

export const perforatedPanel: OpBuilder = (ctx, args) => {
  const [w, h]    = requireNumList(args, 'panel_size', 2, 'perforated_panel');
  const t         = requireNumber(args, 'thickness', 'perforated_panel');
  const holeD     = requireNumber(args, 'hole_diameter', 'perforated_panel');
  const [px, py]  = normalizePitch2D(args);
  const frame     = optionalNumber(args, 'frame', 0.008);
  const cornerR   = optionalNumber(args, 'corner_radius', 0);
  const stagger   = optionalBool(args, 'stagger', false);

  if (w <= 0 || h <= 0 || t <= 0)         throw new BakerError('perforated_panel: panel_size and thickness must be positive');
  if (holeD <= 0)                          throw new BakerError('perforated_panel: hole_diameter must be positive');
  if (frame < 0 || frame >= Math.min(w, h) * 0.5)
    throw new BakerError('perforated_panel: frame must be >=0 and < half of min(panel_size)');
  if (px <= holeD || py <= holeD)
    throw new BakerError('perforated_panel: pitch must be > hole_diameter on both axes');

  const holeR  = holeD * 0.5;
  const xLimit = w * 0.5 - frame - holeR;
  const yLimit = h * 0.5 - frame - holeR;
  if (xLimit < -1e-9 || yLimit < -1e-9)
    throw new BakerError('perforated_panel: frame/hole_diameter leave no usable area');

  let shape = centeredBox(ctx, w, h, t);
  shape = filletVerticalEdges(shape, Math.min(cornerR, w * 0.5 - 1e-4, h * 0.5 - 1e-4));

  // 算所有 (x,y) 钻孔位置
  const cutDepth = t + Math.max(0.002, t * 0.5);
  const yPositions = centeredAxisPositions(yLimit, py);
  if (yPositions.length === 0)
    throw new BakerError('perforated_panel: no rows fit');

  let anyCut = false;
  for (let rowIdx = 0; rowIdx < yPositions.length; rowIdx++) {
    const y = yPositions[rowIdx];
    const xOffset = stagger && rowIdx % 2 === 1 ? px * 0.5 : 0;
    const rowLimit = xLimit - Math.abs(xOffset);
    if (rowLimit < -1e-9) continue;
    const xPositions = centeredAxisPositions(rowLimit, px);
    for (const x of xPositions) {
      const hole = ctx.replicad.makeCylinder(
        holeR, cutDepth, [x + xOffset, y, -cutDepth * 0.5], [0, 0, 1],
      ) as BakeableShape;
      shape = csgCut(shape, hole);
      anyCut = true;
    }
  }
  if (!anyCut) throw new BakerError('perforated_panel: no perforations fit panel');

  return maybeShiftToZ0(shape, t, args);
};

// ── slot_panel ─────────────────────────────────────────────────────

export const slotPanel: OpBuilder = (ctx, args) => {
  const [w, h]      = requireNumList(args, 'panel_size', 2, 'slot_panel');
  const t           = requireNumber(args, 'thickness', 'slot_panel');
  const [sLen, sWid] = requireNumList(args, 'slot_size', 2, 'slot_panel');
  const [px, py]    = normalizePitch2D(args);
  const frame       = optionalNumber(args, 'frame', 0.008);
  const cornerR     = optionalNumber(args, 'corner_radius', 0);
  const slotAngleDeg = optionalNumber(args, 'slot_angle_deg', 0);
  const stagger     = optionalBool(args, 'stagger', false);

  if (w <= 0 || h <= 0 || t <= 0)         throw new BakerError('slot_panel: panel_size and thickness must be positive');
  if (sLen <= 0 || sWid <= 0)              throw new BakerError('slot_panel: slot_size values must be positive');
  if (sLen < sWid)                          throw new BakerError('slot_panel: slot_size[0] must be >= slot_size[1]');
  if (frame < 0 || frame >= Math.min(w, h) * 0.5)
    throw new BakerError('slot_panel: frame must be >=0 and < half of min(panel_size)');
  if (Math.abs(slotAngleDeg) >= 90)
    throw new BakerError('slot_panel: |slot_angle_deg| must be < 90');

  const a = slotAngleDeg * Math.PI / 180;
  const slotHalfX = 0.5 * (Math.abs(sLen * Math.cos(a)) + Math.abs(sWid * Math.sin(a)));
  const slotHalfY = 0.5 * (Math.abs(sLen * Math.sin(a)) + Math.abs(sWid * Math.cos(a)));
  if (px <= 2 * slotHalfX || py <= 2 * slotHalfY)
    throw new BakerError('slot_panel: pitch must be greater than rotated slot envelope');

  const xLimit = w * 0.5 - frame - slotHalfX;
  const yLimit = h * 0.5 - frame - slotHalfY;
  if (xLimit < -1e-9 || yLimit < -1e-9)
    throw new BakerError('slot_panel: frame/slot_size leave no usable area');

  let shape = centeredBox(ctx, w, h, t);
  shape = filletVerticalEdges(shape, Math.min(cornerR, w * 0.5 - 1e-4, h * 0.5 - 1e-4));

  const cutDepth = t + Math.max(0.002, t * 0.5);
  const slotCoreLen = Math.max(sLen - sWid, 0);

  function buildSlotCut(cx: number, cy: number): BakeableShape {
    const capR = sWid * 0.5;
    const capOff = slotCoreLen * 0.5;

    const leftCap = ctx.replicad.makeCylinder(capR, cutDepth, [-capOff, 0, -cutDepth * 0.5], [0, 0, 1]) as BakeableShape;
    const rightCap = ctx.replicad.makeCylinder(capR, cutDepth, [capOff, 0, -cutDepth * 0.5], [0, 0, 1]) as BakeableShape;
    let cut: BakeableShape = csgFuse(leftCap, rightCap);

    if (slotCoreLen > 1e-6) {
      const mid = centeredBox(ctx, slotCoreLen, sWid, cutDepth);
      cut = csgFuse(cut, mid);
    }

    const rotated = cut.rotate(slotAngleDeg, [0, 0, 0], [0, 0, 1]);
    try { cut.delete(); } catch { /* already handled */ }
    const translated = rotated.translate(cx, cy, 0);
    try { rotated.delete(); } catch { /* already handled */ }
    return translated;
  }

  const yPositions = centeredAxisPositions(yLimit, py);
  let anyCut = false;
  for (let rowIdx = 0; rowIdx < yPositions.length; rowIdx++) {
    const y = yPositions[rowIdx];
    const xOffset = stagger && rowIdx % 2 === 1 ? px * 0.5 : 0;
    const rowLimit = xLimit - Math.abs(xOffset);
    if (rowLimit < -1e-9) continue;
    const xPositions = centeredAxisPositions(rowLimit, px);
    for (const x of xPositions) {
      const cut = buildSlotCut(x + xOffset, y);
      shape = csgCut(shape, cut);
      anyCut = true;
    }
  }
  if (!anyCut) throw new BakerError('slot_panel: no slots fit panel');

  return maybeShiftToZ0(shape, t, args);
};

// ── vent_grille ────────────────────────────────────────────────────

export const ventGrille: OpBuilder = (ctx, args) => {
  const [w, h]      = requireNumList(args, 'panel_size', 2, 'vent_grille');
  const frame       = optionalNumber(args, 'frame', 0.012);
  const faceT       = optionalNumber(args, 'face_thickness', 0.004);
  const ductDepth   = optionalNumber(args, 'duct_depth', 0.026);
  const ductWall    = optionalNumber(args, 'duct_wall', 0.003);
  const slatPitch   = optionalNumber(args, 'slat_pitch', 0.018);
  const slatWidth   = optionalNumber(args, 'slat_width', 0.009);
  const slatAngleDeg = optionalNumber(args, 'slat_angle_deg', 35);
  const slatT       = optionalNumber(args, 'slat_thickness', Math.max(0.001, faceT * 0.35));
  const cornerR     = optionalNumber(args, 'corner_radius', 0);

  if (w <= 0 || h <= 0)                    throw new BakerError('vent_grille: panel_size must be positive');
  if (faceT <= 0 || ductDepth <= 0 || ductWall <= 0)
    throw new BakerError('vent_grille: face_thickness, duct_depth, and duct_wall must be positive');
  if (frame <= 0 || frame >= Math.min(w, h) * 0.5)
    throw new BakerError('vent_grille: frame must be >0 and < half of min(panel_size)');
  if (slatPitch <= 0 || slatWidth <= 0 || slatT <= 0)
    throw new BakerError('vent_grille: slat_pitch, slat_width, and slat_thickness must be positive');
  if (slatPitch <= slatWidth)
    throw new BakerError('vent_grille: slat_pitch must be greater than slat_width');

  const openingW = w - 2 * frame;
  const openingH = h - 2 * frame;
  if (openingW <= 2 * ductWall || openingH <= 2 * ductWall)
    throw new BakerError('vent_grille: frame/duct_wall leave no open sleeve area');

  // 排满 slat 行
  const slatRows: number[] = [];
  let y0 = -openingH * 0.5 + slatPitch * 0.5;
  const limitY = openingH * 0.5 - slatPitch * 0.5;
  while (y0 <= limitY + 1e-9) { slatRows.push(y0); y0 += slatPitch; }
  if (slatRows.length === 0)
    throw new BakerError('vent_grille: no slat rows fit panel; increase panel height or reduce slat_pitch');

  // v1 simplifying defaults: sleeve.style="full", mounts="none", frame_profile="flush"
  let shape: BakeableShape = centeredBox(ctx, w, h, faceT);
  shape = filletVerticalEdges(
    shape,
    Math.min(cornerR, w * 0.5 - frame, h * 0.5 - frame),
  );

  // 中央开口
  const openingCut = centeredBox(ctx, openingW, openingH, faceT + Math.max(0.002, faceT * 0.5));
  shape = csgCut(shape, openingCut);

  // 后部 sleeve（壳）
  const sleeveDepth = ductDepth;
  const ductOuter = centeredBox(ctx, openingW, openingH, sleeveDepth);
  const ductInner = centeredBox(ctx, openingW - 2 * ductWall, openingH - 2 * ductWall, sleeveDepth + faceT + 0.004);
  let ductShell: BakeableShape = csgCut(ductOuter, ductInner);
  const ductShellMoved = ductShell.translateZ(-faceT * 0.5 - sleeveDepth * 0.5 + Math.min(faceT * 0.25, 0.001));
  try { ductShell.delete(); } catch { /* already handled */ }
  ductShell = ductShellMoved;
  shape = csgFuse(shape, ductShell);

  const directionStr = optionalString(args, 'slat_direction', 'down');
  const angleSign = directionStr === 'up' ? 1 : -1;
  const slatAngleSigned = Math.abs(slatAngleDeg) * angleSign;
  const slatEmbed = Math.min(frame * 0.5, 0.002);
  const slatChord = Math.max(1e-4, openingW + 2 * slatEmbed);
  const slatZ = -faceT * 0.25;

  for (const rowY of slatRows) {
    const slatBase = centeredBox(ctx, slatChord, slatWidth, slatT);
    const slatRotated = slatBase.rotate(slatAngleSigned, [0, 0, 0], [1, 0, 0]);
    try { slatBase.delete(); } catch { /* ignore */ }
    const slat = slatRotated.translate(0, rowY, slatZ);
    try { slatRotated.delete(); } catch { /* ignore */ }
    shape = csgFuse(shape, slat);
  }

  return maybeShiftToZ0(shape, faceT, args);
};
