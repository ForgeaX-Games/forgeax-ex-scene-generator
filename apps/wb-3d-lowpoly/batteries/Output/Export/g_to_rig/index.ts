/**
 * g_to_rig —— 角色路的终端编译器：Geometry(bone/skeleton/skin/animation) → RigSpec JSON。
 *
 * RigSpec 是角色 IR（类比 URDF）：骨架 + 可蒙皮网格引用 + skin 参数 + 骨骼动画 clip，
 * **不含权重**——权重由前端测地体素绑定按需求解。可蒙皮网格：
 *   - skin.mesh 显式引用 g_mesh(filename=<sha>.glb) → 用它的 filename；
 *   - 否则用 mesh_filename 输入端口（由 g_bake_object 合并所有 part 的 <sha>.glb 提供）。
 *
 * 产出 rigSpec 对象（供 rig_preview / live-sync）+ report.fingerprint（回执指纹）。
 */

import { createHash } from 'node:crypto';
import {
  parseGeometryPort,
  makeGeometry,
  parseJointAnimationClip,
  readVec3,
  type Geometry,
  type Statement,
} from '../../../../vendor/dist/shared/types/index.js';

interface RigBone {
  name: string;
  parent: string | null;
  head: [number, number, number];
  tail: [number, number, number];
  /** 可选弯曲铰链轴（模型根帧）；作者在 bone(axis=…) 显式声明时写入。 */
  axis?: [number, number, number];
  // 故意不读 bone 的 source_part / rpy：source_part 只是溯源提示（validate.ts 已校验引用
  // 有效），rpy 目前没有消费方（rest 朝向由 head/tail 决定）——两者都不影响蒙皮/预览，
  // 见 op-registry.ts 的 bone desc。真要接进来，从这里开始加字段 + 前端 character-builder.ts
  // 的骨架构建一起改。
}
interface RigClip {
  name: string;
  fps: number;
  frameCount: number;
  loop: boolean;
  channels: Record<string, number[]>;
  /** 模型根帧中的 bind-relative 根骨位移（米），目标固定为 RigSpec.skeletonRoot。 */
  rootTranslation?: [number, number, number][];
}
interface RigSpec {
  version: 1;
  meshFilename: string;
  skeletonRoot: string;
  bones: RigBone[];
  boneCount: number;
  skin: { method: 'auto' | 'rigid'; resolution: number; maxInfluences: number; falloff: number };
  clips: RigClip[];
}

