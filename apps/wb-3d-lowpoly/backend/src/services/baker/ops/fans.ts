/**
 * Fans 家族 —— fan_rotor / blower_wheel。
 *
 * DSL 暴露的子集只包含 body 几何，没有 FanRotorBlade / FanRotorHub /
 * FanRotorShroud / BlowerWheel 之子规格。v1 全部使用默认值：
 *   fan_rotor : blade.shape=straight, hub.style=flat, no shroud, no bore
 *   blower_wheel: 跳过 drum_window 切口（次要可视细节，主拓扑不影响）
 *
 * 几何沿 Z 轴居中，center=false 时整体上移 +h/2（h = fan_rotor 的 thickness 或
 * blower_wheel 的 width）。
 *
 * ⚠️ 仅供内部库使用，DSL 不可达（不是死代码）：对应的 `Generate/Parts/g_*` 电池已在
 * `3b752a7c`（"重整 Generate/Parts 为 CAD/Parts"）中删除，op-registry.ts / dsl-to-graph.ts
 * 已同步移除这些 op（见 CHANGELOG "Removed"）。这里的形状构建函数保留供内部测试直接调用。
 */

import type { OpBuilder, BakeableShape, BakeProduct, OpContext } from '../types.js';
import { BakerError } from '../errors.js';
import { csgFuse } from '../csg_helpers.js';
import { optionalBool, optionalNumber, requireNumber } from '../arg_readers.js';
import type { Arg } from '../shared-types.js';
import {
  combineMeshes,
  rotateMesh,
  sectionLoftMesh,
  translateMesh,
  type Vec3,
} from '../curves.js';
import type { MeshGeometry } from '../types.js';

// ── 公共助手 ─────────────────────────────────────────────────────────

function maybeShiftToZ0(shape: BakeProduct, h: number, args: Record<string, Arg>): BakeProduct {
  const center = optionalBool(args, 'center', true);
  return center
    ? shape
    : isMesh(shape) ? translateMesh(shape, [0, 0, h / 2]) : shape.translateZ(h / 2);
}

/** 等价 cadquery `circle(rOuter).circle(rInner).extrude(h*0.5, both=True)`。
 * rInner==0 时退化为实心圆柱（不做 2D cut，避免 OCCT 在零半径上抛错）。 */
function annulusExtrudeBoth(
  ctx: OpContext,
  rOuter: number,
  rInner: number,
  height: number,
  baseZ = -height * 0.5,
): BakeableShape {
  if (rInner <= 1e-9) {
    return ctx.replicad.makeCylinder(rOuter, height, [0, 0, baseZ], [0, 0, 1]);
  }
  const ring = ctx.replicad.drawCircle(rOuter).cut(ctx.replicad.drawCircle(rInner));
  type SolidSketch = { extrude: (d: number) => BakeableShape };
  return (ring.sketchOnPlane('XY', baseZ) as unknown as SolidSketch).extrude(height);
}

/** 等价 cadquery `polyline(points).close().extrude(h*0.5, both=True).translate(0,0,zOff)`。 */
function polylineExtrudeBoth(
  ctx: OpContext,
  points: [number, number][],
  height: number,
  zOff = 0,
): BakeableShape {
  if (points.length < 3) throw new BakerError('fans: polyline needs at least 3 points');
  const pen = ctx.replicad.draw(points[0]);
  for (let i = 1; i < points.length; i++) pen.lineTo(points[i]);
  const drawing = pen.close();
  const baseZ = zOff - height * 0.5;
  type SolidSketch = { extrude: (d: number) => BakeableShape };
  return (drawing.sketchOnPlane('XY', baseZ) as unknown as SolidSketch).extrude(height);
}

function isMesh(shape: BakeProduct): shape is MeshGeometry {
  return (shape as MeshGeometry).kind === 'mesh_geometry';
}

