/**
 * 关节动画 clip —— 作者轨迹 q(t) 的单一真源（电池校验 + 前端烘焙共用）。
 *
 * 设计要点：
 *   - q(t) 用「每关节标量轨迹」表示，键 = URDF 关节名（== DSL joint 语句的 id）。
 *     轴 / 类型 / 限位由 URDF 提供，所以 clip 不携带任何几何。
 *   - 时间轴均匀采样：t[i] = i / fps；数组长度 === frameCount。
 *   - 单位：revolute/continuous 为弧度，prismatic 为米。
 *   - mimic 关节不存储——由 URDF mimic 关系在烘焙 / 求值时推导。
 */

import type { Arg, Statement } from './types.js';

/** 一条以 URDF 关节名为键的每关节标量轨迹。 */
export interface JointAnimationClip {
  /** clip 名（可空）。 */
  name: string;
  /** 采样帧率（帧/秒）；> 0。 */
  fps: number;
  /** 帧数 F；>= 2。 */
  frameCount: number;
  /** 是否循环播放。 */
  loop?: boolean;
  /**
   * 每关节轨迹：键 = URDF 关节名；值 = 长度 === frameCount 的标量数组
   * （弧度 revolute/continuous | 米 prismatic）。
   */
  channels: Record<string, number[]>;
  /**
   * 可选模型根位移，模型根帧（Z-up、+X 向前）中的米制偏移。
   * 每项相对 skeleton root 的 bind position，长度必须 === frameCount。
   */
  rootTranslation?: [number, number, number][];
}

/** 解析结果：成功给 clip，失败给 error 字符串。 */
export interface ParseClipResult {
  clip: JointAnimationClip | null;
  error: string | null;
}

/** 校验结果：clip 为夹取后的副本；errors 为致命错误；report 为结构化交付物。 */
export interface ClipValidationResult {
  /** 夹取到限位后的 clip（校验通过时可直接烘焙）。 */
  clip: JointAnimationClip;
  /** 致命错误（未知 / 不可动 / mimic 驱动关节、长度不符、fps/frameCount 非法等）。 */
  errors: string[];
  /** 结构化报告。 */
  report: ClipValidationReport;
}

export interface ClipValidationReport {
  fps: number;
  frameCount: number;
  /** 时长（秒）= (frameCount - 1) / fps。 */
  durationSec: number;
  /** 定义了轨迹的关节数（channels 键数）。 */
  channelCount: number;
  /** 几何中可动（revolute/continuous/prismatic 且无 mimic）的关节数。 */
  movableJointCount: number;
  /** 可动但未提供轨迹、烘焙时停在静止位（0）的关节数。 */
  restingJointCount: number;
  /** 被限位夹取过的 channel 明细。 */
  clamped: Array<{ joint: string; frames: number }>;
  /** 非致命提示（如被夹取）。 */
  warnings: string[];
  /** 致命错误（与 ClipValidationResult.errors 同）。 */
  errors: string[];
}

const MOVABLE_JOINT_TYPES = new Set(['revolute', 'continuous', 'prismatic']);

// ── 解析 ─────────────────────────────────────────────────────────────────

/**
 * 把内联 JSON 字符串 / 端口对象解析成 JointAnimationClip。
 *
 * 接受形态：
 *   - JSON 字符串（q_json 参数 / q_path 读出的文件内容）
 *   - 结构化对象（motion 端口 / 已解析的 clip）
 *
 * 不做「关节对齐」校验（那属于 validateClipAgainstJoints）；仅做形态归一化。
 */
