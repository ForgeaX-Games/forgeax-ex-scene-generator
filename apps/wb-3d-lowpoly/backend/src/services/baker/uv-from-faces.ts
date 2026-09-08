/**
 * uv-from-faces.ts —— 按原始 OCCT 面精确算贴图 UV（不用三角形法线猜投影）。
 *
 * 思路：
 *   1) `shape.mesh({...})` 除了 vertices/triangles，还会返回 `faceGroups`
 *      （每个原始 OCCT face 对应一段 `triangles` 下标区间 + `faceId`）。
 *   2) `shape.faces` 拿到全部 `Face`，用 `hashCode` 建 `faceId → Face` 映射
 *      （`ShapeMesh.faceGroups[i].faceId` 就是 `Face.hashCode`）。
 *   3) 对每个 face group 里被引用到的顶点（去重，一个顶点只投影一次），
 *      调 `face.uvCoordinates([x,y,z])` 拿原始 (u,v) 参数：
 *        - geomType === 'PLANE'：OCCT 平面参数化本身就是米，直接用。
 *        - geomType === 'CYLINDRE' | 'CONE'：u 是弧度，× 半径 = 弧长（米），
 *          v（沿轴高度）本身已经是米，直接用。半径从 `BRepAdaptor_Surface`
 *          的 `.Cylinder()/.Cone()` 读（replicad 未公开半径 API，只能拿到
 *          adaptor 后 unsafe cast 调 OCCT 原生方法）。
 *        - 其余曲面（SPHERE/TORUS/BSPLINE_SURFACE 等）：没有稳定的"米制"参数，
 *          用 `face.UVBounds` 把 (u,v) 归一化到 0..1 兜底（跟 Blender 对同类
 *          曲面的处理是同一数量级的必然畸变，不是缺陷）。
 *   4) 最后套用 `g_texture` 的 repeat → rotation → offset。
 *
 * 只在某 part 的材质确实带 `texture` 时才调用（比普通 `meshShape` 多一次
 * 每顶点的 `GeomAPI_ProjectPointOnSurf` 投影，成本不小，不能无差别跑）。
 */

import { effectiveLinearDeflection } from './obj_export.js';
import { safeDelete } from './op_helpers.js';
import type { BakeableShape, TessellationOptions } from './types.js';

export interface TextureUvParams {
  repeatU: number;
  repeatV: number;
  offsetU: number;
  offsetV: number;
  /** UV 旋转，弧度。 */
  rotation: number;
}

export interface MeshWithUv {
  /** flat [x,y,z,x,y,z,...]，0-based，与 `meshShape()` 的 RawMesh.vertices 同构。 */
  vertices: number[];
  /** flat [i0,i1,i2,...]，0-based。 */
  triangles: number[];
  /** flat [u0,v0,u1,v1,...]，长度 = (vertices.length/3)*2，与 vertices 顶点序对齐。 */
  uvs: Float32Array;
  /**
   * 原样透传 `shape.mesh()` 返回的 faceGroups——调用方（测试/诊断）想按面复核 UV 时
   * 直接用这个，不要自己再调一次 `.mesh()`：`effectiveLinearDeflection` 是相对包围盒算的，
   * 用不同/不匹配的 tolerance 重新三角化会产生跟这里的 vertices/triangles 不对应的顶点数，
   * 尤其是曲面（弧度分段数随 tolerance 变化，平面反而不受影响，容易被误认为"一致"）。
   */
  faceGroups: Array<{ start: number; count: number; faceId: number }>;
}

/** replicad 未公开在 .d.ts 里的 face/adaptor 形状——按需 unsafe cast。 */
interface OcctFaceLike {
  readonly geomType: string;
  readonly hashCode: number;
  readonly UVBounds: { uMin: number; uMax: number; vMin: number; vMax: number };
  readonly surface: { wrapped: unknown; delete?: () => void };
  uvCoordinates(point: [number, number, number]): [number, number];
  delete?: () => void;
}
interface OcctShapeLike {
  readonly faces: OcctFaceLike[];
  mesh(opts: { tolerance: number; angularTolerance: number }): {
    triangles: number[];
    vertices: number[];
    faceGroups: Array<{ start: number; count: number; faceId: number }>;
  };
}

