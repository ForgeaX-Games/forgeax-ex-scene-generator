/**
 * dsl-to-graph 编译器单测（Workstream A · verify）。
 *
 * 覆盖：
 *   1. compile：每语句一节点 + 线性 geometry 边 + ref id 边 + 终端 QC/URDF 节点
 *   2. op→电池映射：joint(type=X)→g_joint_X、fillet/chamfer→g_fillet
 *   3. 未知 op：显式报错并带行号，不建图
 *   4. round-trip：DSL → 图 → DSL 等价（含 chamfer 的 type 不丢）
 */

import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveBatteryScanRoots } from '@forgeax/editor-host/backend'
import { describe, it, expect } from 'vitest'
import { parseDSL, listOpSpecs, type Statement, type Arg } from '../../vendor/dist/shared/types/index.js'
import { compileDslToGraph, graphToDsl } from '../src/services/dsl-to-graph.js'
import { scanBatteryCategories } from '../src/routes/batteryCategories.js'

// backend/tests → backend → app root
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const CABINET = [
  'mat = material(rgba=[0.6, 0.4, 0.2, 1])',
  'body = box(size=[0.6, 0.4, 0.8])',
  'cavity = box(size=[0.55, 0.38, 0.7])',
  'shell = difference(base=body, tool=cavity)',
  'r_shell = fillet(shape=shell, radius=0.01, edges="vertical")',
  'p_body = part(shape=r_shell, material=mat)',
  'door = box(size=[0.6, 0.02, 0.75])',
  'p_door = part(shape=door, material=mat, origin=[0, 0.21, 0])',
  'hinge = joint(type="revolute", parent=p_body, child=p_door, axis=[0, 0, 1], origin=[0.3, 0.2, 0], lower=0, upper=1.57)',
].join('\n')

/** id → {op, 归一化 args JSON}，忽略 args 顺序，用于结构等价比较。 */
function canon(statements: readonly Statement[]): Record<string, { op: string; args: string }> {
  const out: Record<string, { op: string; args: string }> = {}
  for (const s of statements) out[s.id] = { op: s.op, args: canonArgs(s.args) }
  return out
}
function canonArgs(args: Record<string, Arg>): string {
  const keys = Object.keys(args).sort()
  return JSON.stringify(keys.map((k) => [k, args[k]]))
}

