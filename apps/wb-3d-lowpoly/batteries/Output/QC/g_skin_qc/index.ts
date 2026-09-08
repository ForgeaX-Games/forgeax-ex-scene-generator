/**
 * g_skin_qc —— 角色骨架 / 蒙皮的静态质量检查（只读，无 baker）。
 *
 * 检查项：
 *   ① skeleton 存在且 root 指向一根真实 bone。
 *   ② bone 父链无环、父引用可解析；根之外每根骨最终能回到 root。
 *   ③ 骨长非零（head != tail）——零长骨在前端会退化成零权重区。
 *   ④ skin 存在、skeleton 引用有效；mesh(ref) 若给出须解析到一个 shape。
 *   ⑤ 可蒙皮网格来源：显式 mesh 或"合并所有 part"——至少要有 part 或 mesh。
 *   ⑥ 运行时权重诊断（可选，见下）：体素测地绑定的 unreachableVertexCount /
 *      unreachableBones 非零时打一条非致命警告。
 *
 * 权重相关校验（权重和=1 / 无零权重 / 弯曲不裂）以及 ⑥ 依赖真实三角面顶点数据，DSL
 * 编译期（`model.apply` 跑到这个电池时）还没有 bake 出网格，算不出来——只有前端真正跑过
 * `computeSkinWeightsVoxel`（`voxel-skin.ts`）之后才存在这份诊断。因此 ⑥ 是**可选输入**
 * （`weight_diagnostics`）：调用方（无头渲染/回归脚本，或未来的 live-sync 回传）如果把
 * 求解后的诊断喂进来，这里就补上警告；不喂时该检查静默跳过，不影响其余纯 DSL 静态检查。
 * 输出与 g_geometry_qc 同构：valid + report + 结构化 signals，几何透传。
 */

import {
  isGeometry,
  readVec3,
  type Geometry,
  type Statement,
} from '../../../../vendor/dist/shared/types/index.js';

interface WeightDiagnostics {
  unreachableVertexCount: number;
  /** 骨骼名（不是 voxel-skin.ts 内部的数组下标——调用方在喂进来之前需要自己做下标→名映射）。 */
  unreachableBoneNames: string[];
}

