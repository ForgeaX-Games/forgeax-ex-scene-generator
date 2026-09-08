/**
 * mesh-qc —— mesh-aware 干涉检测 + 可执行修正建议（Workstream D · #2 #3）。
 *
 * g_geometry_qc 只用参数化 AABB：对 `mesh(filename=...)` 形状（阶段2 组装的主力）
 * 拿不到真实包围盒，穿模检测形同虚设。本模块补上这块：
 *   1. 从项目烘焙清单 parts.json 取每个已烘 mesh 的真实局部 AABB，注入到缺 bbox 的
 *      mesh 语句里，从而对"全 mesh 组装"也能算实体级世界 AABB 重叠。
 *   2. 命中重叠 / joint 错位时，给出**具体平移量**的可执行修正建议（移动量 = 最小穿透
 *      轴上的分离距离），让 agent 直接改那条 part/joint 的偏移，而不是来回试。
 *
 * 复用 vendor 里 QC/metrics 共享的 FK + AABB 数学，保证与 g_geometry_qc 口径一致。
 */

import {
  geometryFromSource,
  computeWorldTransforms,
  localAabbFromPart,
  aabbOverlapDepth,
  aabbAabbDistance,
  pointAabbDistance,
  transformAabbByOriginRpy,
  transformAabbByMatOrigin,
  addVec,
  mat3Vec3,
  readVec3,
  buildJointMotionEdges,
  partsMoveRelativeToEachOther,
  IDENTITY_XFORM,
  type Geometry,
  type LocalAABB,
  type Statement,
  type Arg,
} from '../../../vendor/dist/shared/types/index.js'

export interface MeshQcSuggestion {
  /** 修正动作：平移某个 part / 改某个 joint 的 origin。 */
  op: 'translate_part' | 'set_joint_origin_delta'
  target: string
  /** 建议的平移 / origin 增量 [dx,dy,dz]（米）。 */
  delta: [number, number, number]
}

export interface MeshQcSignal {
  code: string
  severity: 'error' | 'warning' | 'note'
  message: string
  ids?: string[]
  suggestion?: MeshQcSuggestion
}

export interface MeshQcResult {
  /** mesh-aware 检测是否发现硬穿模。 */
  clean: boolean
  signals: MeshQcSignal[]
  /** 用到了真实 bbox 的 part 数（可观测：值 > 0 才说明 mesh-aware 生效）。 */
  meshResolved: number
  /** 实际评估的 mesh-backed part pair 数。 */
  pairCount: number
  /** 超过 maxSignals 后未内联的信号数。 */
  omittedCount: number
}

/** parts.json 里一条已烘 mesh 的最小信息（按 filename 匹配 mesh 语句）。 */
export interface BakedPart {
  filename: string
  bbox_min: number[]
  bbox_max: number[]
}

interface PartAabbWorld {
  aabb: LocalAABB
  meshBacked: boolean
}

const round = (n: number): number => Math.round(n * 1e5) / 1e5

/**
 * 对一段 DSL 跑 mesh-aware 干涉检测。
 * @param source     DSL 源
 * @param bakedByFile 已烘 mesh：filename(`<sha>.obj`) → bbox
 * @param opts.overlapTol 认定穿模的最小三轴重叠深度（默认 1mm）
 */