describe('compileDslToGraph: structure', () => {
  it('emits one node per statement plus terminal QC + URDF', () => {
    const r = compileDslToGraph(CABINET)
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
    expect(r.graph).not.toBeNull()
    // 9 语句节点
    expect(r.statementNodeIds).toHaveLength(9)
    // + QC + metrics + URDF
    expect(r.graph!.nodes).toHaveLength(12)
    expect(r.qcNodeId).toBeTruthy()
    expect(r.metricsNodeId).toBeTruthy()
    expect(r.urdfNodeId).toBeTruthy()
    const byId = new Map(r.graph!.nodes.map((n) => [n.id, n]))
    expect(byId.get(r.qcNodeId)!.batteryId).toBe('g_geometry_qc')
    expect(byId.get(r.metricsNodeId)!.batteryId).toBe('g_metrics')
    expect(byId.get(r.urdfNodeId)!.batteryId).toBe('g_to_urdf')
  })

  it('compiles bbox-driven Placement ops through the DSL path', () => {
    const src = [
      'base = box(size=[2,2,1])',
      'p_base = part(shape=base)',
      'lamp = cylinder(radius=0.1, length=0.5)',
      'p_lamp = part(shape=lamp)',
      'placed = place_on_face(parent=p_base, child=p_lamp, face="+z", face_u=0.2, proud=0.01)',
    ].join('\n')
    const r = compileDslToGraph(src)
    expect(r.ok).toBe(true)
    const node = r.graph!.nodes.find((candidate) => candidate.id === 'placed')
    expect(node).toMatchObject({
      batteryId: 'g_place_on_face',
      params: { parent_id: 'p_base', child_id: 'p_lamp', face: '+z', face_u: 0.2, proud: 0.01 },
    })
  })

  it('compiles place_local (offset / rpy split into the joint-shaped scalar ports)', () => {
    const src = [
      'w = wall(length=9, height=3, thickness=0.25)',
      'p_w = part(shape=w, origin=[0, -4.4, 1.5])',
      'win = window(size=[1.2, 1.4], depth=0.25)',
      'p_win = part(shape=win)',
      'mount = place_local(parent=p_w, child=p_win, offset=[-2.5, 0, 0.6], rpy=[0, 0, 1.5708])',
    ].join('\n')
    const r = compileDslToGraph(src)
    expect(r.ok).toBe(true)
    expect(r.graph!.nodes.find((n) => n.id === 'mount')).toMatchObject({
      batteryId: 'g_place_local',
      params: { parent_id: 'p_w', child_id: 'p_win', ox: -2.5, oy: 0, oz: 0.6, rr: 0, rp: 0, ry: 1.5708 },
    })
    // parent/child arrive as ref edges, exactly like the other placement ops
    expect(r.graph!.edges.some((e) => e.source.nodeId === 'p_w' && e.target.nodeId === 'mount' && e.target.port === 'parent_id')).toBe(true)
    expect(r.graph!.edges.some((e) => e.source.nodeId === 'p_win' && e.target.nodeId === 'mount' && e.target.port === 'child_id')).toBe(true)
    // place_local carries no joint semantics, so the model stays on the static path
    expect(r.mode).toBe('static')

    const back = graphToDsl(r.graph!.nodes, r.graph!.edges)
    expect(canon(parseDSL(back).statements)).toEqual(canon(parseDSL(src).statements))
  })

  it('routes a character DSL (explicit bone/skeleton/skin) to the character terminal chain', () => {
    // articulated-pig-like: a few parts + hand-authored skeleton → character path.
    const src = [
      'body = capsule(radius=0.18, length=0.5)',
      'p_body = part(shape=body)',
      'head = sphere(radius=0.16)',
      'p_head = part(shape=head, origin=[0, 0, 0.42])',
      'leg = capsule(radius=0.05, length=0.2)',
      'p_leg = part(shape=leg, origin=[0.1, 0, -0.3])',
      'b_spine = bone(origin=[0,0,0], tail=[0,0,0.4], source_part=p_body)',
      'b_head = bone(origin=[0,0,0.42], tail=[0,0,0.6], parent=b_spine, source_part=p_head)',
      // axis=[0,1,0]：作者显式声明前后摆弯曲轴（编译器拆成 ax/ay/az）
      'b_leg = bone(origin=[0.1,0,-0.15], tail=[0.1,0,-0.4], axis=[0,1,0], parent=b_spine, source_part=p_leg)',
      'sk = skeleton(root=b_spine)',
      'sn = skin(skeleton=sk, method="auto")',
      'wag = animation(fps=30, keyframes="{\\"b_leg\\":[{\\"t\\":0,\\"q\\":0},{\\"t\\":1,\\"q\\":0.5}]}")',
    ].join('\n')
    const r = compileDslToGraph(src)
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
    expect(r.mode).toBe('character')
    // character terminals present, URDF terminals empty
    expect(r.skinQcNodeId).toBeTruthy()
    expect(r.rigNodeId).toBeTruthy()
    expect(r.rigPreviewNodeId).toBeTruthy()
    expect(r.qcNodeId).toBe('')
    expect(r.urdfNodeId).toBe('')
    const byId = new Map(r.graph!.nodes.map((n) => [n.id, n]))
    expect(byId.get(r.skinQcNodeId)!.batteryId).toBe('g_skin_qc')
    expect(byId.get(r.rigNodeId)!.batteryId).toBe('g_to_rig')
    expect(byId.get(r.rigPreviewNodeId)!.batteryId).toBe('rig_preview')
    // g_bake_object sits between skin_qc and g_to_rig, and explicitly asks for
    // mesh-ref parts (doesn't rely on the battery's own default — see CHANGELOG)
    const bakeNode = r.graph!.nodes.find((n) => n.batteryId === 'g_bake_object')
    expect(bakeNode).toBeDefined()
    expect(bakeNode!.params).toMatchObject({ include_mesh_parts: true })
    // animation routed to the skin variant (bone-channel), not g_bake_animation
    expect(r.graph!.nodes.some((n) => n.batteryId === 'g_bake_skin_animation')).toBe(true)
    expect(r.graph!.nodes.some((n) => n.batteryId === 'g_bake_animation')).toBe(false)
    // g_bake_object.filename → g_to_rig.mesh_filename wired
    expect(r.graph!.edges.some((e) => e.source.port === 'filename' && e.target.port === 'mesh_filename' && e.target.nodeId === r.rigNodeId)).toBe(true)
    // g_to_rig.rigSpec → rig_preview.rigSpec wired
    expect(r.graph!.edges.some((e) => e.source.port === 'rigSpec' && e.target.nodeId === r.rigPreviewNodeId)).toBe(true)
    // bone(axis=…) 拆到 g_bone 参数 ax/ay/az
    const legNode = r.graph!.nodes.find((n) => n.batteryId === 'g_bone' && n.params?.ay === 1)
    expect(legNode).toBeTruthy()
    expect(legNode!.params).toMatchObject({ ax: 0, ay: 1, az: 0 })
  })

  it('rejects a mixed model (joint + skin in one file)', () => {
    const src = [
      'a = box(size=[1,1,1])',
      'p_a = part(shape=a)',
      'b = box(size=[1,1,1])',
      'p_b = part(shape=b, origin=[1,0,0])',
      'j = joint(type="fixed", parent=p_a, child=p_b)',
      'bone_a = bone(origin=[0,0,0])',
      'sk = skeleton(root=bone_a)',
      'sn = skin(skeleton=sk)',
    ].join('\n')
    const r = compileDslToGraph(src)
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => /mixed model/i.test(e.message))).toBe(true)
  })

  it('routes bone_chain (tail-only DSL, no plain bone) to the character terminal chain and maps to g_bone_chain', () => {
    const src = [
      'body = capsule(radius=0.1, length=0.3)',
      'p_body = part(shape=body)',
      'tail = capsule(radius=0.03, length=0.5)',
      'p_tail = part(shape=tail, origin=[0, 0, -0.3])',
      'b_spine = bone(origin=[0,0,0], tail=[0,0,0.2], source_part=p_body)',
      'b_tail = bone_chain(origin=[0,0,-0.15], tail=[0,0,-0.65], count=4, axis=[0,1,0], parent=b_spine, source_part=p_tail)',
      'sk = skeleton(root=b_spine)',
      'sn = skin(skeleton=sk, method="auto")',
    ].join('\n')
    const r = compileDslToGraph(src)
    expect(r.ok).toBe(true)
    const chainNode = r.graph!.nodes.find((n) => n.batteryId === 'g_bone_chain')
    expect(chainNode).toBeTruthy()
    expect(chainNode!.params).toMatchObject({
      id: 'b_tail',
      hx: 0, hy: 0, hz: -0.15,
      tx: 0, ty: 0, tz: -0.65,
      count: 4,
      ax: 0, ay: 1, az: 0,
      parent_id: 'b_spine',
      source_part_id: 'p_tail',
    })
    // character path reached purely via bone_chain (no plain `bone` other than the spine).
    expect(r.graph!.nodes.some((n) => n.batteryId === 'g_skeleton')).toBe(true)
    expect(r.graph!.nodes.some((n) => n.batteryId === 'rig_preview')).toBe(true)
  })

  it('round-trips a character DSL back through graphToDsl (animation stays `animation`)', () => {
    const src = [
      'body = capsule(radius=0.18, length=0.5)',
      'p_body = part(shape=body)',
      'leg = capsule(radius=0.05, length=0.2)',
      'p_leg = part(shape=leg, origin=[0.1, 0, -0.3])',
      'b_spine = bone(origin=[0,0,0], tail=[0,0,0.4], source_part=p_body)',
      'b_leg = bone(origin=[0.1,0,-0.15], tail=[0.1,0,-0.4], parent=b_spine, source_part=p_leg)',
      'sk = skeleton(root=b_spine)',
      'sn = skin(skeleton=sk, method="auto")',
    ].join('\n')
    const r = compileDslToGraph(src)
    expect(r.ok).toBe(true)
    const back = graphToDsl(r.graph!.nodes, r.graph!.edges)
    // character terminal batteries are skipped on reverse; statement ops survive
    expect(back).toContain('skeleton(')
    expect(back).toContain('skin(')
    expect(back).not.toContain('g_skin_qc')
    expect(back).not.toContain('rig_preview')
  })

  it('chains geometry edges linearly through statements into QC → URDF', () => {
    const r = compileDslToGraph(CABINET)
    const geomEdges = r.graph!.edges.filter((e) => e.source.port === 'geometry' && e.target.port === 'geometry')
    // 8 语句间 + 末语句→QC + QC→URDF + 末语句→并行 metrics = 11
    expect(geomEdges).toHaveLength(11)
    // 首节点无 incoming geometry
    const firstId = r.statementNodeIds[0]
    expect(geomEdges.some((e) => e.target.nodeId === firstId)).toBe(false)
    // QC→URDF 存在
    expect(geomEdges.some((e) => e.source.nodeId === r.qcNodeId && e.target.nodeId === r.urdfNodeId)).toBe(true)
  })

  it('creates ref id edges from referenced statement id output ports', () => {
    const r = compileDslToGraph(CABINET)
    const refEdges = r.graph!.edges.filter((e) => e.source.port === 'id')
    // difference(base,tool)=2, fillet(shape)=1, part(shape,material)=2, part(shape,material)=2, joint(parent,child)=2 → 9
    expect(refEdges).toHaveLength(9)
    // body → shell 的 base_id 边
    expect(refEdges.some((e) => e.source.nodeId === 'body' && e.target.nodeId === 'shell')).toBe(true)
    // p_body → hinge 的 parent 边
    expect(refEdges.some((e) => e.source.nodeId === 'p_body' && e.target.nodeId === 'hinge')).toBe(true)
  })

  it('carries a ref-LIST via params array and wires NO id→port edges (loft)', () => {
    // Regression: a runtime input port is single-valued (last-write-wins), so
    // N id→profile_ids edges would collapse to one id and shadow the params
    // array — loft then sees 1 profile and fails "must contain at least two".
    // The list must travel purely via node.params.profile_ids; no ref edges.
    const src = [
      'pa = profile_circle(radius=0.3)',
      'pb = profile_circle(radius=0.1)',
      'lf = loft(profiles=[pa, pb], height=0.5)',
    ].join('\n')
    const r = compileDslToGraph(src)
    expect(r.ok).toBe(true)
    const loft = r.graph!.nodes.find((n) => n.id === 'lf')!
    expect(loft.params!.profile_ids).toEqual(['pa', 'pb'])
    // No id-output edge targets loft's profile_ids port.
    const profileEdges = r.graph!.edges.filter((e) => e.target.nodeId === 'lf' && e.target.port === 'profile_ids')
    expect(profileEdges).toHaveLength(0)
  })

  it('maps line numbers per node for agent-facing diagnostics', () => {
    const r = compileDslToGraph(CABINET)
    expect(r.lineByNodeId['mat']).toBe(1)
    expect(r.lineByNodeId['hinge']).toBe(9)
    expect(r.lineByNodeId[r.qcNodeId]).toBe(0)
  })
})

