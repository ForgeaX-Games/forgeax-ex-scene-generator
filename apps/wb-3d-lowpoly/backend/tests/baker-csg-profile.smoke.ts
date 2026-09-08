/**
 * CSG/Profile e2e smoke.
 *
 * Run:
 *   cd backend && npx tsx test/baker-csg-profile.smoke.ts
 */

import { bakeGeometryShape, initBakerService } from '../src/services/baker/baker.service.js';
import { sectionLoftMesh, tubeMeshFromPath, type Vec3 } from '../src/services/baker/curves.js';
import type { BakerLibraryHandle, MeshGeometry } from '../src/services/baker/types.js';
import { gToUrdf } from '../../batteries/Output/Export/g_to_urdf/index.js';
import { geometryFromSource, type Geometry } from '../../vendor/dist/shared/types/index.js';

class FakeLibrary implements BakerLibraryHandle {
  bytesByAlias = new Map<string, Buffer>();
  async importFromBuffer(buffer: Buffer, _filename: string, alias?: string) {
    const a = alias ?? _filename;
    this.bytesByAlias.set(a, buffer);
    return { alias: a, blobId: a.replace(/\.obj$/, '') };
  }
}

const CASES = [
  {
    name: 'difference',
    root: 'diff1',
    source: [
      'box1 = box(size=[1,1,1])',
      'cyl1 = cylinder(radius=0.2, length=1.4)',
      'diff1 = difference(base=box1, tool=cyl1)',
    ].join('\n'),
  },
  {
    name: 'union',
    root: 'u1',
    source: [
      's1 = sphere(radius=0.35)',
      'c1 = cylinder(radius=0.18, length=1)',
      'u1 = union(a=s1, b=c1)',
    ].join('\n'),
  },
  {
    name: 'intersection',
    root: 'i1',
    source: [
      'b1 = box(size=[1,1,1])',
      's1 = sphere(radius=0.6)',
      'i1 = intersection(a=b1, b=s1)',
    ].join('\n'),
  },
  {
    name: 'profile_preview',
    root: 'p1',
    source: [
      'p1 = profile_rect(w=0.8, d=0.4)',
    ].join('\n'),
  },
  {
    name: 'extrude',
    root: 'e1',
    source: [
      'p1 = profile_rect(w=0.8, d=0.4)',
      'e1 = extrude(profile=p1, height=0.3, center=true)',
    ].join('\n'),
  },
  {
    name: 'revolve',
    root: 'l1',
    source: [
      'p1 = profile_polygon(points=[0,-0.5,0.3,-0.5,0.2,0.5,0,0.5])',
      'l1 = revolve(profile=p1)',
    ].join('\n'),
  },
  {
    name: 'rounded_rect_extrude',
    root: 'e1',
    source: [
      'p1 = profile_rounded_rect(w=0.8, d=0.4, radius=0.08, segments=6)',
      'e1 = extrude(profile=p1, height=0.2, center=true)',
    ].join('\n'),
  },
  {
    name: 'regular_polygon_extrude',
    root: 'e1',
    source: [
      'p1 = profile_regular_polygon(radius=0.35, sides=6)',
      'e1 = extrude(profile=p1, height=0.2, center=true)',
    ].join('\n'),
  },
  {
    name: 'extrude_with_holes',
    root: 'panel1',
    source: [
      'outer = profile_rounded_rect(w=1, d=0.6, radius=0.08, segments=6)',
      'hole = profile_circle(radius=0.12, segments=32)',
      'panel1 = extrude_with_holes(outer=outer, holes=[hole], height=0.08, center=true)',
    ].join('\n'),
  },
  {
    name: 'translate',
    root: 'move1',
    source: [
      'box1 = box(size=[0.3,0.2,0.1])',
      'move1 = translate(shape=box1, offset=[0.4,0.1,0.2])',
    ].join('\n'),
  },
  {
    name: 'rotate',
    root: 'rot1',
    source: [
      'box1 = box(size=[0.3,0.2,0.1])',
      'rot1 = rotate(shape=box1, angle_deg=45, axis=[0,0,1], origin=[0,0,0])',
    ].join('\n'),
  },
  {
    name: 'scale',
    root: 'scale1',
    source: [
      'box1 = box(size=[0.3,0.2,0.1])',
      'scale1 = scale(shape=box1, factor=1.5, center=[0,0,0])',
    ].join('\n'),
  },
  {
    name: 'mirror',
    root: 'mirror1',
    source: [
      'box1 = box(size=[0.3,0.2,0.1])',
      'move1 = translate(shape=box1, offset=[0.4,0,0])',
      'mirror1 = mirror(shape=move1, plane="YZ", origin=[0,0,0])',
    ].join('\n'),
  },
  {
    name: 'array_linear',
    root: 'array1',
    source: [
      'box1 = box(size=[0.15,0.12,0.08])',
      'array1 = array_linear(shape=box1, count=4, step=[0.25,0,0])',
    ].join('\n'),
  },
  {
    name: 'array_radial',
    root: 'radial1',
    source: [
      'box1 = box(size=[0.12,0.08,0.06])',
      'move1 = translate(shape=box1, offset=[0.35,0,0])',
      'radial1 = array_radial(shape=move1, count=6, angle_deg=360, axis=[0,0,1], origin=[0,0,0])',
    ].join('\n'),
  },
  {
    name: 'loft',
    root: 'loft1',
    source: [
      'p1 = profile_rect(w=0.8, d=0.5)',
      'p2 = profile_rect(w=0.4, d=0.25)',
      'loft1 = loft(profiles=[p1,p2], height=0.8, ruled=false)',
    ].join('\n'),
  },
  {
    name: 'pipe',
    root: 'pipe1',
    source: [
      'pipe1 = pipe(path=[0,0,0, 0.6,0,0, 0.6,0.5,0.3], radius=0.04)',
    ].join('\n'),
  },
  {
    name: 'pipe_catmull_rom',
    root: 'pipe1',
    source: [
      'pipe1 = pipe(path=[0,0,0, 0.25,0,-0.2, 0.5,0,0.25, 0.8,0,0], radius=0.035, spline="catmull_rom", samples_per_segment=8, radial_segments=16)',
    ].join('\n'),
  },
  {
    name: 'sweep',
    root: 'sweep1',
    source: [
      'p1 = profile_regular_polygon(radius=0.08, sides=6)',
      'sweep1 = sweep(profile=p1, path=[0,0,0, 0.4,0,0.3, 0.4,0.4,0.6], ruled=false)',
    ].join('\n'),
  },
  {
    name: 'sweep_aligned_bezier',
    root: 'sweep1',
    source: [
      'p1 = profile_regular_polygon(radius=0.06, sides=6)',
      'sweep1 = sweep(profile=p1, path=[0,0,0, 0.15,0,-0.2, 0.35,0,0.2, 0.5,0,0.05], spline="bezier", samples_per_segment=10, align=true)',
    ].join('\n'),
  },
  {
    name: 'section_loft',
    root: 'body1',
    source: [
      'body1 = section_loft(sections=[[-0.3,-0.12,-0.08, -0.3,0.12,-0.08, -0.3,0.12,0.08, -0.3,-0.12,0.08], [0,-0.18,-0.12, 0,0.18,-0.12, 0,0.18,0.12, 0,-0.18,0.12], [0.35,-0.09,-0.06, 0.35,0.09,-0.06, 0.35,0.09,0.06, 0.35,-0.09,0.06]], cap=true)',
    ].join('\n'),
  },
] as const;

