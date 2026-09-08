/**
 * g_bake_skin_animation —— 校验角色骨骼轨迹 q(t) 并追加 `animation` 语句（角色路）。
 *
 * 与 g_bake_animation 的区别：通道键是**骨骼名**（== DSL bone 语句 id），不是 URDF
 * 关节名；值 = 绕骨骼弯曲(铰链)轴的弯曲角（弧度）——弯曲轴**不固定是局部 X**：优先取
 * 作者在 `bone(axis=[x,y,z])` 里显式声明的轴，未声明时按 head→tail 朝向启发式推一个轴
 * （竖直骨→前后摆，水平骨→上下摆；具体算法见前端 character-builder.ts 的
 * `resolveBoneBendAxis`，两边必须保持同一套推导逻辑，否则预览和实际播放轴不一致）。
 * 骨骼是自由骨，没有 URDF 轴 / 限位，所以这里**不做限位夹取**，只校验通道键确实指向存在的 bone。
 *
 * 职责：解析 q(t)（motion 端口 > q_json 完整逐帧 JSON > keyframes 稀疏关键帧 > q_path 文件）
 *   → 对照 geometry 里的 bone 校验通道键 →
 *   - 通过：`emit('animation', {q_json})` 追加语句（自包含），几何前进；下游 g_to_rig
 *     会挑出命中骨骼名的通道构成 RigSpec.clips；前端按骨骼局部 X 弯曲播放。
 *   - 失败：几何原样透传，`error` 返回错误（沿用 g_bake_animation 约定）。
 *
 * `keyframes` 是 agent 描述动作的首选入口：只给每骨几个 {t,q} 点，按 fps/duration 采样
 * + 关键帧间线性插值（或阶梯保持）展开成逐帧数组，单条 DSL 语句即可。
 */

import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import {
  emit,
  freshId,
  isValidId,
  makeGeometry,
  num,
  str,
  bool,
  parseGeometryPort,
  parseJointAnimationClip,
  type Arg,
  type Geometry,
  type JointAnimationClip,
} from '../../../../vendor/dist/shared/types/index.js';

type QtSource =
  | { kind: 'clip'; value: unknown }
  | { kind: 'keyframes'; value: unknown }
  | { kind: 'none'; error: string | null };

interface Keyframe {
  t: number;
  q: number;
}
interface RootKeyframe {
  t: number;
  x: number;
  y: number;
  z: number;
}

