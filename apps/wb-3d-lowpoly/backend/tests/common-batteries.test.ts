import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildApp } from '../src/main.js'
import {
  emit,
  makeGeometry,
  num,
  numList,
  ref,
  str,
  parseQuadList,
  validateStatements,
  localAabbFromShape,
  type Arg,
  type Geometry,
  type Statement,
} from '../../vendor/dist/shared/types/index.js'
import { gMetrics } from '../../batteries/Output/QC/g_metrics/index.ts'
import { gWall } from '../../batteries/Generate/Architecture/g_wall/index.ts'
import { gFloorSlab } from '../../batteries/Generate/Architecture/g_floor_slab/index.ts'
import { gRoof } from '../../batteries/Generate/Architecture/g_roof/index.ts'
import { gStairs } from '../../batteries/Generate/Architecture/g_stairs/index.ts'
import { gColumn } from '../../batteries/Generate/Architecture/g_column/index.ts'
import { gDoor } from '../../batteries/Generate/Architecture/g_door/index.ts'
import { gDoorFrame } from '../../batteries/Generate/Architecture/g_door_frame/index.ts'
import { gDoorLeaf } from '../../batteries/Generate/Architecture/g_door_leaf/index.ts'
import { gWindow } from '../../batteries/Generate/Architecture/g_window/index.ts'
import { gRailing } from '../../batteries/Generate/Architecture/g_railing/index.ts'
import { gFacadePanel } from '../../batteries/Generate/Architecture/g_facade_panel/index.ts'

let app: Awaited<ReturnType<typeof buildApp>>
let projectRoot: string
const MAIN = '/api/v1/projects/main'

beforeAll(async () => {
  projectRoot = mkdtempSync(join(tmpdir(), 'wb-3d-common-test-'))
  process.env.FORGEAX_PROJECT_ROOT = projectRoot
  app = await buildApp()
})

afterAll(async () => {
  await app.close()
  rmSync(projectRoot, { recursive: true, force: true })
})

describe('common batteries', () => {
  it('exposes shared common batteries in the catalog with stable op ids', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/ops' })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toContainEqual(expect.objectContaining({
      id: 'number_const',
      category: 'common/input',
      type: 'common',
      nodeType: 'number_const',
    }))
    expect(r.json()).toContainEqual(expect.objectContaining({
      id: 'tree_merge',
      category: 'common/datatree',
      type: 'common',
    }))
    expect(r.json()).toContainEqual(expect.objectContaining({ id: 'g_door_frame' }))
    expect(r.json()).toContainEqual(expect.objectContaining({ id: 'g_door_leaf' }))
  })

  it('creates and executes a common range_list battery through the API', async () => {
    const batch = await app.inject({
      method: 'POST',
      url: `${MAIN}/batch`,
      payload: {
        ops: [
          { type: 'createNode', nodeId: 'range', opId: 'range_list', position: { x: 0, y: 0 }, params: { start: 1, end: 3, step: 1 } },
        ],
      },
    })
    expect(batch.json().status).toBe('ok')

    const exec = await app.inject({ method: 'POST', url: `${MAIN}/execute`, payload: { nodeId: 'range' } })
    expect(exec.statusCode).toBe(200)
    expect(exec.json()).toMatchObject({ status: 'completed' })
    expect(exec.json().outputs.range.list).toEqual([
      { path: [0, 0], items: [1] },
      { path: [0, 1], items: [2] },
      { path: [0, 2], items: [3] },
    ])
  })

  it('persists AI/CLI batch labels and caller batch ids in history', async () => {
    const batch = await app.inject({
      method: 'POST',
      url: `${MAIN}/batch`,
      payload: {
        ops: [
          { type: 'createNode', nodeId: 'labeled', opId: 'relu', position: { x: 0, y: 0 }, params: { value: 1 } },
        ],
        opts: { actor: 'ai:staged', label: 'Stage 1: labeled batch', batchId: 'stage-batch-1' },
      },
    })
    expect(batch.json()).toMatchObject({ status: 'ok', batchId: 'stage-batch-1' })

    const history = await app.inject({ method: 'GET', url: `${MAIN}/history` })
    expect(history.json()).toContainEqual(expect.objectContaining({
      actor: 'ai:staged',
      label: 'Stage 1: labeled batch',
      batchId: 'stage-batch-1',
    }))
  })
})