async function main() {
  const t0 = Date.now();
  assertOutwardMeshNormals(
    'straight_tube_winding',
    tubeMeshFromPath([[0, 0, 0], [0, 0, 1]], 0.05, 16, { cap: true }),
  );
  assertOutwardMeshNormals(
    'section_loft_winding',
    sectionLoftMesh([
      [[-0.3, -0.1, -0.06], [-0.3, 0.1, -0.06], [-0.3, 0.1, 0.06], [-0.3, -0.1, 0.06]],
      [[0.3, -0.16, -0.1], [0.3, 0.16, -0.1], [0.3, 0.16, 0.1], [0.3, -0.16, 0.1]],
    ], { cap: true }),
  );

  await initBakerService();
  const lib = new FakeLibrary();

  for (const c of CASES) {
    const t = Date.now();
    const result = await bakeGeometryShape(c.root, geometryFromSource(c.source), lib);
    if (result.vertexCount <= 0 || result.triangleCount <= 0 || result.byteSize <= 0) {
      throw new Error(`${c.name}: empty bake result`);
    }
    console.log(
      `[csg] ${c.name}: V=${result.vertexCount} T=${result.triangleCount} ` +
      `OBJ=${result.byteSize}B ms=${Date.now() - t}`,
    );
  }

  const e2eGeom = geometryFromSource([
    'p1 = profile_rect(w=0.8, d=0.4)',
    'e1 = extrude(profile=p1, height=0.3, center=true)',
    'part1 = part(shape=e1)',
  ].join('\n'));
  const ctx = {
    services: {
      baker: {
        async bake() {
          throw new Error('unexpected single-op bake for CSG smoke');
        },
        bakeGeometryShape(rootId: string, geometry: Geometry) {
          return bakeGeometryShape(rootId, geometry, lib);
        },
        listBakeableOps() {
          return [];
        },
      },
    },
  };
  const urdfOut = await gToUrdf({ geometry: e2eGeom, name: 'csg_profile_smoke' }, ctx);
  const xml = String(urdfOut.urdf);
  if (!/<mesh filename="[0-9a-f]{64}\.obj"\/>/.test(xml)) {
    throw new Error('URDF did not contain baked CSG mesh');
  }

  const fallbackOut = await gToUrdf({
    geometry: geometryFromSource([
      'p1 = profile_rect(w=0.8, d=0.4)',
      'e1 = extrude(profile=p1, height=0.3, center=true)',
    ].join('\n')),
    name: 'csg_profile_fallback',
  });
  if (!String(fallbackOut.urdf).includes('<box size="0.8 0.4 0.3"/>')) {
    throw new Error('CSG AABB fallback did not produce expected box');
  }

  const transformFallback = await gToUrdf({
    geometry: geometryFromSource([
      'box1 = box(size=[0.15,0.12,0.08])',
      'array1 = array_linear(shape=box1, count=4, step=[0.25,0,0])',
    ].join('\n')),
    name: 'csg_transform_fallback',
  });
  if (!String(transformFallback.urdf).includes('<box size="0.9 0.12 0.08"/>')) {
    throw new Error('Transform AABB fallback did not produce expected array box');
  }

  const profilePreview = await gToUrdf({
    geometry: geometryFromSource([
      'p1 = profile_rect(w=0.8, d=0.4)',
    ].join('\n')),
    name: 'profile_preview',
  }, ctx);
  if (!/<mesh filename="[0-9a-f]{64}\.obj"\/>/.test(String(profilePreview.urdf))) {
    throw new Error('Profile preview URDF did not contain baked profile mesh');
  }

  const consumedProfile = await gToUrdf({
    geometry: geometryFromSource([
      'p1 = profile_rect(w=0.8, d=0.4)',
      'e1 = extrude(profile=p1, height=0.3, center=true)',
    ].join('\n')),
    name: 'consumed_profile',
  }, ctx);
  if (String(consumedProfile.urdf).includes('<link name="p1">')) {
    throw new Error('Consumed profile should not render an intermediate profile link');
  }

  const loftFallback = await gToUrdf({
    geometry: geometryFromSource([
      'p1 = profile_rect(w=0.8, d=0.5)',
      'p2 = profile_rect(w=0.4, d=0.25)',
      'loft1 = loft(profiles=[p1,p2], height=0.8, ruled=false)',
    ].join('\n')),
    name: 'loft_fallback',
  });
  if (!String(loftFallback.urdf).includes('<box size="0.8 0.5 0.8"/>')) {
    throw new Error('Loft AABB fallback did not produce expected box');
  }

  const hairDryerStyle = await gToUrdf({
    geometry: geometryFromSource([
      'body = section_loft(sections=[[-0.3,-0.08,-0.06, -0.3,0.08,-0.06, -0.3,0.08,0.06, -0.3,-0.08,0.06], [0,-0.12,-0.08, 0,0.12,-0.08, 0,0.12,0.08, 0,-0.12,0.08], [0.35,-0.07,-0.045, 0.35,0.07,-0.045, 0.35,0.07,0.045, 0.35,-0.07,0.045]], cap=true)',
      'handle = pipe(path=[-0.05,0,-0.05, -0.12,0,-0.18, 0.02,0,-0.32, 0.12,0,-0.2], radius=0.025, spline="bezier", samples_per_segment=8, radial_segments=16)',
      'body_part = part(shape=body)',
      'handle_part = part(shape=handle)',
      'j1 = joint(type="fixed", parent=body_part, child=handle_part)',
    ].join('\n')),
    name: 'curve_surface_hair_dryer_style',
  }, ctx);
  const hairXml = String(hairDryerStyle.urdf);
  const meshRefs = hairXml.match(/<mesh filename="[0-9a-f]{64}\.obj"\/>/g) ?? [];
  if (meshRefs.length < 2) {
    throw new Error('Hair-dryer-style fixture should contain baked body and handle meshes');
  }

  console.log(`[csg] OK (total ${Date.now() - t0}ms)`);
}