export function parseJointAnimationClip(value: unknown): ParseClipResult {
  let raw: unknown = value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return { clip: null, error: 'empty q(t) JSON' };
    try {
      raw = JSON.parse(trimmed);
    } catch (e) {
      return { clip: null, error: `q(t) is not valid JSON: ${(e as Error).message}` };
    }
  }
  if (!raw || typeof raw !== 'object') {
    return { clip: null, error: 'q(t) must be an object with a "channels" map' };
  }
  const obj = raw as Record<string, unknown>;

  const rawChannels = obj.channels;
  if (!rawChannels || typeof rawChannels !== 'object' || Array.isArray(rawChannels)) {
    return { clip: null, error: 'q(t) is missing a "channels" object ({ jointName: number[] })' };
  }

  const channels: Record<string, number[]> = {};
  for (const [joint, series] of Object.entries(rawChannels as Record<string, unknown>)) {
    if (!Array.isArray(series)) {
      return { clip: null, error: `channel "${joint}" must be an array of numbers` };
    }
    const nums: number[] = [];
    for (const v of series) {
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) {
        return { clip: null, error: `channel "${joint}" contains a non-finite value` };
      }
      nums.push(n);
    }
    channels[joint] = nums;
  }

  let rootTranslation: [number, number, number][] | undefined;
  if (obj.rootTranslation !== undefined) {
    if (!Array.isArray(obj.rootTranslation)) {
      return { clip: null, error: 'rootTranslation must be an array of [x,y,z] vectors' };
    }
    rootTranslation = [];
    for (let i = 0; i < obj.rootTranslation.length; i++) {
      const value = obj.rootTranslation[i];
      if (!Array.isArray(value) || value.length !== 3) {
        return { clip: null, error: `rootTranslation[${i}] must be a [x,y,z] vector` };
      }
      const vector = value.map(readFiniteNumber);
      if (vector.some((component) => component === undefined)) {
        return { clip: null, error: `rootTranslation[${i}] contains a non-finite value` };
      }
      rootTranslation.push([vector[0] as number, vector[1] as number, vector[2] as number]);
    }
  }

  const name = typeof obj.name === 'string' ? obj.name : '';
  const fps = readFiniteNumber(obj.fps) ?? 30;
  const loop = typeof obj.loop === 'boolean' ? obj.loop : undefined;

  // frameCount 优先取显式字段（frameCount / frames），否则由首个 channel / 根位移推断。
  const explicitFrames = readFiniteNumber(obj.frameCount) ?? readFiniteNumber(obj.frames);
  const channelLengths = Object.values(channels).map((c) => c.length);
  const inferredFrames = channelLengths.length > 0 ? channelLengths[0] : (rootTranslation?.length ?? 0);
  const frameCount = explicitFrames !== undefined ? Math.trunc(explicitFrames) : inferredFrames;

  return {
    clip: {
      name,
      fps,
      frameCount,
      ...(loop !== undefined ? { loop } : {}),
      channels,
      ...(rootTranslation !== undefined ? { rootTranslation } : {}),
    },
    error: null,
  };
}

// ── 校验（对照 geometry 关节） ────────────────────────────────────────────

/**
 * 对照 geometry 里的 joint 语句校验 clip，并把值夹取到限位。
 *
 * 规则：
 *   - 每个 channel 键必须是「可动」关节 id（revolute/continuous/prismatic 且无 mimic_joint），
 *     否则致命错误（未知 / 不可动 / 被 mimic 驱动）；
 *   - 每条 channel 长度必须 === frameCount，否则致命错误；
 *   - fps > 0，frameCount >= 2，否则致命错误；
 *   - revolute/prismatic 的值夹到 [lower, upper]（都有限时），被夹发 warning；continuous 不受限；
 *   - 未提供 channel 的可动关节烘焙时停在静止位（0）。
 */