describe('compileDslToGraph: three-way pipeline routing', () => {
  it('routes a joint-less real-shape object to the STATIC chain (g_geometry_qc → g_bake_object → g_to_scene → scene_preview)', () => {
    const src = [
      'mat = material(rgba=[0.6, 0.4, 0.2, 1])',
      'body = box(size=[0.3, 0.2, 0.5])',
      'p_body = part(shape=body, material=mat)',
    ].join('\n')
    const r = compileDslToGraph(src)
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
    expect(r.mode).toBe('static')
    expect(r.sceneNodeId).toBeTruthy()
    expect(r.scenePreviewNodeId).toBeTruthy()
    // URDF / character terminals empty
    expect(r.urdfNodeId).toBe('')
    expect(r.rigNodeId).toBe('')
    const byId = new Map(r.graph!.nodes.map((n) => [n.id, n]))
    expect(byId.get(r.sceneNodeId)!.batteryId).toBe('g_to_scene')
    expect(byId.get(r.scenePreviewNodeId)!.batteryId).toBe('scene_preview')
    // reuses g_geometry_qc and bakes real-shape parts into one GLB via g_bake_object
    expect(r.graph!.nodes.some((n) => n.batteryId === 'g_geometry_qc')).toBe(true)
    expect(r.graph!.nodes.some((n) => n.batteryId === 'g_bake_object')).toBe(true)
    expect(r.graph!.nodes.some((n) => n.batteryId === 'g_to_urdf')).toBe(false)
    // the static bake only ever takes real shapes; mesh refs are g_to_scene's job
    expect(r.graph!.nodes.find((n) => n.batteryId === 'g_bake_object')!.params).toMatchObject({ include_mesh_parts: false })
    // g_bake_object.filename → g_to_scene.object_filename wired
    expect(r.graph!.edges.some((e) => e.source.port === 'filename' && e.target.port === 'object_filename' && e.target.nodeId === r.sceneNodeId)).toBe(true)
    // g_to_scene.sceneSpec → scene_preview.sceneSpec wired
    expect(r.graph!.edges.some((e) => e.source.port === 'sceneSpec' && e.target.nodeId === r.scenePreviewNodeId)).toBe(true)
  })

  it('routes a mesh-ref scene assembly to the STATIC chain WITHOUT an object bake', () => {
    const src = [
      'm1 = mesh(filename="aaa.obj", bbox_min=[0,0,0], bbox_max=[1,1,1])',
      'p1 = part(shape=m1, origin=[0, 0, 0])',
      'm2 = mesh(filename="bbb.obj", bbox_min=[0,0,0], bbox_max=[1,1,1])',
      'p2 = part(shape=m2, origin=[2, 0, 0])',
    ].join('\n')
    const r = compileDslToGraph(src)
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
    expect(r.mode).toBe('static')
    expect(r.graph!.nodes.some((n) => n.batteryId === 'g_to_scene')).toBe(true)
    // scene of already-baked mesh refs must NOT go through g_bake_object (it rejects mesh refs)
    expect(r.graph!.nodes.some((n) => n.batteryId === 'g_bake_object')).toBe(false)
    expect(r.graph!.nodes.some((n) => n.batteryId === 'g_to_urdf')).toBe(false)
  })

  it('keeps the object bake when real-shape parts and mesh refs are MIXED', () => {
    // A hand-authored roof standing next to a pre-baked storey mesh. Short-circuiting
    // on the first mesh ref used to skip the bake here and silently drop the roof.
    const src = [
      'lv = mesh(filename="storey.glb", bbox_min=[-6,-5,0], bbox_max=[6,5,3.2])',
      'p_lv1 = part(shape=lv)',
      'p_lv2 = part(shape=lv, origin=[0, 0, 3.2])',
      'roof = roof(footprint=[13, 11], type="gable", height=1.6)',
      'p_roof = part(shape=roof, origin=[0, 0, 6.4])',
    ].join('\n')
    const r = compileDslToGraph(src)
    expect(r.ok).toBe(true)
    expect(r.mode).toBe('static')
    const bake = r.graph!.nodes.find((n) => n.batteryId === 'g_bake_object')
    expect(bake).toBeDefined()
    // the mesh storeys stay out of the merged GLB and reach the scene as their own items
    expect(bake!.params).toMatchObject({ include_mesh_parts: false })
    expect(r.graph!.edges.some((e) => e.source.nodeId === bake!.id && e.target.nodeId === r.sceneNodeId && e.target.port === 'object_filename')).toBe(true)
  })

  it('routes a jointed assembly to the URDF chain', () => {
    const r = compileDslToGraph(CABINET)
    expect(r.mode).toBe('urdf')
    expect(r.urdfNodeId).toBeTruthy()
    expect(r.sceneNodeId).toBe('')
  })

  it('honors an explicit pipeline override (bypasses content inference)', () => {
    const staticSrc = ['b = box(size=[1, 1, 1])', 'p = part(shape=b)'].join('\n')
    // default inference → static; forced mechanical → urdf
    expect(compileDslToGraph(staticSrc).mode).toBe('static')
    expect(compileDslToGraph(staticSrc, { pipeline: 'mechanical' }).mode).toBe('urdf')
    expect(compileDslToGraph(staticSrc, { pipeline: 'urdf' }).mode).toBe('urdf')
    // a jointed DSL defaults to urdf; forced static freezes it
    expect(compileDslToGraph(CABINET).mode).toBe('urdf')
    expect(compileDslToGraph(CABINET, { pipeline: 'static' }).mode).toBe('static')
  })
})

