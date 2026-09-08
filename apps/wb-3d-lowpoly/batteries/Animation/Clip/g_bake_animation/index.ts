/**
 * g_bake_animation —— 校验作者关节轨迹 q(t) 并追加 `animation` 语句。
 *
 * q(t) 表示：以 URDF 关节名（== DSL joint 语句的 id）为键的每关节标量轨迹
 * （弧度 revolute/continuous | 米 prismatic）。轴 / 类型 / 限位由 URDF 提供，
 * 所以 clip 不携带任何几何。
 *
 * 职责：解析 q(t)（motion 端口 > q_json 完整逐帧 JSON > keyframes 稀疏关键帧 > q_path 文件）
 *   → 对照 geometry 关节校验 →
 *   - 校验通过：`emit('animation', {...})` 追加语句，几何前进；
 *   - 校验失败：几何原样透传，`error` 返回错误（沿用 g_joint_revolute 约定）。
 * 真正的 `.glb` 由前端导出链路烘焙；本电池只负责创作 + 校验 + emit q(t)。
 *
 * `keyframes` 存在的原因：q_json/q_path 都要求逐帧数组（长度 = frameCount），手打或让
 * LLM 逐帧编数字既不可靠又容易撞 pipeline.applyBatch 的内联数组体量护栏。`keyframes`
 * 只需给每个关节几个"关键时刻的值"（{t,q} 点），本电池按 fps/duration 均匀采样、关键帧
 * 间线性插值（或阶梯保持）展开成逐帧数组——这是 agent 在对话里描述动作时的首选入口，
 * 单条 DSL 语句即可（`model.apply` 一次成图，不需要额外连线）。
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
  validateClipAgainstJoints,
  type Arg,
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

export function gBakeAnimation(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const fail = (error: string, animation: unknown = null, report: unknown = null): Record<string, unknown> =>
    ({ geometry: incoming, animation, report, error });

  // 1) 解析 q(t)（优先级：motion 端口 > q_json 完整 JSON > keyframes 稀疏关键帧 > q_path 文件）
  const source = resolveQtSource(input);
  if (source.kind === 'none') {
    return fail(source.error ?? 'no q(t) provided (wire `motion`, or set q_json / keyframes / q_path)');
  }

  let clip: JointAnimationClip;
  if (source.kind === 'keyframes') {
    const sampled = sampleKeyframesToClip(source.value, input);
    if (!sampled.clip) return fail(sampled.error ?? 'failed to sample keyframes');
    clip = sampled.clip;
  } else {
    const parsed = parseJointAnimationClip(source.value);
    if (!parsed.clip) return fail(parsed.error ?? 'failed to parse q(t)');
    clip = parsed.clip;
  }

  // 2) 参数覆盖：name / fps / loop（显式给了就盖掉 q(t) 里的值）
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

  // 3) 对照 geometry 关节校验 + 夹取到限位
  const { clip: validated, errors, report } = validateClipAgainstJoints(clip, incoming.statements);

  if (errors.length > 0) {
    // 非致命：几何原样透传，仍把已解析 clip + report 交给下游便于诊断。
    return fail(errors.join('\n'), validated, report);
  }

  // 4) emit `animation` 语句；q(t) 整体存为 `q_json`（自包含，round-trip 可直接喂回 model.apply）
  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'anim');
  if (!isValidId(id)) return fail(`invalid id "${id}"`, validated, report);

  const args: Record<string, Arg> = {
    name: str(validated.name),
    fps: num(validated.fps),
    q_json: str(JSON.stringify(validated)),
  };
  if (validated.loop) args.loop = bool(true);

  const next = emit(incoming, id, 'animation', args);
  return { geometry: next, animation: validated, report, error: '' };
}

/**
 * 按优先级解析 q(t) 原始值：motion 端口 > q_json 完整 JSON > keyframes 稀疏关键帧 > q_path 文件。
 */
function resolveQtSource(input: Record<string, unknown>): QtSource {
  // motion 端口：对象或 JSON 字符串都交给 parseJointAnimationClip 处理
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

/**
 * 解析 `keyframes` 输入（JSON 字符串或对象）：形态 { 关节名: [{t,q}, ...] }。
 * 每个关节的点按 t 自动排序，调用方不需要预先排好。
 */
function parseKeyframesJson(raw: unknown): { data: Record<string, Keyframe[]> | null; error: string | null } {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '') {
      return { data: null, error: 'keyframes is empty: expected JSON { jointName: [{"t":sec,"q":value}, ...], ... }' };
    }
    try {
      obj = JSON.parse(trimmed);
    } catch (e) {
      return { data: null, error: `keyframes is not valid JSON: ${(e as Error).message}` };
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { data: null, error: 'keyframes must be an object: { jointName: [{"t":sec,"q":value}, ...] }' };
  }

  const out: Record<string, Keyframe[]> = {};
  for (const [joint, list] of Object.entries(obj as Record<string, unknown>)) {
    if (!Array.isArray(list) || list.length === 0) {
      return { data: null, error: `keyframes channel "${joint}" must be a non-empty array of {t,q} points` };
    }
    const points: Keyframe[] = [];
    for (const item of list) {
      if (!item || typeof item !== 'object') {
        return { data: null, error: `keyframes channel "${joint}" has a point that is not an object {t,q}` };
      }
      const t = Number((item as Record<string, unknown>).t);
      const q = Number((item as Record<string, unknown>).q);
      if (!Number.isFinite(t) || !Number.isFinite(q)) {
        return { data: null, error: `keyframes channel "${joint}" has a point with non-finite t/q` };
      }
      points.push({ t, q });
    }
    points.sort((a, b) => a.t - b.t);
    out[joint] = points;
  }
  if (Object.keys(out).length === 0) {
    return { data: null, error: 'keyframes must define at least one joint channel' };
  }
  return { data: out, error: null };
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

/** 把稀疏 keyframes 按 fps/duration 采样展开成完整 JointAnimationClip（未做限位校验）。 */
function sampleKeyframesToClip(
  raw: unknown,
  input: Record<string, unknown>,
): { clip: JointAnimationClip | null; error: string | null } {
  const parsed = parseKeyframesJson(raw);
  if (!parsed.data) return { clip: null, error: parsed.error };

  const fps = readFiniteNumber(input.fps) ?? 30;
  if (!(fps > 0)) return { clip: null, error: `fps must be > 0, got ${fps}` };

  const maxT = Math.max(...Object.values(parsed.data).map((points) => points[points.length - 1].t));
  let duration = readFiniteNumber(input.duration);
  if (duration === undefined || duration <= 0) duration = maxT;
  if (!(duration > 0)) {
    return { clip: null, error: 'duration must be > 0 (pass `duration`, or give keyframes with t > 0)' };
  }

  const frameCount = Math.max(2, Math.round(duration * fps) + 1);
  const step = String(input.interpolation ?? 'linear').trim().toLowerCase() === 'step';

  const channels: Record<string, number[]> = {};
  for (const [joint, points] of Object.entries(parsed.data)) {
    const series = new Array<number>(frameCount);
    for (let i = 0; i < frameCount; i++) series[i] = sampleAt(points, i / fps, step);
    channels[joint] = series;
  }

  return { clip: { name: '', fps, frameCount, channels }, error: null };
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

export default gBakeAnimation;