export function validateClipAgainstJoints(
  clip: JointAnimationClip,
  statements: readonly Statement[],
): ClipValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const clamped: Array<{ joint: string; frames: number }> = [];

  const joints = statements.filter((s) => s.op === 'joint');
  const jointById = new Map<string, Statement>(joints.map((s) => [s.id, s]));

  const isMovable = (s: Statement): boolean => {
    const type = readString(s.args.type) ?? 'fixed';
    if (!MOVABLE_JOINT_TYPES.has(type)) return false;
    return s.args.mimic_joint?.kind !== 'ref';
  };
  const movableJointCount = joints.filter(isMovable).length;

  const fps = clip.fps;
  const frameCount = clip.frameCount;
  if (!Number.isFinite(fps) || fps <= 0) errors.push(`fps must be > 0, got ${fps}`);
  if (!Number.isFinite(frameCount) || frameCount < 2) {
    errors.push(`frameCount must be >= 2, got ${frameCount}`);
  }

  const outChannels: Record<string, number[]> = {};
  const channeledJoints = new Set<string>();

  for (const [jointName, series] of Object.entries(clip.channels)) {
    const joint = jointById.get(jointName);
    if (!joint) {
      errors.push(`channel "${jointName}" is not a joint in the geometry`);
      outChannels[jointName] = series.slice();
      continue;
    }
    const type = readString(joint.args.type) ?? 'fixed';
    if (!MOVABLE_JOINT_TYPES.has(type)) {
      errors.push(`channel "${jointName}" targets a non-movable joint (type "${type}")`);
      outChannels[jointName] = series.slice();
      continue;
    }
    if (joint.args.mimic_joint?.kind === 'ref') {
      errors.push(`channel "${jointName}" targets a mimic-driven joint; drive its source instead`);
      outChannels[jointName] = series.slice();
      continue;
    }
    channeledJoints.add(jointName);

    if (Number.isFinite(frameCount) && series.length !== frameCount) {
      errors.push(
        `channel "${jointName}" has ${series.length} frames, expected ${frameCount}`,
      );
    }

    // 夹取到限位（revolute/prismatic 有限区间时）；continuous 不受限。
    const lower = readNumber(joint.args.lower);
    const upper = readNumber(joint.args.upper);
    const clampable =
      type !== 'continuous' &&
      lower !== undefined && upper !== undefined &&
      Number.isFinite(lower) && Number.isFinite(upper) && lower <= upper;

    if (clampable) {
      let clampedFrames = 0;
      const next = series.map((v) => {
        const c = Math.min(upper as number, Math.max(lower as number, v));
        if (c !== v) clampedFrames++;
        return c;
      });
      outChannels[jointName] = next;
      if (clampedFrames > 0) {
        warnings.push(
          `channel "${jointName}" clamped ${clampedFrames} frame(s) to [${lower}, ${upper}]`,
        );
        clamped.push({ joint: jointName, frames: clampedFrames });
      }
    } else {
      outChannels[jointName] = series.slice();
    }
  }

  const restingJointCount = joints.filter(
    (s) => isMovable(s) && !channeledJoints.has(s.id),
  ).length;

  let rootTranslation: [number, number, number][] | undefined;
  if (clip.rootTranslation !== undefined) {
    if (clip.rootTranslation.length !== frameCount) {
      errors.push(
        `rootTranslation has ${clip.rootTranslation.length} frames, expected ${frameCount}`,
      );
    }
    rootTranslation = clip.rootTranslation.map((v) => [v[0], v[1], v[2]]);
  }

  const outClip: JointAnimationClip = {
    name: clip.name,
    fps,
    frameCount,
    ...(clip.loop !== undefined ? { loop: clip.loop } : {}),
    channels: outChannels,
    ...(rootTranslation !== undefined ? { rootTranslation } : {}),
  };

  const durationSec = Number.isFinite(fps) && fps > 0 && Number.isFinite(frameCount)
    ? (frameCount - 1) / fps
    : 0;

  const report: ClipValidationReport = {
    fps,
    frameCount,
    durationSec,
    channelCount: Object.keys(clip.channels).length,
    movableJointCount,
    restingJointCount,
    clamped,
    warnings,
    errors,
  };

  return { clip: outClip, errors, report };
}

// ── 采样 ─────────────────────────────────────────────────────────────────

/**
 * 取第 frameIndex 帧的每关节标量值（仅含 clip 显式声明的 channel；mimic / 静止关节
 * 由消费方按 URDF 关系补齐）。越界 index 夹到有效范围。
 */
export function clipJointValuesAtFrame(
  clip: JointAnimationClip,
  frameIndex: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [joint, series] of Object.entries(clip.channels)) {
    if (series.length === 0) continue;
    const i = Math.max(0, Math.min(series.length - 1, Math.trunc(frameIndex)));
    out[joint] = series[i];
  }
  return out;
}

// ── Arg / 值读取工具 ──────────────────────────────────────────────────────

function readNumber(a: Arg | undefined): number | undefined {
  if (!a || a.kind !== 'number') return undefined;
  return a.value;
}
function readString(a: Arg | undefined): string | undefined {
  if (!a || a.kind !== 'string') return undefined;
  return a.value;
}
function readFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}