describe('compileDslToGraph: op → battery mapping', () => {
  it('dispatches joint(type=X) to the concrete g_joint_X battery', () => {
    const src = [
      'b1 = box(size=[1,1,1])',
      'p1 = part(shape=b1)',
      'b2 = box(size=[1,1,1])',
      'p2 = part(shape=b2)',
      'jf = joint(type="fixed", parent=p1, child=p2)',
      'jr = joint(type="revolute", parent=p1, child=p2, axis=[0,0,1])',
      'jp = joint(type="prismatic", parent=p1, child=p2, axis=[1,0,0])',
    ].join('\n')
    const r = compileDslToGraph(src)
    expect(r.ok).toBe(true)
    const byId = new Map(r.graph!.nodes.map((n) => [n.id, n]))
    expect(byId.get('jf')!.batteryId).toBe('g_joint_fixed')
    expect(byId.get('jr')!.batteryId).toBe('g_joint_revolute')
    expect(byId.get('jp')!.batteryId).toBe('g_joint_prismatic')
  })

  it('maps fillet and chamfer to g_fillet with correct type param', () => {
    const src = [
      'b = box(size=[1,1,1])',
      'f = fillet(shape=b, radius=0.02)',
      'c = chamfer(shape=b, radius=0.02)',
    ].join('\n')
    const r = compileDslToGraph(src)
    const byId = new Map(r.graph!.nodes.map((n) => [n.id, n]))
    expect(byId.get('f')!.batteryId).toBe('g_fillet')
    expect(byId.get('f')!.params!.type).toBe('round')
    expect(byId.get('c')!.batteryId).toBe('g_fillet')
    expect(byId.get('c')!.params!.type).toBe('chamfer')
  })

  it('adapts Architecture vector args to battery scalar ports without defaulting', () => {
    const src = [
      'wall1 = wall(length=9, height=3, thickness=0.28, openings=[[1,1.8,0.9,2]])',
      'slab = floor_slab(size=[9,7], thickness=0.35, holes=[[1,2,1.2,2.4]])',
      'roof1 = roof(footprint=[9.5,7.5], type="hip", height=2.2)',
      'panel = facade_panel(panel_size=[3.2,2.6], thickness=0.04)',
      'win = window(size=[1.8,1.1], depth=0.28, frame=0.07)',
      'frame1 = door_frame(size=[1.4,2.3], depth=0.28, frame=0.09)',
      'leaf1 = door_leaf(size=[1.1,2.15], thickness=0.05, hinge="left")',
    ].join('\n')
    const r = compileDslToGraph(src)
    expect(r.ok).toBe(true)
    const byId = new Map(r.graph!.nodes.map((n) => [n.id, n]))
    expect(byId.get('wall1')).toMatchObject({
      batteryId: 'g_wall',
      params: { length: 9, height: 3, thickness: 0.28, openings: '[[1,1.8,0.9,2]]' },
    })
    expect(byId.get('slab')).toMatchObject({
      batteryId: 'g_floor_slab',
      params: { width: 9, depth: 7, thickness: 0.35, holes: '[[1,2,1.2,2.4]]' },
    })
    expect(byId.get('roof1')).toMatchObject({
      batteryId: 'g_roof',
      params: { width: 9.5, depth: 7.5, type: 'hip', height: 2.2 },
    })
    expect(byId.get('panel')).toMatchObject({
      batteryId: 'g_facade_panel',
      params: { panel_w: 3.2, panel_h: 2.6, thickness: 0.04 },
    })
    expect(byId.get('win')).toMatchObject({
      batteryId: 'g_window',
      params: { width: 1.8, height: 1.1, depth: 0.28, frame: 0.07 },
    })
    expect(byId.get('frame1')).toMatchObject({
      batteryId: 'g_door_frame',
      params: { width: 1.4, height: 2.3, depth: 0.28, frame: 0.09 },
    })
    expect(byId.get('leaf1')).toMatchObject({
      batteryId: 'g_door_leaf',
      params: { width: 1.1, height: 2.15, thickness: 0.05, hinge: 'left' },
    })
  })

  it('round-trips Architecture vector args through their scalar-port adapters', () => {
    const src = [
      'wall1 = wall(length=9, height=3, thickness=0.28, openings=[[1,1.8,0.9,2]])',
      'slab = floor_slab(size=[9,7], thickness=0.35, holes=[[1,2,1.2,2.4]])',
      'win = window(size=[1.8,1.1], depth=0.28)',
      'frame1 = door_frame(size=[1.4,2.3], depth=0.28)',
      'leaf1 = door_leaf(size=[1.1,2.15], thickness=0.05, hinge="right")',
    ].join('\n')
    const r = compileDslToGraph(src)
    expect(r.ok).toBe(true)
    const reparsed = parseDSL(graphToDsl(r.graph!.nodes, r.graph!.edges))
    expect(canon(reparsed.statements)).toEqual(canon(parseDSL(src).statements))
  })

  it('maps storey_stack to g_storey_stack, with parts as a param array and root as an edge', () => {
    const src = [
      'slab = floor_slab(size=[12,10], thickness=0.2)',
      'w = wall(length=12, height=3.2, thickness=0.2)',
      'p_slab = part(shape=slab)',
      'p_w = part(shape=w)',
      'j = joint(type="fixed", parent=p_slab, child=p_w, origin=[0,-5,0.2])',
      'lv = storey_stack(parts=[p_slab, p_w], root=p_slab, count=8, storey_height=3.2)',
    ].join('\n')
    const r = compileDslToGraph(src)
    expect(r.ok).toBe(true)
    const byId = new Map(r.graph!.nodes.map((n) => [n.id, n]))
    expect(byId.get('lv')).toMatchObject({
      batteryId: 'g_storey_stack',
      params: { part_ids: ['p_slab', 'p_w'], root_id: 'p_slab', count: 8, storey_height: 3.2 },
    })
    // Same rule as loft/extrude_with_holes: a ref-LIST travels in params only,
    // because N edges into one single-valued port would collapse to one id.
    expect(r.graph!.edges.filter((e) => e.target.nodeId === 'lv' && e.target.port === 'part_ids')).toHaveLength(0)
    // The single `root` ref still wires an edge so the battery sees the live id.
    expect(r.graph!.edges.some((e) => e.target.nodeId === 'lv' && e.target.port === 'root_id')).toBe(true)
  })

  it('round-trips storey_stack through the graph', () => {
    const src = [
      'slab = floor_slab(size=[12,10], thickness=0.2)',
      'p_slab = part(shape=slab)',
      'lv = storey_stack(parts=[p_slab], root=p_slab, mode="instance", count=8, storey_height=3.2, prefix="tower")',
    ].join('\n')
    const r = compileDslToGraph(src)
    expect(r.ok).toBe(true)
    const reparsed = parseDSL(graphToDsl(r.graph!.nodes, r.graph!.edges))
    expect(canon(reparsed.statements)).toEqual(canon(parseDSL(src).statements))
  })

  it('maps rock/boulder to g_rock with radius/irregularity/seed/detail/stretch split into sx/sy/sz', () => {
    const src = [
      'r1 = rock(radius=0.3, irregularity=0.4, seed=7, detail=2, stretch=[1.5, 1, 0.6])',
      'r2 = boulder(radius=0.6)',
    ].join('\n')
    const r = compileDslToGraph(src)
    expect(r.ok).toBe(true)
    const byId = new Map(r.graph!.nodes.map((n) => [n.id, n]))
    expect(byId.get('r1')!.batteryId).toBe('g_rock')
    expect(byId.get('r1')!.params).toMatchObject({
      radius: 0.3, irregularity: 0.4, seed: 7, detail: 2, sx: 1.5, sy: 1, sz: 0.6,
    })
    expect(byId.get('r2')!.batteryId).toBe('g_rock')
    expect(byId.get('r2')!.params).toMatchObject({ radius: 0.6 })
  })

  it('boulder normalizes to rock on round-trip (documented alias trade-off: not a stable round-trip)', () => {
    const src = 'r1 = boulder(radius=0.5, seed=3)'
    const r = compileDslToGraph(src)
    const back = graphToDsl(r.graph!.nodes, r.graph!.edges)
    expect(back).toContain('rock(')
    expect(back).not.toContain('boulder(')
  })

  it('round-trips a rock statement (op name + args preserved)', () => {
    const src = 'r1 = rock(radius=0.3, irregularity=0.4, seed=7, detail=2, stretch=[1.5, 1, 0.6])'
    const r = compileDslToGraph(src)
    const back = graphToDsl(r.graph!.nodes, r.graph!.edges)
    const reparsed = parseDSL(back)
    expect(canon(reparsed.statements)).toEqual(canon(parseDSL(src).statements))
  })

  it('maps sdf_blob to g_sdf_blob, with nested primitives/operations tuples JSON-encoded and bounds as a plain list', () => {
    const src = [
      'blob = sdf_blob(' +
        'primitives=[["sphere","a",0,0,0,0.5,0,0,0,0,0],["sphere","b",0.5,0,0,0.4,0,0,0,0,0]], ' +
        'operations=[["smooth-union","u","a","b",0.2]], ' +
        'resolution=24, ' +
        'bounds=[-2,-2,-2,2,2,2])',
    ].join('\n')
    const r = compileDslToGraph(src)
    expect(r.ok).toBe(true)
    const byId = new Map(r.graph!.nodes.map((n) => [n.id, n]))
    const node = byId.get('blob')!
    expect(node.batteryId).toBe('g_sdf_blob')
    expect(node.params.resolution).toBe(24)
    expect(node.params.bounds).toEqual([-2, -2, -2, 2, 2, 2])
    expect(JSON.parse(node.params.primitives as string)).toEqual([
      ['sphere', 'a', 0, 0, 0, 0.5, 0, 0, 0, 0, 0],
      ['sphere', 'b', 0.5, 0, 0, 0.4, 0, 0, 0, 0, 0],
    ])
    expect(JSON.parse(node.params.operations as string)).toEqual([
      ['smooth-union', 'u', 'a', 'b', 0.2],
    ])
  })

  it('round-trips a sdf_blob statement (nested primitives/operations tuples + bounds preserved)', () => {
    const src = 'blob = sdf_blob(' +
      'primitives=[["capsule","a",0,0,0,0.3,1,0,0,0,0]], ' +
      'operations=[], ' +
      'resolution=16, ' +
      'bounds=[-1,-1,-1,1,1,1])'
    const r = compileDslToGraph(src)
    expect(r.ok).toBe(true)
    const back = graphToDsl(r.graph!.nodes, r.graph!.edges)
    const reparsed = parseDSL(back)
    expect(canon(reparsed.statements)).toEqual(canon(parseDSL(src).statements))
  })

  it('sdf_blob omits operations from the round-tripped DSL when none were given (empty list is not re-emitted)', () => {
    const src = 'blob = sdf_blob(primitives=[["sphere","a",0,0,0,1,0,0,0,0,0]], resolution=8)'
    const r = compileDslToGraph(src)
    expect(r.ok).toBe(true)
    const back = graphToDsl(r.graph!.nodes, r.graph!.edges)
    expect(back).not.toContain('operations=')
  })
})