/**
 * 对一个 replicad 实体三角化，并同时按面精确算好每个顶点的 UV。
 *
 * 与 `meshShape()`（obj_export.ts）共用同一套弦距/角度容差，保证贴图 part
 * 与其它 GLB/OBJ 烘焙路径的面数表现一致。调用方（baker.service.ts）在有
 * texture 的 part 上改调这个函数**取代**普通 `meshShape()`，避免同一个
 * shape 被 tessellate 两次。
 */
export function meshShapeWithUvs(
  shape: BakeableShape,
  tess: TessellationOptions,
  uvParams: TextureUvParams,
): MeshWithUv {
  const occtShape = shape as unknown as OcctShapeLike;
  const mesh = occtShape.mesh({
    tolerance: effectiveLinearDeflection(shape, tess),
    angularTolerance: tess.angularDeflection,
  });
  const { vertices, triangles, faceGroups } = mesh;
  const vertexCount = vertices.length / 3;
  const uvs = new Float32Array(vertexCount * 2);
  const covered = new Uint8Array(vertexCount);

  const facesById = new Map<number, OcctFaceLike>();
  for (const face of occtShape.faces) facesById.set(face.hashCode, face);

  const cosR = Math.cos(uvParams.rotation);
  const sinR = Math.sin(uvParams.rotation);

  try {
    for (const group of faceGroups) {
      const face = facesById.get(group.faceId);
      if (!face) continue;

      const geomType = face.geomType;
      const bounds = face.UVBounds;
      const uSpan = bounds.uMax - bounds.uMin;
      const vSpan = bounds.vMax - bounds.vMin;
      const radius = geomType === 'CYLINDRE' || geomType === 'CONE' ? faceRadius(face, geomType) : undefined;

      const end = group.start + group.count;
      for (let i = group.start; i < end; i++) {
        const vi = triangles[i];
        if (covered[vi]) continue;
        covered[vi] = 1;

        const x = vertices[vi * 3];
        const y = vertices[vi * 3 + 1];
        const z = vertices[vi * 3 + 2];
        const [rawU, rawV] = face.uvCoordinates([x, y, z]);

        let u: number;
        let v: number;
        if (geomType === 'PLANE') {
          u = rawU;
          v = rawV;
        } else if (radius !== undefined && radius > 1e-9) {
          u = rawU * radius;
          v = rawV;
        } else {
          u = uSpan > 1e-12 ? (rawU - bounds.uMin) / uSpan : 0;
          v = vSpan > 1e-12 ? (rawV - bounds.vMin) / vSpan : 0;
        }

        let su = u * uvParams.repeatU;
        let sv = v * uvParams.repeatV;
        if (uvParams.rotation !== 0) {
          const ru = su * cosR - sv * sinR;
          const rv = su * sinR + sv * cosR;
          su = ru;
          sv = rv;
        }
        uvs[vi * 2] = su + uvParams.offsetU;
        uvs[vi * 2 + 1] = sv + uvParams.offsetV;
      }
    }
  } finally {
    for (const face of facesById.values()) safeDelete(face);
  }

  return { vertices, triangles, uvs, faceGroups };
}

/** 从 `BRepAdaptor_Surface` 读柱面/锥面半径（OCCT 原生方法，replicad 未公开）。 */
function faceRadius(face: OcctFaceLike, geomType: string): number | undefined {
  const surface = face.surface;
  try {
    const adaptor = surface.wrapped as {
      Cylinder?: () => { Radius: () => number; delete?: () => void };
      Cone?: () => { RefRadius: () => number; delete?: () => void };
    };
    if (geomType === 'CYLINDRE' && typeof adaptor.Cylinder === 'function') {
      const cyl = adaptor.Cylinder();
      const r = cyl.Radius();
      safeDelete(cyl);
      return r;
    }
    if (geomType === 'CONE' && typeof adaptor.Cone === 'function') {
      const cone = adaptor.Cone();
      const r = cone.RefRadius();
      safeDelete(cone);
      return r;
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    safeDelete(surface);
  }
}