function zAxisAnnulusMesh(
  rOuter: number,
  rInner: number,
  height: number,
  baseZ = -height * 0.5,
  segments = 16,
): MeshGeometry {
  const vertices: Vec3[] = [];
  const faces: Array<readonly [number, number, number]> = [];
  const z0 = baseZ;
  const z1 = baseZ + height;

  if (rInner <= 1e-9) {
    const bottomCenter = vertices.push([0, 0, z0]) - 1;
    const topCenter = vertices.push([0, 0, z1]) - 1;
    const bottom: number[] = [];
    const top: number[] = [];
    for (let i = 0; i < segments; i++) {
      const a = (Math.PI * 2 * i) / segments;
      const x = Math.cos(a) * rOuter;
      const y = Math.sin(a) * rOuter;
      bottom.push(vertices.push([x, y, z0]) - 1);
      top.push(vertices.push([x, y, z1]) - 1);
    }
    for (let i = 0; i < segments; i++) {
      const ni = (i + 1) % segments;
      faces.push([bottom[i], bottom[ni], top[ni]]);
      faces.push([bottom[i], top[ni], top[i]]);
      faces.push([bottomCenter, bottom[i], bottom[ni]]);
      faces.push([topCenter, top[ni], top[i]]);
    }
    return { kind: 'mesh_geometry', vertices, faces };
  }

  const ob: number[] = [];
  const ot: number[] = [];
  const ib: number[] = [];
  const it: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (Math.PI * 2 * i) / segments;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    ob.push(vertices.push([ca * rOuter, sa * rOuter, z0]) - 1);
    ot.push(vertices.push([ca * rOuter, sa * rOuter, z1]) - 1);
    ib.push(vertices.push([ca * rInner, sa * rInner, z0]) - 1);
    it.push(vertices.push([ca * rInner, sa * rInner, z1]) - 1);
  }
  for (let i = 0; i < segments; i++) {
    const ni = (i + 1) % segments;
    faces.push([ob[i], ob[ni], ot[ni]]);
    faces.push([ob[i], ot[ni], ot[i]]);
    faces.push([ib[i], it[ni], ib[ni]]);
    faces.push([ib[i], it[i], it[ni]]);
    faces.push([ot[i], ot[ni], it[ni]]);
    faces.push([ot[i], it[ni], it[i]]);
    faces.push([ob[i], ib[ni], ob[ni]]);
    faces.push([ob[i], ib[i], ib[ni]]);
  }
  return { kind: 'mesh_geometry', vertices, faces };
}

// ── fan_rotor ──────────────────────────────────────────────────────