// ─────────────────────────────────────────────────────────────────────────
// g_metrics: 量化评估电池（复用抽出的 FK/AABB 数学）
// ─────────────────────────────────────────────────────────────────────────

describe('g_metrics quality metrics', () => {
  it('reports n/a-style empty metrics when there is no Geometry input', () => {
    const out = gMetrics({})
    expect(out.geometry).toBeNull()
    expect(out.score).toBe(0)
    expect(out.grade).toBe('F')
    expect(out.report).toBe('no Geometry input')
  })

  it('quantifies a known sibling overlap (two unit cubes offset 0.8m along X)', () => {
    // p1 在原点、p2 经 fixed joint 沿 +X 平移 0.8m → 世界 AABB 在 X 重叠 0.2m。
    let g: Geometry = makeGeometry()
    g = emit(g, 'b1', 'box', { size: numList([1, 1, 1]) })
    g = emit(g, 'p1', 'part', { shape: ref('b1') })
    g = emit(g, 'b2', 'box', { size: numList([1, 1, 1]) })
    g = emit(g, 'p2', 'part', { shape: ref('b2') })
    g = emit(g, 'j', 'joint', { type: str('fixed'), parent: ref('p1'), child: ref('p2'), origin: numList([0.8, 0, 0]) })

    const out = gMetrics({ geometry: g })
    expect(out.overlap_pairs).toBe(1)
    // 重叠盒 = 0.2(X) × 1(Y) × 1(Z) = 0.2 m³；最小轴穿深 = 0.2 m。
    expect(out.overlap_volume as number).toBeCloseTo(0.2, 6)
    expect(out.max_penetration as number).toBeCloseTo(0.2, 6)
    // 连接良好：一个岛、无悬空、无缝隙。
    expect(out.islands).toBe(1)
    expect(out.floating_links).toBe(0)
    expect(out.joints_with_gap).toBe(0)
    // 立方体基元居中 → 最低点 z=-0.5（陷入地面）；纯 primitive。
    expect(out.ground_offset as number).toBeCloseTo(-0.5, 6)
    expect(out.primitive_only).toBe(true)
    // 评分：-overlap(1) -grounding(5) -primitive(10) = 84 (B)。
    expect(out.score).toBe(84)
    expect(out.grade).toBe('B')
    expect(String(out.report)).toContain('[basic]')
    expect(String(out.report)).toContain('overlap:')
  })

  it('flags a disconnected part as a second island', () => {
    let g: Geometry = makeGeometry()
    g = emit(g, 'b1', 'box', { size: numList([1, 1, 1]) })
    g = emit(g, 'p1', 'part', { shape: ref('b1') })
    g = emit(g, 'b2', 'box', { size: numList([1, 1, 1]) })
    g = emit(g, 'p2', 'part', { shape: ref('b2'), origin: numList([5, 0, 0]) })
    // 无 joint 连接 → 两个孤岛。
    const out = gMetrics({ geometry: g })
    expect(out.islands).toBe(2)
    expect(out.overlap_pairs).toBe(0)
    expect(String(out.report)).toContain('islands=2')
  })

  it('counts a moving-joint rest-pose collision separately and fails collision', () => {
    let g: Geometry = makeGeometry()
    g = emit(g, 'b1', 'box', { size: numList([1, 1, 1]) })
    g = emit(g, 'p1', 'part', { shape: ref('b1') })
    g = emit(g, 'b2', 'box', { size: numList([1, 1, 1]) })
    g = emit(g, 'p2', 'part', { shape: ref('b2') })
    // revolute 父子在休止位互穿（同位重叠）→ 真实缺陷。
    g = emit(g, 'j', 'joint', { type: str('revolute'), parent: ref('p1'), child: ref('p2'), origin: numList([0.3, 0, 0]), axis: numList([0, 0, 1]) })
    const out = gMetrics({ geometry: g })
    expect(out.moving_joint_collisions).toBe(1)
    expect(out.dof).toBe(1)
    expect(String(out.report)).toContain('collision:  moving_joint=1')
  })

  // 回归（Finding B P2）：poly-budget 从未被真正测量过（本电池不烘焙），bake=true
  // 不该让 polybudget 看起来像"已测量并通过"——之前的占位实现会在 bake=true 时
  // 悄悄报 [pass]，即使 tri_count 恒为 0、from 从没跟 tri_budget 比对过。
  it('never claims the poly budget was measured, even with bake=true and a tri_budget set', () => {
    let g: Geometry = makeGeometry()
    g = emit(g, 'b1', 'box', { size: numList([1, 1, 1]) })
    g = emit(g, 'p1', 'part', { shape: ref('b1') })
    const out = gMetrics({ geometry: g, bake: true, tri_budget: 100 })
    expect(out.tri_count).toBe(0)
    expect(out.vertex_count).toBe(0)
    expect(out.over_budget).toBe(false)
    expect(String(out.report)).toMatch(/polybudget:.*\[n\/a\]/)
    expect(String(out.report)).not.toMatch(/polybudget:.*\[pass\]/)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// 解析器回归：共享 parseQuadList + g_wall/g_floor_slab 复用后一致
// ─────────────────────────────────────────────────────────────────────────

describe('parseQuadList shared parser', () => {
  const msgs = { json: 'JSON_ERR', notArray: 'NOT_ARRAY', badRow: 'BAD_ROW' }

  it('returns [] for empty / null / undefined', () => {
    expect(parseQuadList(undefined, msgs)).toEqual([])
    expect(parseQuadList(null, msgs)).toEqual([])
    expect(parseQuadList('', msgs)).toEqual([])
  })

  it('parses a JSON string of 4-tuples into number[][]', () => {
    expect(parseQuadList('[[1,0.9,0,2.1],[-1,1.2,0.5,2.4]]', msgs)).toEqual([
      [1, 0.9, 0, 2.1],
      [-1, 1.2, 0.5, 2.4],
    ])
  })

  it('accepts an already-parsed array', () => {
    expect(parseQuadList([[0, 0, 1, 1]], msgs)).toEqual([[0, 0, 1, 1]])
  })

  it('reports json / notArray / badRow errors distinctly', () => {
    expect(parseQuadList('{oops', msgs)).toEqual({ error: 'JSON_ERR' })
    expect(parseQuadList('42', msgs)).toEqual({ error: 'NOT_ARRAY' })
    expect(parseQuadList('[[1,2,3]]', msgs)).toEqual({ error: 'BAD_ROW' })
    expect(parseQuadList('[[1,2,"x",4]]', msgs)).toEqual({ error: 'BAD_ROW' })
  })

  it('g_wall.parseOpenings and g_floor_slab reuse the shared parser (same shape)', () => {
    // 两个电池共用 parseQuadList，只是错误文案不同；成功路径逐字节等价。
    const wall = gWall({ length: 4, height: 2.8, thickness: 0.2, openings: '[[1,0.9,0,2.1]]', id: 'w1' })
    expect(wall.error).toBeUndefined()
    const wallOpening = (wall.geometry as Geometry).statements[0].args.openings
    expect(wallOpening).toEqual({
      kind: 'list',
      items: [{ kind: 'list', items: [
        { kind: 'number', value: 1 },
        { kind: 'number', value: 0.9 },
        { kind: 'number', value: 0 },
        { kind: 'number', value: 2.1 },
      ] }],
    })
    const slab = gFloorSlab({ width: 6, depth: 4, thickness: 0.2, holes: '[[0,0,1.2,1.2]]', id: 's1' })
    expect(slab.error).toBeUndefined()
    // 坏行经由同一 parser 报错（文案各自定制）。
    const badWall = gWall({ length: 4, height: 2.8, thickness: 0.2, openings: '[[1,2,3]]' })
    expect(String(badWall.error)).toContain('[x, width, sill, head]')
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Architecture 电池增强：新增可选参数经电池发出后仍通过 registry 校验，
// 且 AABB 估算对影响尺寸的参数作出响应。
// ─────────────────────────────────────────────────────────────────────────

describe('architecture battery enhancements', () => {
  const lastOf = (geom: Geometry): Statement => geom.statements[geom.statements.length - 1]
  const argOf = (stmt: Statement, name: string) => stmt.args[name]

  it('g_wall emits window band + plinth and validates against the registry', () => {
    const out = gWall({
      length: 6, height: 3, thickness: 0.2,
      window_band: true, band_sill: 0.9, band_head: 2.2, band_margin: 0.5,
      pane_width: 1.0, mullion: 0.06,
      plinth_height: 0.4, plinth_projection: 0.05,
      id: 'w',
    })
    expect(out.error).toBeUndefined()
    const geom = out.geometry as Geometry
    expect(validateStatements(geom.statements).ok).toBe(true)
    const stmt = lastOf(geom)
    expect(argOf(stmt, 'window_band')).toEqual({ kind: 'bool', value: true })
    expect(argOf(stmt, 'plinth_height')).toEqual({ kind: 'number', value: 0.4 })
    const aabb = localAabbFromShape(stmt)!
    // 勒脚外挑使 Y 半轴 = thickness/2 + projection。
    expect(aabb.halfExtent[1]).toBeCloseTo(0.1 + 0.05, 6)
  })

  it('g_wall rejects a plinth taller than the wall', () => {
    const out = gWall({ length: 4, height: 2.8, thickness: 0.2, plinth_height: 3 })
    expect(String(out.error)).toContain('plinth_height')
  })

  it('g_wall preserves baker auto defaults when window-band zero means auto', () => {
    const out = gWall({
      length: 6, height: 3, thickness: 0.2,
      window_band: true, band_sill: 0, band_head: 0, band_margin: 0, id: 'wauto',
    })
    const stmt = lastOf(out.geometry as Geometry)
    expect(argOf(stmt, 'window_band')).toEqual({ kind: 'bool', value: true })
    expect(argOf(stmt, 'band_sill')).toBeUndefined()
    expect(argOf(stmt, 'band_head')).toBeUndefined()
    expect(argOf(stmt, 'band_margin')).toBeUndefined()
  })

  it('g_roof splits eave/verge overhang and validates', () => {
    const out = gRoof({ width: 6, depth: 4, type: 'gable', height: 1.6, eave_overhang: 0.5, verge_overhang: 0.2, id: 'r' })
    expect(out.error).toBeUndefined()
    const geom = out.geometry as Geometry
    expect(validateStatements(geom.statements).ok).toBe(true)
    const stmt = lastOf(geom)
    expect(argOf(stmt, 'eave_overhang')).toEqual({ kind: 'number', value: 0.5 })
    expect(argOf(stmt, 'verge_overhang')).toEqual({ kind: 'number', value: 0.2 })
  })

  it('g_roof flat parapet + coping raise the AABB in Z and XY', () => {
    const plain = gRoof({ width: 6, depth: 4, type: 'flat', overhang: 0, id: 'r1' })
    const withParapet = gRoof({ width: 6, depth: 4, type: 'flat', overhang: 0, parapet_height: 0.8, parapet_thickness: 0.12, coping_width: 0.05, id: 'r2' })
    const aabbPlain = localAabbFromShape(lastOf(plain.geometry as Geometry))!
    const aabbParapet = localAabbFromShape(lastOf(withParapet.geometry as Geometry))!
    expect(aabbParapet.halfExtent[2]).toBeGreaterThan(aabbPlain.halfExtent[2])
    expect(aabbParapet.halfExtent[0]).toBeGreaterThan(aabbPlain.halfExtent[0])
    expect(validateStatements((withParapet.geometry as Geometry).statements).ok).toBe(true)
  })

  it('g_stairs emits open riser + landing and extends the run length in AABB', () => {
    const plain = gStairs({ total_rise: 2.8, run: 0.28, width: 1, step_count: 14, id: 's1' })
    const withLanding = gStairs({ total_rise: 2.8, run: 0.28, width: 1, step_count: 14, open_riser: true, tread_thickness: 0.05, landing_depth: 1.0, landing_after: 7, id: 's2' })
    expect(withLanding.error).toBeUndefined()
    const stmt = lastOf(withLanding.geometry as Geometry)
    expect(argOf(stmt, 'open_riser')).toEqual({ kind: 'bool', value: true })
    expect(argOf(stmt, 'landing_depth')).toEqual({ kind: 'number', value: 1.0 })
    expect(validateStatements((withLanding.geometry as Geometry).statements).ok).toBe(true)
    const aabbPlain = localAabbFromShape(lastOf(plain.geometry as Geometry))!
    const aabbLanding = localAabbFromShape(stmt)!
    expect(aabbLanding.halfExtent[0]).toBeGreaterThan(aabbPlain.halfExtent[0])
  })

  it('g_column emits taper / stepped styles / flutes and validates', () => {
    const out = gColumn({ height: 3, radius: 0.2, shape: 'round', base_height: 0.2, capital_height: 0.2, taper: 0.8, base_style: 'stepped', capital_style: 'stepped', flutes: 16, id: 'c' })
    expect(out.error).toBeUndefined()
    const geom = out.geometry as Geometry
    expect(validateStatements(geom.statements).ok).toBe(true)
    const stmt = lastOf(geom)
    expect(argOf(stmt, 'taper')).toEqual({ kind: 'number', value: 0.8 })
    expect(argOf(stmt, 'flutes')).toEqual({ kind: 'number', value: 16 })
    expect(argOf(stmt, 'base_style')).toEqual({ kind: 'string', value: 'stepped' })
  })

  it('g_column drops flutes on square shafts', () => {
    const out = gColumn({ height: 3, radius: 0.2, shape: 'square', flutes: 12, id: 'c2' })
    expect(argOf(lastOf(out.geometry as Geometry), 'flutes')).toBeUndefined()
  })

  it('g_door emits transom + sidelight on the frame and panel grid on leaves', () => {
    const out = gDoor({ width: 1.6, height: 2.4, depth: 0.2, leaves: 2, style: 'panel', panel_rows: 3, panel_cols: 2, transom: 0.4, sidelight: 0.3, id: 'd' })
    expect(out.error).toBeUndefined()
    const geom = out.geometry as Geometry
    expect(validateStatements(geom.statements).ok).toBe(true)
    const frame = geom.statements.find(s => s.op === 'door_frame')!
    expect(argOf(frame, 'transom')).toEqual({ kind: 'number', value: 0.4 })
    expect(argOf(frame, 'sidelight')).toEqual({ kind: 'number', value: 0.3 })
    const leaf = geom.statements.find(s => s.op === 'door_leaf')!
    expect(argOf(leaf, 'panel_rows')).toEqual({ kind: 'number', value: 3 })
    expect(argOf(leaf, 'panel_cols')).toEqual({ kind: 'number', value: 2 })
    // Central clear width = w - 3*frame - 2*sidelight = 0.76; two leaves share
    // it with a 0.01 center gap.
    const leafSize = argOf(leaf, 'size')
    expect(leafSize?.kind).toBe('list')
    expect((leafSize as Extract<Arg, { kind: 'list' }>).items[0]).toEqual({
      kind: 'number', value: expect.closeTo(0.375, 8),
    })
    const origins = JSON.parse(String(out.leaf_origins)) as number[][]
    expect(origins[0][0]).toBeCloseTo(-0.38, 8)
    expect(origins[1][0]).toBeCloseTo(0.38, 8)
  })

  it('dedicated door batteries emit exactly the requested DSL component', () => {
    const frameOut = gDoorFrame({
      width: 1.4, height: 2.3, depth: 0.28, frame: 0.09,
      transom: 0.3, sidelight: 0.2, id: 'frame_only',
    })
    expect(frameOut.error).toBeUndefined()
    const frameGeom = frameOut.geometry as Geometry
    expect(frameGeom.statements).toHaveLength(1)
    expect(frameGeom.statements[0].op).toBe('door_frame')
    expect(argOf(frameGeom.statements[0], 'size')).toEqual(numList([1.4, 2.3]))

    const leafOut = gDoorLeaf({
      width: 1.1, height: 2.15, thickness: 0.05,
      hinge: 'left', style: 'panel', panel_rows: 3, panel_cols: 2, id: 'leaf_only',
    })
    expect(leafOut.error).toBeUndefined()
    const leafGeom = leafOut.geometry as Geometry
    expect(leafGeom.statements).toHaveLength(1)
    expect(leafGeom.statements[0].op).toBe('door_leaf')
    expect(argOf(leafGeom.statements[0], 'size')).toEqual(numList([1.1, 2.15]))
    expect(validateStatements([...frameGeom.statements, ...leafGeom.statements]).ok).toBe(true)
  })

  it('g_window emits pane_width / sill / arch_top and rejects an impossible arch', () => {
    const out = gWindow({ width: 1.2, height: 1.8, depth: 0.2, frame: 0.06, pane_width: 0.4, sill: 0.08, arch_top: true, id: 'win' })
    expect(out.error).toBeUndefined()
    const geom = out.geometry as Geometry
    expect(validateStatements(geom.statements).ok).toBe(true)
    const stmt = lastOf(geom)
    expect(argOf(stmt, 'arch_top')).toEqual({ kind: 'bool', value: true })
    expect(argOf(stmt, 'sill')).toEqual({ kind: 'number', value: 0.08 })
    // 太矮的窗无法起拱（h <= w/2 + frame）。
    const bad = gWindow({ width: 2.0, height: 1.0, depth: 0.2, arch_top: true })
    expect(String(bad.error)).toContain('arch_top')
  })

  it('g_railing emits round posts + spacing + rails and reflects post shape in AABB', () => {
    const out = gRailing({ length: 3, height: 1.0, post_shape: 'round', post_radius: 0.06, post_spacing: 0.15, bottom_rail: true, mid_rail: true, top_rail_width: 0.08, id: 'rail' })
    expect(out.error).toBeUndefined()
    const geom = out.geometry as Geometry
    expect(validateStatements(geom.statements).ok).toBe(true)
    const stmt = lastOf(geom)
    expect(argOf(stmt, 'post_shape')).toEqual({ kind: 'string', value: 'round' })
    expect(argOf(stmt, 'bottom_rail')).toEqual({ kind: 'bool', value: true })
    const aabb = localAabbFromShape(stmt)!
    // round posts of radius 0.06 → Y envelope = post diameter 0.12 → half 0.06.
    expect(aabb.halfExtent[1]).toBeCloseTo(0.06, 6)
  })

  it('g_floor_slab emits perimeter beam + chamfer and extends the AABB below the slab', () => {
    const plain = gFloorSlab({ width: 6, depth: 4, thickness: 0.2, id: 'sl1' })
    const withBeam = gFloorSlab({ width: 6, depth: 4, thickness: 0.2, beam_depth: 0.4, beam_width: 0.24, edge_chamfer: 0.03, id: 'sl2' })
    expect(withBeam.error).toBeUndefined()
    const stmt = lastOf(withBeam.geometry as Geometry)
    expect(argOf(stmt, 'beam_depth')).toEqual({ kind: 'number', value: 0.4 })
    expect(validateStatements((withBeam.geometry as Geometry).statements).ok).toBe(true)
    const aabbPlain = localAabbFromShape(lastOf(plain.geometry as Geometry))!
    const aabbBeam = localAabbFromShape(stmt)!
    expect(aabbBeam.halfExtent[2]).toBeGreaterThan(aabbPlain.halfExtent[2])
    expect(aabbBeam.center[2]).toBeLessThan(aabbPlain.center[2])
  })

  it('g_floor_slab rejects holes that extend outside the slab', () => {
    const out = gFloorSlab({
      width: 6, depth: 4, thickness: 0.2,
      holes: '[[2.8,0,1,1]]',
    })
    expect(String(out.error)).toContain('exceeds slab')
  })

  it('g_facade_panel emits groove direction / spacing / board style and validates', () => {
    const out = gFacadePanel({ panel_w: 2.4, panel_h: 2.8, thickness: 0.03, groove_spacing: 0.3, groove_direction: 'both', board_style: 'shiplap', id: 'f' })
    expect(out.error).toBeUndefined()
    const geom = out.geometry as Geometry
    expect(validateStatements(geom.statements).ok).toBe(true)
    const stmt = lastOf(geom)
    expect(argOf(stmt, 'groove_spacing')).toEqual({ kind: 'number', value: 0.3 })
    expect(argOf(stmt, 'groove_direction')).toEqual({ kind: 'string', value: 'both' })
    expect(argOf(stmt, 'board_style')).toEqual({ kind: 'string', value: 'shiplap' })
  })

  it('keeps default facade output backward compatible (still horizontal groove_count)', () => {
    const out = gFacadePanel({ panel_w: 2.4, panel_h: 2.8, thickness: 0.03, id: 'f0' })
    const stmt = lastOf(out.geometry as Geometry)
    expect(argOf(stmt, 'groove_count')).toEqual({ kind: 'number', value: 6 })
    expect(argOf(stmt, 'groove_direction')).toBeUndefined()
    expect(argOf(stmt, 'board_style')).toBeUndefined()
  })
})