describe('compileDslToGraph: unknown op', () => {
  it('reports an unmapped op with its 1-based line number and does not build a graph', () => {
    const src = ['x = box(size=[1,1,1])', 'y = wibblewobble(foo=1)'].join('\n')
    const r = compileDslToGraph(src)
    expect(r.ok).toBe(false)
    expect(r.graph).toBeNull()
    const unmapped = r.errors.find((e) => e.kind === 'unmapped-op')
    expect(unmapped).toBeTruthy()
    expect(unmapped!.line).toBe(2)
    expect(unmapped!.message).toContain('wibblewobble')
  })

  it('reports parse errors without a graph', () => {
    const r = compileDslToGraph('m = material(texture="oops')
    expect(r.ok).toBe(false)
    expect(r.graph).toBeNull()
    expect(r.errors.length).toBeGreaterThan(0)
  })
})

describe('compileDslToGraph: op-registry ↔ battery mapping parity', () => {
  // 防漂移守卫：op-registry(SSOT，op-directory.md 由它生成) 里暴露给 DSL 的每个 op
  // 都必须在 OP_TABLE / GENERIC_BATTERY 里有电池映射，否则 agent 会写出一个
  // 目录里合法、却在编译期报 "unmapped-op" 的 op（如历史上的 pipe / section_loft）。
  it('maps every DSL-authorable op advertised by listOpSpecs() to a battery', () => {
    const unmapped: string[] = []
    for (const spec of listOpSpecs()) {
      const r = compileDslToGraph(`t = ${spec.name}()`, { appendTerminals: false })
      if (r.errors.some((e) => e.kind === 'unmapped-op')) unmapped.push(spec.name)
    }
    expect(unmapped).toEqual([])
  })

  // 更深一层的防漂移守卫（发现 A 的修复）：光有 OP_TABLE/GENERIC_BATTERY 里的映射不够——
  // 3b752a7c 删除了 30 个机械件/齿轮电池的实现却没同步清理 op-registry/OP_TABLE，于是
  // 上面这条“有映射就算过”的测试全程绿灯，实际编译却在图导入阶段（@forgeax/node-runtime
  // 扫描 batteries/ 目录）才报 "unknown opId"。这里直接复用 kernel 加载器同款的目录扫描
  // （scanBatteryCategories + resolveBatteryScanRoots）构建“真实可加载电池” id 集合，
  // 对每个 op 编译出的 batteryId 都必须能在这个集合里找到，才能真正在 CI 阶段拦住这类漂移。
  it('resolves every mapped batteryId to a battery that actually exists on disk', async () => {
    const roots = resolveBatteryScanRoots(appRoot)
    const realBatteries = await scanBatteryCategories(roots)

    const missing: Array<{ op: string; batteryId: string }> = []
    for (const spec of listOpSpecs()) {
      const r = compileDslToGraph(`t = ${spec.name}()`, { appendTerminals: false })
      if (!r.ok || !r.graph) continue // unmapped-op already covered by the test above
      const node = r.graph.nodes.find((n) => n.id === 't')
      if (!node) continue
      if (!realBatteries.has(node.batteryId)) missing.push({ op: spec.name, batteryId: node.batteryId })
    }
    expect(missing).toEqual([])
  })
})

