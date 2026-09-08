/**
 * g_bake_object —— 把"一个由多个上色 part 组成的物体"整体烘成单个**多材质 GLB**。
 *
 * 与 g_bake_part 的区别：
 *   - g_bake_part 烘**一个形状**成纯几何 OBJ（无颜色）——一个 mesh 只能上一种 link 材质。
 *   - g_bake_object 烘**整组 part（每个带 shape + material 颜色 + 位姿）**成一个 `<sha>.glb`，
 *     颜色按 part 内嵌进 GLB。场景里 `g_mesh(filename=<sha>.glb)` 单实例引用即可保留多色。
 *     **引用它的 g_part 不要再上 material**，否则 viewer 会用 link 材质覆盖内嵌色。
 *
 * 输入 geometry 里所有 `part` 语句都会被烘进同一个物体 GLB：每个 part 解析
 * shape(ref) + material(ref→rgba，缺省灰) + origin/rpy，交给 baker.bakeColoredAssembly。
 *
 * `include_mesh_parts`（默认 true）决定 mesh-ref part（`part(shape=mesh(...))`）算不算这个物体的
 * 一部分。角色路必须 true——它正是靠回读逐件预烘的 `<sha>.obj` 合并成单张可蒙皮网格。
 * 静态路的终端链传 false：那里的分区规则是"真形状 part 进合并 GLB、mesh-ref part 各自一条
 * SceneSpec item（g_to_scene 已经这么做）"，两边都收会让 mesh-ref 件在场景里出现两遍。
 *
 * 容错：不抛异常；失败路径写 error 字段返回并透传 geometry。
 */

import { readFileSync } from 'node:fs';
import { isAbsolute, join, normalize } from 'node:path';

import {
  parseGeometryPort,
  makeGeometry,
  listBakeableShapeOps,
  listSubgraphBakeOps,
  listUrdfNativeShapeOps,
  type Arg,
  type Geometry,
  type Statement,
} from '../../../../vendor/dist/shared/types/index.js';

// 可烘进 GLB 的 part 形状：URDF 原生 primitive + CSG/profile 子图 + 单 op composite。
// 另外**也接受 `mesh`**（引用分件 `g_bake_part` 预烘的 `<sha>.obj`）：baker 会回读该 blob
// 的三角面、按 part 位姿合并进同一张网格。颜色由 part 的 `g_material` 决定（OBJ 本身无色），
// 缺省灰。角色路正是靠这条把"分件建模 + 逐件 bake"的件一起合并成单张可蒙皮网格。
const BUILDABLE_SHAPE_OPS = new Set<string>([
  ...listUrdfNativeShapeOps(),
  ...listSubgraphBakeOps(),
  ...listBakeableShapeOps(),
]);

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
interface ColoredAssemblyPartTextureInput {
  imageBytes: Buffer;
  mime: string;
  repeatU?: number;
  repeatV?: number;
  offsetU?: number;
  offsetV?: number;
  rotation?: number;
}
interface ColoredAssemblyPartInput {
  shapeId: string;
  rgba: [number, number, number, number];
  origin?: [number, number, number];
  rpy?: [number, number, number];
  metalness?: number;
  roughness?: number;
  texture?: ColoredAssemblyPartTextureInput;
}
interface BakerHandle {
  bakeColoredAssembly?(
    parts: readonly ColoredAssemblyPartInput[],
    geometry: Geometry,
  ): Promise<BakeResultShape>;
}
// 与 g_bake_part 共用的清单句柄（见 backend/src/services/parts-registry.ts）。
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
  services?: { baker?: BakerHandle; assetsDir?: string; parts?: PartsRegistryLike };
}

const DEFAULT_RGBA: [number, number, number, number] = [0.7, 0.7, 0.7, 1];

// g_material 电池默认 metalness=0.05/roughness=0.48（与前端 materials.ts 的 defaultSpec 一致）；
// 这里读不到显式值时不重复兜底，直接不传，交给 glb_export.ts 的同一对默认值负责。
const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
};