export const fanRotor: OpBuilder = (ctx, args) => {
  const outerR  = requireNumber(args, 'outer_radius', 'fan_rotor');
  const hubR    = requireNumber(args, 'hub_radius', 'fan_rotor');
  const bladeCt = Math.round(requireNumber(args, 'blade_count', 'fan_rotor'));
  const thickness = requireNumber(args, 'thickness', 'fan_rotor');
  const pitchDeg  = optionalNumber(args, 'blade_pitch_deg', 28);
  const sweepDeg  = optionalNumber(args, 'blade_sweep_deg', 20);
  let rootChord   = optionalNumber(args, 'blade_root_chord', 0);
  let tipChord    = optionalNumber(args, 'blade_tip_chord', 0);

  if (outerR <= 0 || hubR <= 0 || thickness <= 0)
    throw new BakerError('fan_rotor: outer_radius, hub_radius, and thickness must be positive');
  if (bladeCt < 2) throw new BakerError('fan_rotor: blade_count must be at least 2');
  if (hubR >= outerR) throw new BakerError('fan_rotor: hub_radius must be less than outer_radius');
  if (Math.abs(pitchDeg) >= 85) throw new BakerError('fan_rotor: |blade_pitch_deg| must be < 85');
  if (Math.abs(sweepDeg) >= 85) throw new BakerError('fan_rotor: |blade_sweep_deg| must be < 85');

  const radialSpan = outerR - hubR;
  if (rootChord <= 0) rootChord = Math.max(radialSpan * 0.32, thickness * 1.5);
  if (tipChord  <= 0) tipChord  = Math.max(radialSpan * 0.20, thickness * 1.2);
  if (Math.max(rootChord, tipChord) >= outerR * 1.6)
    throw new BakerError('fan_rotor: blade chords are too large for the rotor envelope');

  // v1 defaults（FanRotorBlade / FanRotorHub）：
  // blade.shape="straight" → chord_scale=1.0, sweep_factor(t)=t, skew_gain=0
  // hub.style="flat" → 无 front cap
  const tipPitchDeg = pitchDeg * 0.56;
  const camber = 0;
  const tipClearance = 0;
  const hubBodyHeight = thickness * 0.36;
  const rearCollarHeight = thickness * 0.18;
  const rearCollarRadius = hubR * 0.78;

  // fan_rotor uses mesh-backed shells instead of OCCT fuse: repeated blade loft
  // booleans can hang in OCCT for these thin overlapping solids, while URDF only
  // needs renderable/collidable OBJ triangles.
  const meshes: MeshGeometry[] = [zAxisAnnulusMesh(hubR, 0, hubBodyHeight)];

  if (rearCollarHeight > 1e-9 && rearCollarRadius > 0) {
    meshes.push(zAxisAnnulusMesh(
      rearCollarRadius,
      0,
      rearCollarHeight,
      -thickness * 0.24 - rearCollarHeight * 0.5,
    ));
  }

  // hub.style = "flat" v1 默认 → 无 front cap

  // Blade loft on YZ planes (varying X = station)
  const rootRadius = hubR * 0.82;
  const tipRadius = outerR - tipClearance;
  if (tipRadius <= rootRadius + Math.max(thickness * 0.22, 1e-4))
    throw new BakerError('fan_rotor: tip_clearance leaves no usable blade span');

  const bladeSpan = tipRadius - rootRadius;
  const stationFracs = [0, 0.18, 0.42, 0.70, 1.0];
  const stations = stationFracs.map((f) => rootRadius + bladeSpan * f);

  // straight blade chord_scale=1.00, sweep_factor=t
  const sectionChords = stationFracs.map((f) => (rootChord + (tipChord - rootChord) * f) * 1.00);
  const rootPitchDeg = pitchDeg * 1.16;
  const sectionPitches = stationFracs.map((f) =>
    rootPitchDeg + (tipPitchDeg - rootPitchDeg) * Math.pow(f, 0.82),
  );
  const rootSectionT = Math.max(thickness * 0.18, rootChord * 0.080);
  const tipSectionT  = Math.max(thickness * 0.08, tipChord  * 0.048);
  const sectionThicknesses = stationFracs.map((f) =>
    (rootSectionT + (tipSectionT - rootSectionT) * Math.pow(f, 0.78)) * 1.00,
  );
  const sweepAmount = bladeSpan * Math.sin(sweepDeg * Math.PI / 180) * 0.34;
  const sectionSweeps = stationFracs.map((f) => sweepAmount * f);

  function bladeSectionPoints(
    chord: number,
    sectionT: number,
    pitchDegLocal: number,
    sweepY: number,
  ): [number, number][] {
    const halfT = Math.max(sectionT * 0.5, chord * 0.011);
    const camberAmplitude = camber * chord * 0.060;
    // straight blade → skew_gain = 0
    const upper: [number, number][] = [];
    const lower: [number, number][] = [];
    for (const u of [0.00, 0.10, 0.24, 0.42, 0.62, 0.82, 1.00]) {
      const chordPos = (u - 0.5) * chord;
      const thicknessScale = Math.max(0.12, Math.pow(Math.sin(Math.PI * u), 0.82));
      const thicknessZ = halfT * thicknessScale;
      const camberZ = camberAmplitude * Math.sin(Math.PI * u);
      upper.push([chordPos, camberZ + thicknessZ]);
      lower.push([chordPos, camberZ - thicknessZ * 0.90]);
    }
    const raw: [number, number][] = upper.concat(lower.slice(1, -1).reverse());
    const a = pitchDegLocal * Math.PI / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return raw.map(([y, z]) => [sweepY + (y * c - z * s), y * s + z * c]);
  }

  const bladeSections: Vec3[][] = stations.map((station, i) => {
    const pts = bladeSectionPoints(
      sectionChords[i], sectionThicknesses[i], sectionPitches[i], sectionSweeps[i],
    );
    return pts.map(([y, z]) => [station, y, z] as Vec3);
  });
  const bladeMesh = sectionLoftMesh(bladeSections, { cap: true });

  const angleStep = 360 / bladeCt;
  for (let i = 0; i < bladeCt; i++) {
    meshes.push(i === 0 ? bladeMesh : rotateMesh(bladeMesh, angleStep * i, [0, 0, 0], [0, 0, 1]));
  }

  return maybeShiftToZ0(combineMeshes(meshes), thickness, args);
};

// ── blower_wheel ───────────────────────────────────────────────────

