/**
 * g_to_scene —— 静态路的终端编译器：Geometry(part/mesh/material) → SceneSpec JSON。
 *
 * SceneSpec 是静态路的 IR（类比 URDF / RigSpec）：一组**已置位、已上色的网格引用**，
 * 前端 3D 预览器直接加载并组合成一个静态场景，导出时合并成单个 `.glb`。
 *
 * 两种来源：
 *   - 单物体（真形状 part）：上游 g_bake_object 已把所有 part 合并成一个多材质 `<sha>.glb`，
 *     经 object_filename 输入端口传入 → SceneSpec 里一条内嵌色 mesh 引用（无 rgba/位姿）。
 *   - 场景组装（mesh-ref part）：每个 `part(shape=mesh(filename=<sha>.obj), origin, rpy, material)`
 *     → 一条带位姿 + 颜色的 mesh 引用。
 *
 * 不含 URDF / joint / robot 语义——纯静态。容错：不抛异常，失败写 error 并透传 geometry。
 */

import { createHash } from 'node:crypto';
import {
  parseGeometryPort,
  makeGeometry,
  type Arg,
  type Geometry,
  type Statement,
} from '../../../../vendor/dist/shared/types/index.js';

interface SceneItem {
  meshFilename: string;
  origin?: [number, number, number];
  rpy?: [number, number, number];
  scale?: [number, number, number];
  rgba?: [number, number, number, number];
  metalness?: number;
  roughness?: number;
}
interface SceneSpec {
  version: 1;
  items: SceneItem[];
  itemCount: number;
}

export function gToScene(input: Record<string, unknown>): Record<string, unknown> {
  const geom: Geometry = parseGeometryPort(input.geometry) ?? makeGeometry();
  const fail = (error: string): Record<string, unknown> => ({
    sceneSpec: null,
    scene_json: '',
    report: null,
    geometry: geom,
    error,
  });

  const byId = new Map<string, Statement>(geom.statements.map((s) => [s.id, s]));
  const parts = geom.statements.filter((s) => s.op === 'part');
  const items: SceneItem[] = [];

  // 单物体：g_bake_object 合并出的多材质 GLB（内嵌色，无位姿/材质覆盖）。
  const objectFilename = typeof input.object_filename === 'string' ? input.object_filename : '';
  if (objectFilename) items.push({ meshFilename: objectFilename });

  // 场景组装：逐 part 解析 mesh 引用 + 位姿 + 颜色。
  for (const p of parts) {
    const shapeRef = p.args.shape;
    // 缺 shape ref / 指向不存在的语句都是真损坏（手改图或上游 bug），报错而不是静默跳过
    // ——否则这个 part 就这么从场景里消失了，agent 只会看到 itemCount 少了一个，
    // 完全不知道是哪个 part、为什么。
    if (!shapeRef || shapeRef.kind !== 'ref') {
      return fail(`part "${p.id}" is missing a shape ref`);
    }
    const shape = byId.get(shapeRef.name);
    if (!shape) {
      return fail(`part "${p.id}" references unknown shape "${shapeRef.name}"`);
    }
    if (shape.op !== 'mesh') continue; // 真形状 part 已由 object bake 覆盖（objectFilename）
    const filename = readStr(shape.args.filename);
    if (!filename) return fail(`part "${p.id}" references mesh "${shapeRef.name}" with no filename`);

    const origin = readVec(p.args.origin, 3) as [number, number, number] | undefined;
    const rpy = readVec(p.args.rpy, 3) as [number, number, number] | undefined;
    const scale = readVec(shape.args.scale, 3) as [number, number, number] | undefined;
    const rgba = resolveRgba(p.args.material, byId);
    const extras = resolveExtras(p.args.material, byId);

    items.push({
      meshFilename: filename,
      ...(origin ? { origin } : {}),
      ...(rpy ? { rpy } : {}),
      ...(scale ? { scale } : {}),
      ...(rgba ? { rgba } : {}),
      ...(extras.metalness !== undefined ? { metalness: extras.metalness } : {}),
      ...(extras.roughness !== undefined ? { roughness: extras.roughness } : {}),
    });
  }

  if (items.length === 0) {
    return fail(
      'g_to_scene: no renderable parts. Build a static object as g_part links wrapping REAL shapes ' +
        '(baked to one GLB), or a scene as g_part links wrapping mesh(filename=<sha>.obj) refs.',
    );
  }

  const sceneSpec: SceneSpec = { version: 1, items, itemCount: items.length };
  const sceneJson = JSON.stringify(sceneSpec);
  const fingerprint = createHash('sha256').update(sceneJson).digest('hex').slice(0, 16);

  return {
    sceneSpec,
    scene_json: sceneJson,
    report: { fingerprint, itemCount: items.length },
    geometry: geom,
    error: '',
  };
}

/** part.material(ref) → rgba；缺省 / 无 material 返回 undefined（前端用默认灰）。 */
function resolveRgba(
  materialArg: Arg | undefined,
  byId: ReadonlyMap<string, Statement>,
): [number, number, number, number] | undefined {
  if (!materialArg || materialArg.kind !== 'ref') return undefined;
  const mat = byId.get(materialArg.name);
  if (!mat || mat.op !== 'material') return undefined;
  const rgba = readVec(mat.args.rgba, 4);
  if (!rgba) return undefined;
  return [clamp01(rgba[0]), clamp01(rgba[1]), clamp01(rgba[2]), clamp01(rgba[3])];
}

/** part.material(ref) → metalness / roughness。 */
function resolveExtras(
  materialArg: Arg | undefined,
  byId: ReadonlyMap<string, Statement>,
): { metalness?: number; roughness?: number } {
  if (!materialArg || materialArg.kind !== 'ref') return {};
  const mat = byId.get(materialArg.name);
  if (!mat || mat.op !== 'material') return {};
  const metalness = readNum(mat.args.metalness);
  const roughness = readNum(mat.args.roughness);
  return {
    ...(metalness !== undefined ? { metalness: clamp01(metalness) } : {}),
    ...(roughness !== undefined ? { roughness: clamp01(roughness) } : {}),
  };
}

function readStr(a: Arg | undefined): string | undefined {
  return a && a.kind === 'string' && a.value !== '' ? a.value : undefined;
}
function readNum(a: Arg | undefined): number | undefined {
  return a && a.kind === 'number' ? a.value : undefined;
}
function readVec(a: Arg | undefined, n: number): number[] | undefined {
  if (!a || a.kind !== 'list') return undefined;
  const out: number[] = [];
  for (const item of a.items) {
    if (item.kind !== 'number') return undefined;
    out.push(item.value);
  }
  return out.length === n ? out : undefined;
}
function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export default gToScene;