export function gToRig(input: Record<string, unknown>): Record<string, unknown> {
  const geom: Geometry = parseGeometryPort(input.geometry) ?? makeGeometry();
  const fail = (error: string): Record<string, unknown> => ({
    rigSpec: null,
    rig_json: '',
    report: null,
    geometry: geom,
    error,
  });

  const byId = new Map<string, Statement>(geom.statements.map((s) => [s.id, s]));
  const boneStmts = geom.statements.filter((s) => s.op === 'bone');
  const skeletonStmts = geom.statements.filter((s) => s.op === 'skeleton');
  const skinStmts = geom.statements.filter((s) => s.op === 'skin');

  if (boneStmts.length === 0) return fail('g_to_rig: no bone() statements');
  if (skeletonStmts.length !== 1) {
    return fail(`g_to_rig: expected exactly one skeleton() statement, found ${skeletonStmts.length}`);
  }

  // 骨骼列表（name = bone 语句 id）
  const bones: RigBone[] = [];
  for (const b of boneStmts) {
    const head = readVec3(b.args.origin);
    if (!head) return fail(`g_to_rig: bone "${b.id}" missing origin`);
    let tail = readVec3(b.args.tail);
    if (!tail) {
      // 缺省 tail：沿 +Z 一小段（前端也会兜底）
      tail = [head[0], head[1], head[2] + 0.05];
    }
    const parent = b.args.parent;
    const axis = readVec3(b.args.axis);
    const bone: RigBone = {
      name: b.id,
      parent: parent?.kind === 'ref' ? parent.name : null,
      head: [head[0], head[1], head[2]],
      tail: [tail[0], tail[1], tail[2]],
    };
    if (
      axis &&
      axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2] > 1e-12
    ) {
      bone.axis = [axis[0], axis[1], axis[2]];
    }
    bones.push(bone);
  }

  // skeleton root
  const rootRef = skeletonStmts[0].args.root;
  const skeletonRoot = rootRef?.kind === 'ref' ? rootRef.name : bones[0].name;
  if (!bones.some((bone) => bone.name === skeletonRoot)) {
    return fail(`g_to_rig: skeleton root "${skeletonRoot}" is not a bone()`);
  }

  // skin 参数 + 可蒙皮网格来源
  const skin = skinStmts[0];
  const method = readStr(skin?.args.method) === 'rigid' ? 'rigid' : 'auto';
  // [4, 96] 必须与前端 voxel-skin.ts 的 MIN_RESOLUTION/MAX_RESOLUTION 保持一致：那里是体素网格
  // 分辨率的硬约束（4=格子太粗判不出内外，96=浏览器主线程会卡），这里若给更宽的范围只会让
  // RigSpec 里回显的 resolution 撒谎——真正跑体素求解时还是会被那边悄悄夹取到 96，兩边不一致
  // 就等于给调用方一个从未真正生效过的数字。改动任一边的边界值必须同步改另一边。
  const resolution = clampInt(readNum(skin?.args.resolution), 48, 4, 96);
  // 默认偏硬（maxInfluences=2, falloff=5）：低模动作形变更克制；要软可在 skin(...) 显式放宽。
  const maxInfluences = clampInt(readNum(skin?.args.max_influences), 2, 1, 4);
  const falloff = readNum(skin?.args.falloff) ?? 5;

  let meshFilename = '';
  const meshRef = skin?.args.mesh;
  if (meshRef?.kind === 'ref') {
    const m = byId.get(meshRef.name);
    const fn = m?.op === 'mesh' ? readStr(m.args.filename) : undefined;
    if (fn) meshFilename = fn;
  }
  if (!meshFilename) {
    // 由 g_bake_object 合并 part 提供（wired input port）
    meshFilename = typeof input.mesh_filename === 'string' ? input.mesh_filename : '';
  }
  if (!meshFilename) {
    return fail('g_to_rig: no skinnable mesh — expected g_bake_object filename (wired) or an explicit skin(mesh=...) ref');
  }

  // 骨骼动画 clips：channels 键 = 骨骼名。
  const boneNames = new Set(bones.map((b) => b.name));
  const clips: RigClip[] = [];
  for (const a of geom.statements.filter((s) => s.op === 'animation')) {
    const qjson = readStr(a.args.q_json);
    if (!qjson) continue;
    const parsed = parseJointAnimationClip(qjson);
    if (!parsed.clip) return fail(`g_to_rig: invalid animation "${a.id}": ${parsed.error}`);
    // 只保留命中骨骼名的通道（关节路的 clip 会被过滤为空 → 跳过）
    const channels: Record<string, number[]> = {};
    for (const [k, v] of Object.entries(parsed.clip.channels)) {
      if (boneNames.has(k)) channels[k] = v;
    }
    const rootTranslation = parsed.clip.rootTranslation;
    if (Object.keys(channels).length === 0 && !rootTranslation) continue;
    if (!Number.isFinite(parsed.clip.fps) || parsed.clip.fps <= 0) {
      return fail(`g_to_rig: animation "${a.id}" has invalid fps ${parsed.clip.fps}`);
    }
    if (!Number.isInteger(parsed.clip.frameCount) || parsed.clip.frameCount < 2) {
      return fail(`g_to_rig: animation "${a.id}" has invalid frameCount ${parsed.clip.frameCount}`);
    }
    for (const [name, series] of Object.entries(channels)) {
      if (series.length !== parsed.clip.frameCount) {
        return fail(
          `g_to_rig: animation "${a.id}" channel "${name}" has ${series.length} frames, expected ${parsed.clip.frameCount}`,
        );
      }
    }
    if (rootTranslation && rootTranslation.length !== parsed.clip.frameCount) {
      return fail(
        `g_to_rig: animation "${a.id}" rootTranslation has ${rootTranslation.length} frames, expected ${parsed.clip.frameCount}`,
      );
    }
    const rigClip: RigClip = {
      name: parsed.clip.name || a.id,
      fps: parsed.clip.fps,
      frameCount: parsed.clip.frameCount,
      loop: parsed.clip.loop === true,
      channels,
    };
    if (rootTranslation) {
      rigClip.rootTranslation = rootTranslation.map((v) => [v[0], v[1], v[2]]);
    }
    clips.push(rigClip);
  }

  const rigSpec: RigSpec = {
    version: 1,
    meshFilename,
    skeletonRoot,
    bones,
    boneCount: bones.length,
    skin: { method, resolution, maxInfluences, falloff },
    clips,
  };

  const rigJson = JSON.stringify(rigSpec);
  const fingerprint = createHash('sha256').update(rigJson).digest('hex').slice(0, 16);

  return {
    rigSpec,
    rig_json: rigJson,
    report: { fingerprint, boneCount: bones.length, clipCount: clips.length, meshFilename },
    geometry: geom,
    error: '',
  };
}

function readStr(a: { kind: string; value?: unknown } | undefined): string | undefined {
  return a && a.kind === 'string' && typeof a.value === 'string' ? a.value : undefined;
}
function readNum(a: { kind: string; value?: unknown } | undefined): number | undefined {
  return a && a.kind === 'number' && typeof a.value === 'number' ? a.value : undefined;
}
function clampInt(v: number | undefined, dflt: number, lo: number, hi: number): number {
  const n = v === undefined ? dflt : Math.round(v);
  return Math.max(lo, Math.min(hi, n));
}

export default gToRig;
