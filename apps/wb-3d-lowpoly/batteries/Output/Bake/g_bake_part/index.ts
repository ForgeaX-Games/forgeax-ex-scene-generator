/**
 * g_bake_part —— 阶段1 烘焙暂存件。
 *
 * 把一个零件子图里、由 `shape_id` 定位的终端形状烘焙成内容寻址的 OBJ mesh，
 * 经 `ctx.services.baker` 写入 workspace 级 `library/blobs/`，返回一个 `<sha>.obj`
 * 文件名。阶段2 直接用 `g_mesh(filename=<sha>.obj)` 引用该暂存 mesh 组装整图，
 * `g_to_urdf` 看到的全是 native mesh 引用，不再重烘重 CSG。
 *
 * op 分类（与 g_to_urdf 共用 vendor 的分类函数，保证口径一致）：
 *   - URDF 原生 primitive（box/cylinder/sphere）→ 不烘，返回空 filename + note
 *     （阶段2 直接用 g_box/g_cylinder/g_sphere，无需 mesh）
 *   - 子图烘焙 op（CSG/transform/profile 链）→ baker.bakeGeometryShape(shape_id, geom)
 *   - 单 op composite（gear/part/architecture/cone…）→ baker.bake(op, args)
 *   - 其它/未知 op → error
 *
 * 容错：不抛异常；所有失败路径写 `error` 字段返回，并透传 geometry。
 */

import {
  parseGeometryPort,
  makeGeometry,
  listBakeableShapeOps,
  listSubgraphBakeOps,
  listUrdfNativeShapeOps,
  type Geometry,
  type Statement,
} from '../../../../vendor/dist/shared/types/index.js';

// 电池层不能 import backend，所以 ctx 句柄用最小化的局部 interface 复刻
// （与 g_to_urdf 的 BakerHandle 同形）。
interface BakeResultShape {
  url: string;
  sha256: string;
  vertexCount: number;
  triangleCount: number;
  byteSize: number;
  cacheHit: boolean;
  blobSha256?: string;
  bboxMin?: [number, number, number];
  bboxMax?: [number, number, number];
}
interface BakerHandle {
  bake(opName: string, args: Record<string, unknown>): Promise<BakeResultShape>;
  bakeGeometryShape?(rootId: string, geometry: Geometry): Promise<BakeResultShape>;
  listBakeableOps(): readonly string[];
}
// 每项目烘焙清单句柄（后端在 ctx.services.parts 注入；见 backend/src/services/parts-registry.ts）。
interface PartsRegistryLike {
  register(entry: {
    name: string;
    filename: string;
    sha256: string;
    bbox_min: number[];
    bbox_max: number[];
    dims: number[];
    vertexCount?: number;
    triangleCount?: number;
  }): void;
}
interface CtxLike {
  services?: { baker?: BakerHandle; parts?: PartsRegistryLike };
}

const URDF_NATIVE_SHAPES = new Set(listUrdfNativeShapeOps());
const COMPOSITE_BAKE_OPS = new Set(listBakeableShapeOps());
const CSG_SUBGRAPH_BAKE_OPS = new Set(listSubgraphBakeOps());