export const blowerWheel: OpBuilder = (ctx, args) => {
  const outerR  = requireNumber(args, 'outer_radius', 'blower_wheel');
  const innerR  = requireNumber(args, 'inner_radius', 'blower_wheel');
  const width   = requireNumber(args, 'width', 'blower_wheel');
  const bladeCt = Math.round(requireNumber(args, 'blade_count', 'blower_wheel'));
  const bladeT  = requireNumber(args, 'blade_thickness', 'blower_wheel');
  const sweepDeg = optionalNumber(args, 'blade_sweep_deg', 35);
  const backplate = optionalBool(args, 'backplate', true);
  const shroud    = optionalBool(args, 'shroud', false);

  if (outerR <= 0 || innerR <= 0 || width <= 0)
    throw new BakerError('blower_wheel: outer_radius, inner_radius, and width must be positive');
  if (innerR >= outerR)
    throw new BakerError('blower_wheel: inner_radius must be less than outer_radius');
  if (bladeCt < 2)
    throw new BakerError('blower_wheel: blade_count must be at least 2');
  if (bladeT <= 0)
    throw new BakerError('blower_wheel: blade_thickness must be positive');
  if (Math.abs(sweepDeg) >= 85)
    throw new BakerError('blower_wheel: |blade_sweep_deg| must be < 85');

  const radialSpan = outerR - innerR;
  if (bladeT >= radialSpan * 0.9)
    throw new BakerError('blower_wheel: blade_thickness is too large for the blower annulus');

  const drumWall = Math.min(Math.max(bladeT * 1.8, radialSpan * 0.10), innerR * 0.55);
  if (drumWall <= 1e-6 || innerR - drumWall <= 1e-6)
    throw new BakerError('blower_wheel: inner_radius is too small for the blower drum wall');

  let shape: BakeableShape = annulusExtrudeBoth(ctx, innerR, innerR - drumWall, width);

  const sidePlateT = Math.min(Math.max(bladeT * 1.1, width * 0.06), width * 0.16);
  const sidePlateInnerR = Math.max(innerR - drumWall * 0.40, 1e-4);

  if (backplate) {
    const rear = annulusExtrudeBoth(ctx, outerR, sidePlateInnerR, sidePlateT, -width / 2);
    shape = csgFuse(shape, rear);
  }
  if (shroud) {
    const front = annulusExtrudeBoth(ctx, outerR, sidePlateInnerR, sidePlateT,
      width / 2 - sidePlateT);
    shape = csgFuse(shape, front);
  }

  const sweepRad = sweepDeg * Math.PI / 180;
  const innerAttachR = Math.max(innerR - drumWall * 0.08, 1e-4);
  const outerAttachR = outerR - bladeT * 0.35;
  const rearClear  = backplate ? sidePlateT * 0.95 : bladeT * 0.50;
  const frontClear = shroud    ? sidePlateT * 0.95 : bladeT * 0.50;
  const bladeLen = width - rearClear - frontClear;
  if (bladeLen <= bladeT * 1.5)
    throw new BakerError('blower_wheel: width is too small for the blower blade depth');
  const bladeCenterZ = (rearClear - frontClear) * 0.5;

  function annulusPoint(r: number, a: number): [number, number] {
    return [r * Math.cos(a), r * Math.sin(a)];
  }
  function thickenCenterline(
    centerline: [number, number][],
    stripT: number,
  ): [number, number][] {
    const halfT = stripT * 0.5;
    const pos: [number, number][] = [];
    const neg: [number, number][] = [];
    const n = centerline.length;
    for (let i = 0; i < n; i++) {
      const p = centerline[i];
      let tangent: [number, number];
      if (i === 0) tangent = [centerline[1][0] - p[0], centerline[1][1] - p[1]];
      else if (i === n - 1) tangent = [p[0] - centerline[n - 2][0], p[1] - centerline[n - 2][1]];
      else tangent = [centerline[i + 1][0] - centerline[i - 1][0],
                       centerline[i + 1][1] - centerline[i - 1][1]];
      const tn = Math.hypot(tangent[0], tangent[1]);
      const normal: [number, number] = tn <= 1e-9
        ? [0, 1]
        : [-tangent[1] / tn, tangent[0] / tn];
      pos.push([p[0] + normal[0] * halfT, p[1] + normal[1] * halfT]);
      neg.push([p[0] - normal[0] * halfT, p[1] - normal[1] * halfT]);
    }
    return pos.concat(neg.reverse());
  }

  const angleStep = 2 * Math.PI / bladeCt;
  for (let i = 0; i < bladeCt; i++) {
    const a0 = i * angleStep;
    const centerline: [number, number][] = [
      annulusPoint(innerAttachR, a0 - sweepRad * 0.18),
      annulusPoint(innerAttachR + radialSpan * 0.34, a0 + sweepRad * 0.10),
      annulusPoint(innerAttachR + radialSpan * 0.68, a0 + sweepRad * 0.42),
      annulusPoint(outerAttachR, a0 + sweepRad * 0.72),
    ];
    const profile = thickenCenterline(centerline, bladeT);
    const blade = polylineExtrudeBoth(ctx, profile, bladeLen, bladeCenterZ);
    shape = csgFuse(shape, blade);
  }

  return maybeShiftToZ0(shape, width, args);
};