export function gBakeSkinAnimation(input: Record<string, unknown>): Record<string, unknown> {
  const incoming: Geometry = parseGeometryPort(input.geometry) ?? makeGeometry();

  const fail = (error: string, animation: unknown = null, report: unknown = null): Record<string, unknown> =>
    ({ geometry: incoming, animation, report, error });

  // 骨骼名集合（通道键必须命中）+ 唯一骨架根（根位移的唯一目标）。
  const boneIds = new Set(incoming.statements.filter((s) => s.op === 'bone').map((s) => s.id));
  if (boneIds.size === 0) {
    return fail('g_bake_skin_animation: no bone() statements — build a skeleton first (write bone/skeleton), then bake bone motion');
  }
  const skeletons = incoming.statements.filter((s) => s.op === 'skeleton');
  if (skeletons.length !== 1) {
    return fail(`g_bake_skin_animation: expected exactly one skeleton(), found ${skeletons.length}`);
  }
  const rootArg = skeletons[0].args.root;
  const skeletonRoot = rootArg?.kind === 'ref' ? rootArg.name : '';
  if (!skeletonRoot || !boneIds.has(skeletonRoot)) {
    return fail('g_bake_skin_animation: skeleton root must reference an existing bone()');
  }

  // 1) 解析 q(t)（优先级：motion 端口 > q_json 完整 JSON > keyframes 稀疏关键帧 > q_path 文件）
  const source = resolveQtSource(input);
  const parsedRootMotion = parseRootMotionJson(input.root_motion);
  if (parsedRootMotion.error) return fail(`g_bake_skin_animation: ${parsedRootMotion.error}`);
  if (source.kind === 'none' && source.error) return fail(source.error);
  if (source.kind === 'none' && !parsedRootMotion.data) {
    return fail(source.error ?? 'no q(t) provided (wire `motion`, or set q_json / keyframes / q_path)');
  }

  let clip: JointAnimationClip;
  if (source.kind === 'keyframes') {
    const sampled = sampleKeyframesToClip(source.value, parsedRootMotion.data, input);
    if (!sampled.clip) return fail(sampled.error ?? 'failed to sample keyframes');
    clip = sampled.clip;
  } else if (source.kind === 'none') {
    const sampled = sampleKeyframesToClip(null, parsedRootMotion.data, input);
    if (!sampled.clip) return fail(sampled.error ?? 'failed to sample root motion');
    clip = sampled.clip;
  } else {
    const parsed = parseJointAnimationClip(source.value);
    if (!parsed.clip) return fail(parsed.error ?? 'failed to parse q(t)');
    clip = parsed.clip;
  }

  // 2) 参数覆盖：name / fps / loop
  clip = { ...clip, channels: clip.channels };
  const nameParam = String(input.name ?? '').trim();
  if (nameParam) clip.name = nameParam;
  const fpsParam = readFiniteNumber(input.fps);
  if (fpsParam !== undefined && fpsParam > 0) clip.fps = fpsParam;
  if (typeof input.loop === 'boolean') clip.loop = input.loop;
  else if (typeof input.loop === 'string') {
    const l = input.loop.trim().toLowerCase();
    if (l === 'true') clip.loop = true;
    else if (l === 'false') clip.loop = false;
  }
  if (parsedRootMotion.data && source.kind === 'clip') {
    const duration = clip.frameCount > 1 ? (clip.frameCount - 1) / clip.fps : 0;
    const lastT = parsedRootMotion.data[parsedRootMotion.data.length - 1].t;
    if (lastT > duration + 1e-9) {
      return fail(
        `g_bake_skin_animation: root_motion ends at ${lastT}s, beyond clip duration ${duration}s`,
        clip,
      );
    }
    clip.rootTranslation = sampleRootMotion(
      parsedRootMotion.data,
      clip.frameCount,
      clip.fps,
      isStepInterpolation(input.interpolation),
    );
  }

  // 3) 通道键校验：每个通道必须指向一根存在的 bone（无限位夹取——骨骼是自由骨）。
  const channelNames = Object.keys(clip.channels);
  if (channelNames.length === 0 && !clip.rootTranslation) {
    return fail('g_bake_skin_animation: clip has neither bone channels nor root motion', clip, null);
  }
  if (!Number.isFinite(clip.fps) || clip.fps <= 0) {
    return fail(`g_bake_skin_animation: fps must be > 0, got ${clip.fps}`, clip, null);
  }
  if (!Number.isInteger(clip.frameCount) || clip.frameCount < 2) {
    return fail(`g_bake_skin_animation: frameCount must be an integer >= 2, got ${clip.frameCount}`, clip, null);
  }
  for (const [name, series] of Object.entries(clip.channels)) {
    if (series.length !== clip.frameCount) {
      return fail(
        `g_bake_skin_animation: channel "${name}" has ${series.length} frames, expected ${clip.frameCount}`,
        clip,
        null,
      );
    }
  }
  if (clip.rootTranslation && clip.rootTranslation.length !== clip.frameCount) {
    return fail(
      `g_bake_skin_animation: rootTranslation has ${clip.rootTranslation.length} frames, expected ${clip.frameCount}`,
      clip,
      null,
    );
  }
  const unknown = channelNames.filter((n) => !boneIds.has(n));
  if (unknown.length > 0) {
    return fail(
      `g_bake_skin_animation: channel(s) do not reference any bone(): ${unknown.join(', ')}. ` +
        `Channel keys must be bone ids (the id of a bone() statement).`,
      clip,
      null,
    );
  }

  // 4) emit `animation` 语句；q(t) 整体存为 `q_json`（自包含，round-trip 可喂回 model.apply）
  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'skin_anim');
  if (!isValidId(id)) return fail(`invalid id "${id}"`, clip, null);

  const args: Record<string, Arg> = {
    name: str(clip.name),
    fps: num(clip.fps),
    q_json: str(JSON.stringify(clip)),
  };
  if (clip.loop) args.loop = bool(true);

  const next = emit(incoming, id, 'animation', args);
  const report = {
    fps: clip.fps,
    frameCount: clip.frameCount,
    durationSec: clip.frameCount > 1 ? (clip.frameCount - 1) / clip.fps : 0,
    channelCount: channelNames.length,
    boneChannels: channelNames,
    skeletonRoot,
    rootMotion: clip.rootTranslation
      ? { frameCount: clip.rootTranslation.length, coordinateFrame: 'model-root-z-up-x-forward', unit: 'meter' }
      : null,
  };
  return { geometry: next, animation: clip, report, error: '' };
}