export async function gBakePart(
  input: Record<string, unknown>,
  ctx?: CtxLike,
): Promise<Record<string, unknown>> {
  const geom: Geometry = parseGeometryPort(input.geometry) ?? makeGeometry();

  const fail = (error: string): Record<string, unknown> => ({
    filename: '',
    sha256: '',
    vertexCount: 0,
    triangleCount: 0,
    cacheHit: false,
    bbox_min: [],
    bbox_max: [],
    size: [],
    geometry: geom,
    note: '',
    error,
  });

  // shape_id：优先用入参，留空回退到 geometry.focus（最近一条语句）
  const rawShapeId = String(input.shape_id ?? '').trim();
  const shapeId = rawShapeId !== '' ? rawShapeId : (geom.focus ?? '');
  if (shapeId === '') {
    return fail('shape_id is required (or pipe a geometry with a focused terminal shape)');
  }

  const shape = geom.statements.find((s: Statement) => s.id === shapeId);
  if (!shape) {
    return fail(`shape_id "${shapeId}" not found in geometry`);
  }

  // 1) URDF 原生 primitive：阶段2 直接用 g_box/g_cylinder/g_sphere，无需烘焙
  if (URDF_NATIVE_SHAPES.has(shape.op)) {
    return {
      filename: '',
      sha256: '',
      vertexCount: 0,
      triangleCount: 0,
      cacheHit: false,
      bbox_min: [],
      bbox_max: [],
      size: [],
      geometry: geom,
      note: `shape "${shapeId}" (${shape.op}) is a native URDF primitive; phase 2 should use g_${shape.op} directly instead of a baked mesh`,
      error: '',
    };
  }

  const baker = ctx?.services?.baker;
  if (!baker) {
    return fail('baker service is unavailable on ctx.services.baker; cannot bake this part');
  }

  const isSubgraph = CSG_SUBGRAPH_BAKE_OPS.has(shape.op);
  const isComposite = COMPOSITE_BAKE_OPS.has(shape.op);
  if (!isSubgraph && !isComposite) {
    return fail(`shape "${shapeId}" has op "${shape.op}" which is neither a native primitive nor a bakeable shape op`);
  }

  try {
    let res: BakeResultShape;
    if (isSubgraph) {
      if (!baker.bakeGeometryShape) {
        return fail(`baker does not support geometry-subgraph bake for op "${shape.op}"`);
      }
      res = await baker.bakeGeometryShape(shapeId, geom);
    } else {
      res = await baker.bake(shape.op, shape.args as Record<string, unknown>);
    }
    const bboxMin = res.bboxMin ?? null;
    const bboxMax = res.bboxMax ?? null;
    const size = bboxMin && bboxMax
      ? [bboxMax[0] - bboxMin[0], bboxMax[1] - bboxMin[1], bboxMax[2] - bboxMin[2]] as [number, number, number]
      : null;
    const round3 = (v: readonly number[]): number[] => v.map(n => Math.round(n * 1e6) / 1e6);
    const sizeNote = size
      ? `; size≈[${round3(size).join(', ')}] m (bbox_min=[${round3(bboxMin!).join(', ')}], bbox_max=[${round3(bboxMax!).join(', ')}])`
      : '';

    // 自动登记到项目烘焙清单，供 lowpoly:parts.list 廉价查询 + mesh-aware QC 取真实 bbox。
    // 登记失败绝不影响 bake 结果（parts registry 内部已 try/catch）。
    ctx?.services?.parts?.register({
      name: shapeId,
      filename: res.url,
      sha256: res.sha256,
      bbox_min: bboxMin ? round3(bboxMin) : [],
      bbox_max: bboxMax ? round3(bboxMax) : [],
      dims: size ? round3(size) : [],
      vertexCount: res.vertexCount,
      triangleCount: res.triangleCount,
    });

    return {
      filename: res.url,
      sha256: res.sha256,
      vertexCount: res.vertexCount,
      triangleCount: res.triangleCount,
      cacheHit: res.cacheHit,
      bbox_min: bboxMin ? round3(bboxMin) : [],
      bbox_max: bboxMax ? round3(bboxMax) : [],
      size: size ? round3(size) : [],
      geometry: geom,
      note: res.cacheHit
        ? `baked "${shapeId}" (${shape.op}) → ${res.url} (cache hit)${sizeNote}`
        : `baked "${shapeId}" (${shape.op}) → ${res.url}${sizeNote}`,
      error: '',
    };
  } catch (e) {
    return fail(`bake failed for "${shapeId}" (${shape.op}): ${e instanceof Error ? e.message : String(e)}`);
  }
}

export default gBakePart;