export async function gBakeObject(
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

  const includeMeshParts = readBool(input.include_mesh_parts, true);

  const byId = new Map<string, Statement>(geom.statements.map((s) => [s.id, s]));
  const allPartStmts = geom.statements.filter((s) => s.op === 'part');
  if (allPartStmts.length === 0) {
    return fail('no part() statements in geometry; build the object as multiple g_part links (each wrapping a REAL shape + a g_material) in one graph, then g_bake_object');
  }
  // include_mesh_parts=false：mesh-ref part 不属于这个物体（静态路交给 g_to_scene 各列一条）。
  const partStmts = includeMeshParts
    ? allPartStmts
    : allPartStmts.filter((p) => {
        const shapeRef = p.args.shape;
        if (!shapeRef || shapeRef.kind !== 'ref') return true; // 留给下面的缺 shape ref 报错
        return byId.get(shapeRef.name)?.op !== 'mesh';
      });
  const skippedMeshParts = allPartStmts.length - partStmts.length;
  if (partStmts.length === 0) {
    return fail('include_mesh_parts=false left nothing to bake: every part in this geometry references a pre-baked mesh. Reference those meshes directly (g_to_scene lists one item per mesh part) instead of baking.');
  }

  const parts: ColoredAssemblyPartInput[] = [];
  for (const p of partStmts) {
    const shapeRef = p.args.shape;
    if (!shapeRef || shapeRef.kind !== 'ref') {
      return fail(`part "${p.id}" is missing a shape ref`);
    }
    const shapeStmt = byId.get(shapeRef.name);
    if (!shapeStmt) {
      return fail(`part "${p.id}" references unknown shape "${shapeRef.name}"`);
    }
    // mesh part（预烘 <sha>.obj 引用）交给 baker 回读合并；其余必须是可烘的真形状。
    if (shapeStmt.op !== 'mesh' && !BUILDABLE_SHAPE_OPS.has(shapeStmt.op)) {
      return fail(`part "${p.id}" shape op "${shapeStmt.op}" is not bakeable into a colored object (expected a primitive / CSG / Parts / composite shape, or a g_mesh reference to a pre-baked <sha>.obj)`);
    }
    // 提前校验扩展名：baker.service.ts 的 loadMeshPartRawMesh 只接受 <sha>.obj（逐件
    // g_bake_part 的产物）——.glb（比如 g_storey_stack 合并楼层的产物）没有裸三角面可读，
    // 深到 bakeColoredAssembly 内部才报错。这里提前挡掉，报错更直接，也不依赖真 baker
    // 才能测到（假 baker 的单测不会走到 loadMeshPartRawMesh 那层校验）。
    if (shapeStmt.op === 'mesh') {
      const filename = readString(shapeStmt.args.filename);
      const ext = filename ? filename.slice(filename.lastIndexOf('.')).toLowerCase() : '';
      if (ext !== '.obj') {
        return fail(`part "${p.id}" references mesh "${filename ?? '(missing filename)'}" — only per-part <sha>.obj (from g_bake_part) can be merged into one colored/skinnable object, not "${ext || '(no ext)'}"`);
      }
    }
    const rgba = resolveRgba(p.args.material, byId);
    const extras = resolveMaterialExtras(p.args.material, byId);
    const originRes = readNumListStrict(p.args.origin, 3, `part "${p.id}" origin`);
    if (originRes.error) return fail(originRes.error);
    const origin = originRes.value as [number, number, number] | undefined;
    const rpyRes = readNumListStrict(p.args.rpy, 3, `part "${p.id}" rpy`);
    if (rpyRes.error) return fail(rpyRes.error);
    const rpy = rpyRes.value as [number, number, number] | undefined;

    let texture: ColoredAssemblyPartTextureInput | undefined;
    if (extras.textureId) {
      const resolved = resolveTexture(extras.textureId, byId, ctx?.services?.assetsDir);
      if (resolved.error) {
        return fail(`part "${p.id}" material texture: ${resolved.error}`);
      }
      texture = resolved.texture;
    }

    parts.push({
      shapeId: shapeRef.name,
      rgba,
      ...(origin ? { origin } : {}),
      ...(rpy ? { rpy } : {}),
      ...(extras.metalness !== undefined ? { metalness: extras.metalness } : {}),
      ...(extras.roughness !== undefined ? { roughness: extras.roughness } : {}),
      ...(texture ? { texture } : {}),
    });
  }

  const baker = ctx?.services?.baker;
  if (!baker?.bakeColoredAssembly) {
    return fail('baker.bakeColoredAssembly is unavailable on ctx.services.baker; cannot bake colored object');
  }

  try {
    const res = await baker.bakeColoredAssembly(parts, geom);
    const bboxMin = res.bboxMin ?? null;
    const bboxMax = res.bboxMax ?? null;
    const size = bboxMin && bboxMax
      ? [bboxMax[0] - bboxMin[0], bboxMax[1] - bboxMin[1], bboxMax[2] - bboxMin[2]] as [number, number, number]
      : null;
    const round3 = (v: readonly number[]): number[] => v.map((n) => Math.round(n * 1e6) / 1e6);
    const sizeNote = size
      ? `; size≈[${round3(size).join(', ')}] m`
      : '';
    const skipNote = skippedMeshParts > 0
      ? ` Left ${skippedMeshParts} pre-baked mesh part${skippedMeshParts === 1 ? '' : 's'} out (include_mesh_parts=false); they stay separate scene items.`
      : '';

    // 登记到项目烘焙清单，供 lowpoly:parts.list 廉价查询 + mesh-aware QC 取真实 bbox
    // （否则任何后续对这个物体的 mesh(filename=<sha>.glb) 引用只能拿到参数化 AABB，
    // 多材质装配体永远得不到 mesh-aware 检测）。用 sha 命名——这个物体没有单一 shape_id。
    // 登记失败绝不影响 bake 结果（parts registry 内部已 try/catch）。
    if (bboxMin && bboxMax) {
      ctx?.services?.parts?.register({
        name: `object_${res.sha256.slice(0, 12)}`,
        filename: res.url,
        sha256: res.sha256,
        bbox_min: round3(bboxMin),
        bbox_max: round3(bboxMax),
        dims: size ? round3(size) : [],
        vertexCount: res.vertexCount,
        triangleCount: res.triangleCount,
      });
    }

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
      note: `baked colored object (${parts.length} part${parts.length === 1 ? '' : 's'}) → ${res.url}${res.cacheHit ? ' (cache hit)' : ''}${sizeNote}. Reference via g_mesh(filename=<sha>.glb) WITHOUT a link material so the embedded per-part colors show.${skipNote}`,
      error: '',
    };
  } catch (e) {
    return fail(`colored object bake failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** 解析 part.material(ref) → 该 material 语句的 rgba；缺省 / 非法回退到灰。 */
function resolveRgba(
  materialArg: Arg | undefined,
  byId: ReadonlyMap<string, Statement>,
): [number, number, number, number] {
  if (!materialArg || materialArg.kind !== 'ref') return DEFAULT_RGBA;
  const mat = byId.get(materialArg.name);
  if (!mat || mat.op !== 'material') return DEFAULT_RGBA;
  const rgba = readNumList(mat.args.rgba, 4);
  if (!rgba) return DEFAULT_RGBA;
  return [
    clamp01(rgba[0]),
    clamp01(rgba[1]),
    clamp01(rgba[2]),
    clamp01(rgba[3]),
  ];
}

/** 解析 part.material(ref) → 该 material 语句的 metalness/roughness/texture(ref→id)。 */
function resolveMaterialExtras(
  materialArg: Arg | undefined,
  byId: ReadonlyMap<string, Statement>,
): { metalness?: number; roughness?: number; textureId?: string } {
  if (!materialArg || materialArg.kind !== 'ref') return {};
  const mat = byId.get(materialArg.name);
  if (!mat || mat.op !== 'material') return {};
  const metalness = readNumber(mat.args.metalness);
  const roughness = readNumber(mat.args.roughness);
  const textureArg = mat.args.texture;
  const textureId = textureArg && textureArg.kind === 'ref' ? textureArg.name : undefined;
  return {
    ...(metalness !== undefined ? { metalness: clamp01(metalness) } : {}),
    ...(roughness !== undefined ? { roughness: clamp01(roughness) } : {}),
    ...(textureId ? { textureId } : {}),
  };
}

/**
 * 解析 texture(ref) → 读出 image 路径（相对工程 assets/textures/），从磁盘读字节 +
 * 按扩展名猜 MIME，附带 repeat/offset/rotation。assetsDir 缺失或文件读不到都是错误
 * （贴图电池已明确约定这个落点，读不到大概率是用户忘了把文件放进去）。
 */
function resolveTexture(
  textureId: string,
  byId: ReadonlyMap<string, Statement>,
  assetsDir: string | undefined,
): { texture?: ColoredAssemblyPartTextureInput; error?: string } {
  const tex = byId.get(textureId);
  if (!tex) return { error: `texture "${textureId}" not found in geometry` };
  if (tex.op !== 'texture') return { error: `"${textureId}" is not a texture() statement (op="${tex.op}")` };

  const image = readString(tex.args.image);
  if (!image) return { error: `texture "${textureId}" is missing required "image"` };
  if (!assetsDir) {
    return { error: 'ctx.services.assetsDir is unavailable; cannot resolve texture image path' };
  }

  // image 约定是相对 assets/textures/ 的路径；拒绝逃出该目录（.. 穿越）。
  const rel = normalize(join('textures', image));
  if (isAbsolute(image) || rel.startsWith('..')) {
    return { error: `texture "${textureId}" image path "${image}" must be relative to assets/textures/ (no absolute paths or "..")` };
  }
  const abs = join(assetsDir, rel);

  let imageBytes: Buffer;
  try {
    imageBytes = readFileSync(abs);
  } catch (e) {
    return { error: `texture "${textureId}" failed to read image "${rel}" under assetsDir: ${e instanceof Error ? e.message : String(e)}` };
  }

  const dot = image.lastIndexOf('.');
  const ext = dot >= 0 ? image.slice(dot).toLowerCase() : '';
  const mime = MIME_BY_EXT[ext];
  if (!mime) {
    return { error: `texture "${textureId}" image "${image}" has unsupported extension "${ext}" (expected one of: ${Object.keys(MIME_BY_EXT).join(', ')})` };
  }

  const repeat = readNumList(tex.args.repeat, 2);
  const offset = readNumList(tex.args.offset, 2);
  const rotation = readNumber(tex.args.rotation);

  return {
    texture: {
      imageBytes,
      mime,
      ...(repeat ? { repeatU: repeat[0], repeatV: repeat[1] } : {}),
      ...(offset ? { offsetU: offset[0], offsetV: offset[1] } : {}),
      ...(rotation !== undefined ? { rotation } : {}),
    },
  };
}

function readString(a: Arg | undefined): string | undefined {
  return a && a.kind === 'string' ? a.value : undefined;
}

function readNumber(a: Arg | undefined): number | undefined {
  return a && a.kind === 'number' ? a.value : undefined;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** 布尔端口：编辑器可能给 boolean，也可能给 "false" / "0" 这样的字符串。 */
function readBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === '') return fallback;
    return !(s === 'false' || s === '0' || s === 'no' || s === 'off');
  }
  return fallback;
}

function readNumList(a: Arg | undefined, n?: number): number[] | undefined {
  if (!a || a.kind !== 'list') return undefined;
  const out: number[] = [];
  for (const item of a.items) {
    if (item.kind !== 'number') return undefined;
    out.push(item.value);
  }
  if (n !== undefined && out.length !== n) return undefined;
  return out;
}

/**
 * 同 readNumList，但对"给了值却格式不对"报错，而不是静默吞掉退化成单位变换。
 * origin/rpy 这类位姿参数一旦写错长度（比如手误漏了一个轴），保持沉默会让 part 悄悄
 * 摆在原点/零旋转，肉眼很难从烘出来的 GLB 反查到是这里的错——直接报错更快定位。
 * 完全没给（undefined）仍然是合法的"用默认值"，不报错。
 */
function readNumListStrict(a: Arg | undefined, n: number, label: string): { value?: number[]; error?: string } {
  if (a === undefined) return {};
  if (a.kind !== 'list') return { error: `${label} must be a list of ${n} numbers, got ${a.kind}` };
  const out: number[] = [];
  for (const item of a.items) {
    if (item.kind !== 'number') return { error: `${label} must be a list of ${n} numbers (found a non-number entry)` };
    out.push(item.value);
  }
  if (out.length !== n) return { error: `${label} must have exactly ${n} numbers, got ${out.length}` };
  return { value: out };
}

export default gBakeObject;