describe('graphToDsl: round-trip', () => {
  it('reconstructs an equivalent DSL from the compiled graph', () => {
    const r = compileDslToGraph(CABINET)
    const back = graphToDsl(r.graph!.nodes, r.graph!.edges)
    const original = parseDSL(CABINET)
    const reparsed = parseDSL(back)
    expect(reparsed.errors).toEqual([])
    expect(canon(reparsed.statements)).toEqual(canon(original.statements))
  })

  it('preserves chamfer (not silently downgraded to fillet)', () => {
    const src = ['b = box(size=[1,1,1])', 'c = chamfer(shape=b, radius=0.02, edges="all")'].join('\n')
    const r = compileDslToGraph(src)
    const back = graphToDsl(r.graph!.nodes, r.graph!.edges)
    expect(back).toContain('chamfer(')
    expect(back).not.toContain('fillet(')
    const reparsed = parseDSL(back)
    expect(canon(reparsed.statements)).toEqual(canon(parseDSL(src).statements))
  })

  it('preserves joint type + axis + limits through round-trip', () => {
    const r = compileDslToGraph(CABINET)
    const back = graphToDsl(r.graph!.nodes, r.graph!.edges)
    const hinge = parseDSL(back).statements.find((s) => s.id === 'hinge')!
    expect(hinge.op).toBe('joint')
    expect(hinge.args.type).toEqual({ kind: 'string', value: 'revolute' })
    expect(hinge.args.axis).toEqual({ kind: 'list', items: [
      { kind: 'number', value: 0 }, { kind: 'number', value: 0 }, { kind: 'number', value: 1 },
    ] })
  })
})
