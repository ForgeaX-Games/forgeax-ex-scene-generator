/**
 * Extra primitive builders that URDF does not support natively.
 *
 * Native URDF already covers box/cylinder/sphere directly in g_to_urdf, so this
 * file only bakes cone/capsule/torus/dome into OBJ meshes.
 */
import type { OpBuilder, BakeableShape, OpContext } from '../types.js';
import { BakerError } from '../errors.js';
import { csgFuse } from '../csg_helpers.js';
import { requireNumber } from '../arg_readers.js';

type ClosedDrawing = ReturnType<ReturnType<OpContext['replicad']['draw']>['close']>;

function pointsToDrawing(
  ctx: OpContext,
  points: Array<readonly [number, number]>,
): ClosedDrawing {
  if (points.length < 3) throw new BakerError('primitive profile must have >=3 points');
  const pen = ctx.replicad.draw([points[0][0], points[0][1]]);
  for (let i = 1; i < points.length; i++) pen.lineTo([points[i][0], points[i][1]]);
  return pen.close();
}

function revolveXzProfile(ctx: OpContext, points: Array<readonly [number, number]>): BakeableShape {
  const drawing = pointsToDrawing(ctx, points);
  type RevolveSketch = { revolve: (axis?: [number, number, number]) => BakeableShape };
  const sketch = drawing.sketchOnPlane('XZ', 0) as unknown as RevolveSketch;
  return sketch.revolve([0, 0, 1]);
}

export const cone: OpBuilder = (ctx, args) => {
  const r = requireNumber(args, 'radius', 'cone');
  const h = requireNumber(args, 'height', 'cone');
  if (r <= 0 || h <= 0) throw new BakerError('cone: radius and height must be positive');

  // XZ profile: axis at x=0, base at z=-h/2, tip at z=+h/2.
  return revolveXzProfile(ctx, [
    [0, -h / 2],
    [r, -h / 2],
    [0, +h / 2],
  ]);
};

export const capsule: OpBuilder = (ctx, args) => {
  const r = requireNumber(args, 'radius', 'capsule');
  const length = requireNumber(args, 'length', 'capsule');
  if (r <= 0 || length <= 0) throw new BakerError('capsule: radius and length must be positive');
  if (length < 2 * r) throw new BakerError('capsule: length must be >= 2 * radius');

  const bodyLength = length - 2 * r;
  if (bodyLength <= 1e-9) return ctx.replicad.makeSphere(r) as BakeableShape;

  const parts: BakeableShape[] = [];

  parts.push(ctx.replicad.makeCylinder(r, bodyLength, [0, 0, -bodyLength / 2], [0, 0, 1]) as BakeableShape);

  const top = ctx.replicad.makeSphere(r).translateZ(bodyLength / 2) as BakeableShape;
  const bottom = ctx.replicad.makeSphere(r).translateZ(-bodyLength / 2) as BakeableShape;
  parts.push(top, bottom);

  // Fuse the simple primitives so the mesh is a single closed solid. For tangent
  // spheres this is usually stable and keeps the OBJ cleaner than a compound.
  let result = parts[0];
  for (let i = 1; i < parts.length; i++) {
    result = csgFuse(result, parts[i]);
  }
  return result;
};

export const torus: OpBuilder = (ctx, args) => {
  const majorR = requireNumber(args, 'major_radius', 'torus');
  const minorR = requireNumber(args, 'minor_radius', 'torus');
  if (majorR <= 0 || minorR <= 0) throw new BakerError('torus: radii must be positive');
  if (minorR >= majorR) throw new BakerError('torus: minor_radius must be < major_radius');

  // low-poly：环向截面 16 段（旧 48 对低多边形过细）。
  const n = 16;
  const pts: Array<readonly [number, number]> = [];
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n;
    pts.push([
      majorR + Math.cos(a) * minorR,
      Math.sin(a) * minorR,
    ]);
  }
  return revolveXzProfile(ctx, pts);
};

export const dome: OpBuilder = (ctx, args) => {
  const r = requireNumber(args, 'radius', 'dome');
  const h = requireNumber(args, 'height', 'dome');
  if (r <= 0 || h <= 0) throw new BakerError('dome: radius and height must be positive');
  if (h > r) throw new BakerError('dome: height must be <= radius');

  // Spherical cap centered around z=0. Base plane z=-h/2, top z=+h/2.
  // Sphere center sits at z = h/2 - r; base radius follows x^2 + dz^2 = r^2.
  const sphereCenterZ = h / 2 - r;
  const zBase = -h / 2;
  const zTop = +h / 2;
  const baseR = Math.sqrt(Math.max(0, r * r - (zBase - sphereCenterZ) ** 2));

  // low-poly：顶盖 16 段（旧 32 对低多边形过细）。
  const n = 16;
  const pts: Array<readonly [number, number]> = [[0, zBase], [baseR, zBase]];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const z = zBase + (zTop - zBase) * t;
    const x = Math.sqrt(Math.max(0, r * r - (z - sphereCenterZ) ** 2));
    pts.push([x, z]);
  }
  return revolveXzProfile(ctx, pts);
};