/** 按优先级解析 q(t) 原始值：motion 端口 > q_json 完整 JSON > keyframes 稀疏关键帧 > q_path 文件。 */
function resolveQtSource(input: Record<string, unknown>): QtSource {
  const motion = input.motion;
  if (motion !== undefined && motion !== null) {
    if (typeof motion === 'string') {
      if (motion.trim() !== '') return { kind: 'clip', value: motion };
    } else {
      return { kind: 'clip', value: motion };
    }
  }

  const qJson = String(input.q_json ?? '').trim();
  if (qJson !== '') return { kind: 'clip', value: qJson };

  const keyframes = input.keyframes;
  if (typeof keyframes === 'string') {
    if (keyframes.trim() !== '') return { kind: 'keyframes', value: keyframes };
  } else if (keyframes !== undefined && keyframes !== null) {
    return { kind: 'keyframes', value: keyframes };
  }

  const qPath = String(input.q_path ?? '').trim();
  if (qPath !== '') {
    const read = readProjectFile(qPath);
    if (read.text === null) return { kind: 'none', error: read.error };
    return { kind: 'clip', value: read.text };
  }

  return { kind: 'none', error: null };
}

/** 解析 `keyframes` 输入（JSON 字符串或对象）：形态 { 骨骼名: [{t,q}, ...] }，每骨按 t 排序。 */
function parseKeyframesJson(raw: unknown): { data: Record<string, Keyframe[]> | null; error: string | null } {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '') {
      return { data: null, error: 'keyframes is empty: expected JSON { boneName: [{"t":sec,"q":value}, ...], ... }' };
    }
    try {
      obj = JSON.parse(trimmed);
    } catch (e) {
      return { data: null, error: `keyframes is not valid JSON: ${(e as Error).message}` };
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { data: null, error: 'keyframes must be an object: { boneName: [{"t":sec,"q":value}, ...] }' };
  }

  const out: Record<string, Keyframe[]> = {};
  for (const [bone, list] of Object.entries(obj as Record<string, unknown>)) {
    if (!Array.isArray(list) || list.length === 0) {
      return { data: null, error: `keyframes channel "${bone}" must be a non-empty array of {t,q} points` };
    }
    const points: Keyframe[] = [];
    for (const item of list) {
      if (!item || typeof item !== 'object') {
        return { data: null, error: `keyframes channel "${bone}" has a point that is not an object {t,q}` };
      }
      const t = Number((item as Record<string, unknown>).t);
      const q = Number((item as Record<string, unknown>).q);
      if (!Number.isFinite(t) || !Number.isFinite(q)) {
        return { data: null, error: `keyframes channel "${bone}" has a point with non-finite t/q` };
      }
      points.push({ t, q });
    }
    points.sort((a, b) => a.t - b.t);
    out[bone] = points;
  }
  if (Object.keys(out).length === 0) {
    return { data: null, error: 'keyframes must define at least one bone channel' };
  }
  return { data: out, error: null };
}

/** 解析角色根位移关键帧：[{t,x,y,z}, ...]，坐标为模型根帧中的 bind-relative 米制偏移。 */
function parseRootMotionJson(raw: unknown): { data: RootKeyframe[] | null; error: string | null } {
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    return { data: null, error: null };
  }
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch (e) {
      return { data: null, error: `root_motion is not valid JSON: ${(e as Error).message}` };
    }
  }
  if (!Array.isArray(value) || value.length === 0) {
    return { data: null, error: 'root_motion must be a non-empty array of {t,x,y,z} points' };
  }
  const points: RootKeyframe[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { data: null, error: 'root_motion contains a point that is not an object {t,x,y,z}' };
    }
    const record = item as Record<string, unknown>;
    const point = {
      t: readFiniteNumber(record.t),
      x: readFiniteNumber(record.x),
      y: readFiniteNumber(record.y),
      z: readFiniteNumber(record.z),
    };
    if (
      point.t === undefined
      || point.x === undefined
      || point.y === undefined
      || point.z === undefined
      || point.t < 0
    ) {
      return { data: null, error: 'root_motion contains a non-finite component or negative t' };
    }
    points.push({ t: point.t, x: point.x, y: point.y, z: point.z });
  }
  points.sort((a, b) => a.t - b.t);
  for (let i = 1; i < points.length; i++) {
    if (points[i].t === points[i - 1].t) {
      return { data: null, error: `root_motion has duplicate keyframes at t=${points[i].t}` };
    }
  }
  return { data: points, error: null };
}