/** 接受 object 或 JSON 字符串两种形式（与本仓库其它"json kind"端口的宽松解析习惯一致）。 */
function parseWeightDiagnostics(raw: unknown): WeightDiagnostics | null {
  let value: unknown = raw;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    try {
      value = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const unreachableVertexCount = typeof obj.unreachableVertexCount === 'number' && Number.isFinite(obj.unreachableVertexCount)
    ? Math.max(0, Math.round(obj.unreachableVertexCount))
    : 0;
  const unreachableBoneNames = Array.isArray(obj.unreachableBoneNames)
    ? obj.unreachableBoneNames.filter((n): n is string => typeof n === 'string')
    : [];
  return { unreachableVertexCount, unreachableBoneNames };
}

type Severity = 'error' | 'warning' | 'note';
interface Signal {
  code: string;
  severity: Severity;
  message: string;
  ids?: string[];
}

export function gSkinQc(input: Record<string, unknown>): Record<string, unknown> {
  const geom = isGeometry(input.geometry) ? (input.geometry as Geometry) : null;
  if (!geom) {
    return { geometry: null, valid: false, report: 'no Geometry input', bones: 0, skins: 0, signals: [] };
  }

  const byId = new Map<string, Statement>(geom.statements.map((s) => [s.id, s]));
  const bones = geom.statements.filter((s) => s.op === 'bone');
  const skeletons = geom.statements.filter((s) => s.op === 'skeleton');
  const skins = geom.statements.filter((s) => s.op === 'skin');
  const parts = geom.statements.filter((s) => s.op === 'part');

  const signals: Signal[] = [];
  const push = (code: string, severity: Severity, message: string, ids?: string[]): void => {
    signals.push({ code, severity, message, ...(ids && ids.length ? { ids } : {}) });
  };

  // ① skeleton / root
  if (skeletons.length === 0) {
    push('no_skeleton', 'error', 'character path has no skeleton() statement');
  }
  for (const sk of skeletons) {
    const root = sk.args.root;
    if (!root || root.kind !== 'ref' || byId.get(root.name)?.op !== 'bone') {
      push('skeleton_root_invalid', 'error', `skeleton "${sk.id}" root must reference a bone`, [sk.id]);
    }
  }

  // ② bone 父链无环 + ③ 骨长
  const boneIds = new Set(bones.map((b) => b.id));
  for (const b of bones) {
    const parent = b.args.parent;
    if (parent?.kind === 'ref') {
      if (!boneIds.has(parent.name)) {
        push('bone_parent_missing', 'error', `bone "${b.id}" parent "${parent.name}" is not a bone`, [b.id]);
      }
    }
    // 环检测
    const seen = new Set<string>([b.id]);
    let cur: string | undefined = b.id;
    while (cur) {
      const st = byId.get(cur);
      const par = st?.args.parent;
      if (!par || par.kind !== 'ref') break;
      if (seen.has(par.name)) {
        push('bone_cycle', 'error', `bone "${b.id}" is part of a parent cycle`, [b.id]);
        break;
      }
      seen.add(par.name);
      cur = par.name;
    }
    // 骨长
    const head = readVec3(b.args.origin);
    const tail = readVec3(b.args.tail);
    if (head && tail) {
      const len = Math.hypot(head[0] - tail[0], head[1] - tail[1], head[2] - tail[2]);
      if (len < 1e-4) {
        push('bone_zero_length', 'warning', `bone "${b.id}" has ~zero length (head≈tail); it will bind almost no vertices`, [b.id]);
      }
    } else if (!head) {
      push('bone_no_origin', 'error', `bone "${b.id}" is missing origin=[x,y,z]`, [b.id]);
    }
  }

  // ④ skin skeleton / mesh
  const skeletonIds = new Set(skeletons.map((s) => s.id));
  for (const sk of skins) {
    const skel = sk.args.skeleton;
    if (!skel || skel.kind !== 'ref' || !skeletonIds.has(skel.name)) {
      push('skin_skeleton_invalid', 'error', `skin "${sk.id}" skeleton must reference a skeleton()`, [sk.id]);
    }
    const mesh = sk.args.mesh;
    if (mesh?.kind === 'ref') {
      const m = byId.get(mesh.name);
      if (!m) push('skin_mesh_missing', 'error', `skin "${sk.id}" mesh "${mesh.name}" not found`, [sk.id]);
    } else if (parts.length === 0) {
      push('skin_no_mesh', 'error', `skin "${sk.id}" has no explicit mesh and there are no part()s to merge`, [sk.id]);
    }
  }

  if (bones.length === 0) push('no_bones', 'error', 'character path has no bone() statements');

  // ⑥ 运行时权重诊断（可选，见模块头注释）。
  const weightDiag = parseWeightDiagnostics(input.weight_diagnostics);
  if (weightDiag) {
    if (weightDiag.unreachableVertexCount > 0) {
      push(
        'skin_unreachable_vertices',
        'warning',
        `${weightDiag.unreachableVertexCount} vertex(es) are not reachable by any bone in the voxel geodesic field (fell back to bone 0 with full weight)`,
      );
    }
    if (weightDiag.unreachableBoneNames.length > 0) {
      push(
        'skin_unreachable_bones',
        'warning',
        `bone(s) do not intersect the skinned mesh's solid volume and bind no vertices via the voxel path: ${weightDiag.unreachableBoneNames.join(', ')}`,
        weightDiag.unreachableBoneNames,
      );
    }
  }

  const fatal = signals.some((s) => s.severity === 'error');
  const report = signals.map((s) => `${s.code}: ${s.message}`).join('\n');
  return {
    geometry: geom,
    valid: !fatal,
    bones: bones.length,
    skins: skins.length,
    report,
    signals,
  };
}

export default gSkinQc;