export function meshAwareQc(
  source: string,
  bakedByFile: ReadonlyMap<string, BakedPart>,
  opts: { overlapTol?: number; jointTol?: number; maxSignals?: number } = {},
): MeshQcResult {
  const overlapTol = opts.overlapTol ?? 0.001
  const jointTol = opts.jointTol ?? 0.05
  const maxSignals = Math.max(1, Math.floor(opts.maxSignals ?? 100))
  const geom: Geometry = geometryFromSource(source)

  // 注入 baked bbox：给缺 bbox_min/max 的 mesh 语句补上真实包围盒。
  const byId = new Map<string, Statement>()
  for (const s of geom.statements) byId.set(s.id, augmentMesh(s, bakedByFile))

  const parts = geom.statements.filter((s) => s.op === 'part')
  const joints = geom.statements.filter((s) => s.op === 'joint')
  const world = computeWorldTransforms(parts.map((p) => byId.get(p.id)!), joints.map((j) => byId.get(j.id)!))

  const partAabbs = new Map<string, PartAabbWorld>()
  let meshResolved = 0
  for (const partStmt of parts) {
    const part = byId.get(partStmt.id)!
    const local = localAabbFromPart(part, byId)
    if (!local) continue
    const shapeRef = part.args.shape
    const shape = shapeRef?.kind === 'ref' ? byId.get(shapeRef.name) : undefined
    const meshBacked = shape?.op === 'mesh'
    if (meshBacked) meshResolved++
    const origin = readVec3(part.args.origin) ?? [0, 0, 0]
    const rpy = readVec3(part.args.rpy) ?? [0, 0, 0]
    const linkLocal = transformAabbByOriginRpy(local, origin, rpy)
    const w = world.get(part.id) ?? IDENTITY_XFORM
    partAabbs.set(part.id, { aabb: transformAabbByMatOrigin(linkLocal, w.rot, w.origin), meshBacked })
  }

  const signals: MeshQcSignal[] = []
  let pairCount = 0
  // moving-joint trap 修正：重叠严重度按**这一对 part 是否真的会相对运动**判定。
  // 重叠一律不 fail clean —— 低模少量交叠是常态；孤立 part 才是关节要修的硬伤。
  const motionEdges = buildJointMotionEdges(joints)

  // ── 实体级两两穿模 ──────────────────────────────────────────────────────
  const ids = [...partAabbs.keys()].sort()
  for (let i = 0; i < ids.length; i++) {
    for (let k = i + 1; k < ids.length; k++) {
      const a = partAabbs.get(ids[i])!
      const b = partAabbs.get(ids[k])!
      // 只在至少一方是真实 mesh 时才算 "mesh-aware"（纯参数化重叠 g_geometry_qc 已覆盖）
      if (!a.meshBacked && !b.meshBacked) continue
      pairCount++
      const depth = aabbOverlapDepth(a.aabb, b.aabb)
      if (depth[0] > overlapTol && depth[1] > overlapTol && depth[2] > overlapTol) {
        const movesRelative = partsMoveRelativeToEachOther(ids[i], ids[k], motionEdges)
        const axis = depth[0] <= depth[1] && depth[0] <= depth[2] ? 0 : depth[1] <= depth[2] ? 1 : 2
        const sign = b.aabb.center[axis] >= a.aabb.center[axis] ? 1 : -1
        const delta: [number, number, number] = [0, 0, 0]
        delta[axis] = round(sign * (depth[axis] + overlapTol))
        signals.push({
          code: 'mesh_overlap',
          severity: movesRelative ? 'warning' : 'note',
          ids: [ids[i], ids[k]],
          message:
            `mesh-aware: parts "${ids[i]}" and "${ids[k]}" interpenetrate ` +
            `(min depth=${round(Math.min(...depth))}m on axis ${'XYZ'[axis]}). ` +
            (movesRelative
              ? `they move relative to each other via a non-fixed joint — review if intentional; do NOT detach parts to silence. `
              : `rigidly linked (fixed joints only) — likely a benign low-poly overlap; check before forcing apart. `) +
            (movesRelative
              ? `optional separation: translate "${ids[k]}" by [${delta.join(', ')}].`
              : `note: AABB-only check, conservative for rotated meshes.`),
          ...(movesRelative
            ? { suggestion: { op: 'translate_part' as const, target: ids[k], delta } }
            : {}),
        })
      }
    }
  }

  // ── joint origin 错位（child 被甩离 parent）+ 修正建议 ──────────────────
  for (const jStmt of joints) {
    const j = byId.get(jStmt.id)!
    const p = j.args.parent
    const c = j.args.child
    if (p?.kind !== 'ref' || c?.kind !== 'ref') continue
    const parentBox = partAabbs.get(p.name)
    const childBox = partAabbs.get(c.name)
    if (!parentBox || !childBox) continue
    if (!parentBox.meshBacked && !childBox.meshBacked) continue
    const gap = aabbAabbDistance(childBox.aabb, parentBox.aabb)
    if (gap > jointTol * 4) {
      // 建议：把 child 世界中心朝 parent 世界中心方向拉近 gap。
      const delta: [number, number, number] = [
        round(parentBox.aabb.center[0] - childBox.aabb.center[0]),
        round(parentBox.aabb.center[1] - childBox.aabb.center[1]),
        round(parentBox.aabb.center[2] - childBox.aabb.center[2]),
      ]
      // 这条 joint 自己是不是可动关节才决定"child 被甩离 parent"有多严重——
      // 跟模型别处有没有别的可动关节无关（同一处 bug，用这条 joint 自己的 type 判定）。
      const jointType = j.args.type?.kind === 'string' ? j.args.type.value : 'fixed'
      const isMovingJoint = jointType !== 'fixed'
      signals.push({
        code: 'joint_child_detached',
        severity: isMovingJoint ? 'error' : 'note',
        ids: [jStmt.id, p.name, c.name],
        message:
          `mesh-aware: joint "${jStmt.id}" leaves child "${c.name}" ${round(gap)}m off parent "${p.name}". ` +
          `nudge joint origin by ~[${delta.join(', ')}] (or use g_place_on_surface) to seat them.`,
        suggestion: { op: 'set_joint_origin_delta', target: jStmt.id, delta },
      })
    }
  }

  const clean = !signals.some((s) => s.severity === 'error')
  const omittedCount = Math.max(0, signals.length - maxSignals)
  return { clean, signals: signals.slice(0, maxSignals), meshResolved, pairCount, omittedCount }
}

/** 若 mesh 语句缺 bbox_min/max，用 baked bbox 补一份（返回新的 Statement）。 */
function augmentMesh(s: Statement, bakedByFile: ReadonlyMap<string, BakedPart>): Statement {
  if (s.op !== 'mesh') return s
  if (s.args.bbox_min && s.args.bbox_max) return s
  const filename = s.args.filename?.kind === 'string' ? s.args.filename.value : ''
  const baked = filename ? bakedByFile.get(filename) : undefined
  if (!baked || baked.bbox_min.length !== 3 || baked.bbox_max.length !== 3) return s
  const toList = (v: number[]): Arg => ({ kind: 'list', items: v.map((n) => ({ kind: 'number', value: n } as Arg)) })
  return Object.freeze({
    ...s,
    args: Object.freeze({ ...s.args, bbox_min: toList(baked.bbox_min), bbox_max: toList(baked.bbox_max) }),
  }) as Statement
}

/** joint origin 世界化的辅助（导出以便单测）。 */
export function jointOriginWorldDistance(
  jointOriginLocal: [number, number, number],
  parentWorldRot: readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]],
  parentWorldOrigin: [number, number, number],
  parentAabb: LocalAABB,
): number {
  const worldOrigin = addVec(parentWorldOrigin, mat3Vec3(parentWorldRot, jointOriginLocal))
  return pointAabbDistance(worldOrigin, parentAabb)
}