/** 在 t 处采样一条关键帧序列：越界夹到首/末值；区间内线性插值或阶梯保持前一个值。 */
function sampleAt(points: Keyframe[], t: number, step: boolean): number {
  if (points.length === 1) return points[0].q;
  if (t <= points[0].t) return points[0].q;
  const last = points[points.length - 1];
  if (t >= last.t) return last.q;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (t >= a.t && t <= b.t) {
      if (step) return a.q;
      const span = b.t - a.t;
      const ratio = span > 0 ? (t - a.t) / span : 0;
      return a.q + (b.q - a.q) * ratio;
    }
  }
  return last.q;
}

function sampleRootAt(points: RootKeyframe[], t: number, step: boolean): [number, number, number] {
  if (points.length === 1 || t <= points[0].t) {
    return [points[0].x, points[0].y, points[0].z];
  }
  const last = points[points.length - 1];
  if (t >= last.t) return [last.x, last.y, last.z];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (t >= a.t && t <= b.t) {
      const ratio = step ? 0 : (t - a.t) / (b.t - a.t);
      return [
        a.x + (b.x - a.x) * ratio,
        a.y + (b.y - a.y) * ratio,
        a.z + (b.z - a.z) * ratio,
      ];
    }
  }
  return [last.x, last.y, last.z];
}

function sampleRootMotion(
  points: RootKeyframe[],
  frameCount: number,
  fps: number,
  step: boolean,
): [number, number, number][] {
  return Array.from({ length: frameCount }, (_, i) => sampleRootAt(points, i / fps, step));
}

function isStepInterpolation(value: unknown): boolean {
  return String(value ?? 'linear').trim().toLowerCase() === 'step';
}

/** 把稀疏 keyframes 按 fps/duration 采样展开成完整 JointAnimationClip。 */
function sampleKeyframesToClip(
  raw: unknown,
  rootMotion: RootKeyframe[] | null,
  input: Record<string, unknown>,
): { clip: JointAnimationClip | null; error: string | null } {
  const parsed = raw === null
    ? { data: {} as Record<string, Keyframe[]>, error: null }
    : parseKeyframesJson(raw);
  if (!parsed.data) return { clip: null, error: parsed.error };

  const fps = readFiniteNumber(input.fps) ?? 30;
  if (!(fps > 0)) return { clip: null, error: `fps must be > 0, got ${fps}` };

  const endTimes = Object.values(parsed.data).map((points) => points[points.length - 1].t);
  if (rootMotion) endTimes.push(rootMotion[rootMotion.length - 1].t);
  const maxT = endTimes.length > 0 ? Math.max(...endTimes) : 0;
  let duration = readFiniteNumber(input.duration);
  if (duration === undefined || duration <= 0) duration = maxT;
  if (!(duration > 0)) {
    return { clip: null, error: 'duration must be > 0 (pass `duration`, or give keyframes with t > 0)' };
  }

  const frameCount = Math.max(2, Math.round(duration * fps) + 1);
  if (duration + 1e-9 < maxT) {
    return { clip: null, error: `duration ${duration}s ends before the last keyframe at ${maxT}s` };
  }
  const step = isStepInterpolation(input.interpolation);

  const channels: Record<string, number[]> = {};
  for (const [bone, points] of Object.entries(parsed.data)) {
    const series = new Array<number>(frameCount);
    for (let i = 0; i < frameCount; i++) series[i] = sampleAt(points, i / fps, step);
    channels[bone] = series;
  }

  return {
    clip: {
      name: '',
      fps,
      frameCount,
      channels,
      ...(rootMotion ? { rootTranslation: sampleRootMotion(rootMotion, frameCount, fps, step) } : {}),
    },
    error: null,
  };
}

/**
 * 读取 q_path 指向的 JSON 文件。绝对路径直接读；相对路径依次尝试
 * FORGEAX_PROJECT_ROOT / process.cwd() 作为基准（best-effort）。
 */
function readProjectFile(pathValue: string): { text: string | null; error: string | null } {
  const candidates: string[] = [];
  if (isAbsolute(pathValue)) {
    candidates.push(pathValue);
  } else {
    const root = process.env.FORGEAX_PROJECT_ROOT;
    if (root) candidates.push(resolve(root, pathValue));
    candidates.push(resolve(process.cwd(), pathValue));
  }
  let lastErr = '';
  for (const abs of candidates) {
    try {
      return { text: readFileSync(abs, 'utf8'), error: null };
    } catch (e) {
      lastErr = (e as Error).message;
    }
  }
  return { text: null, error: `failed to read q_path "${pathValue}": ${lastErr}` };
}

function readFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export default gBakeSkinAnimation;