main().catch((err) => {
  console.error('[csg] error:', err);
  process.exit(1);
});

function assertOutwardMeshNormals(name: string, mesh: MeshGeometry): void {
  const centroid = average(mesh.vertices);
  let bad = 0;
  for (const face of mesh.faces) {
    const normal = faceNormal(mesh.vertices, face);
    const center = faceCenter(mesh.vertices, face);
    if (dot(normal, sub(center, centroid)) < -1e-10) bad += 1;
  }
  if (bad > 0) throw new Error(`${name}: ${bad}/${mesh.faces.length} faces point inward`);
}

function faceNormal(vertices: readonly (readonly [number, number, number])[], face: readonly [number, number, number]): Vec3 {
  const a = vertices[face[0]];
  const b = vertices[face[1]];
  const c = vertices[face[2]];
  return cross(sub(b, a), sub(c, a));
}

function faceCenter(vertices: readonly (readonly [number, number, number])[], face: readonly [number, number, number]): Vec3 {
  const a = vertices[face[0]];
  const b = vertices[face[1]];
  const c = vertices[face[2]];
  return scale(add(add(a, b), c), 1 / 3);
}

function average(points: readonly (readonly [number, number, number])[]): Vec3 {
  return scale(points.reduce<Vec3>((acc, p) => add(acc, p), [0, 0, 0]), 1 / points.length);
}

function add(a: readonly [number, number, number], b: readonly [number, number, number]): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a: readonly [number, number, number], b: readonly [number, number, number]): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(a: readonly [number, number, number], s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function dot(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: readonly [number, number, number], b: readonly [number, number, number]): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
