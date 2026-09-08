/**
 * model.apply / model.get / parts.list 端到端（Workstream A/C · verify）。
 *
 * 通过真实 fastify app 走完整链路：DSL → 编译成图 → 导入 → 执行 → QC → URDF，
 * 断言紧凑回执正确、错误定位到 DSL 行号、model.get 反解 round-trip 等价。
 * 用纯 primitive 装配（box/joint），避免依赖 OCCT baker WASM，保持快、稳。
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/main.js'
import { resetRuntimeForTests } from '../src/runtime.js'
import { parseDSL, type Statement, type Arg } from '../../vendor/dist/shared/types/index.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'wb3d-model-apply-'))
  process.env.FORGEAX_PROJECT_ROOT = root
})

afterEach(() => {
  resetRuntimeForTests()
  rmSync(root, { recursive: true, force: true })
  delete process.env.FORGEAX_PROJECT_ROOT
})

const ASSEMBLY = [
  'mat = material(rgba=[0.2, 0.2, 0.2, 1])',
  'base = box(size=[0.2, 0.2, 0.1])',
  'p_base = part(shape=base, material=mat)',
  'top = box(size=[0.1, 0.1, 0.1])',
  'p_top = part(shape=top, material=mat)',
  'j = joint(type="fixed", parent=p_base, child=p_top, origin=[0, 0, 0.1])',
].join('\n')

function canon(statements: readonly Statement[]): Record<string, { op: string; args: string }> {
  const out: Record<string, { op: string; args: string }> = {}
  for (const s of statements) {
    const keys = Object.keys(s.args as Record<string, Arg>).sort()
    out[s.id] = { op: s.op, args: JSON.stringify(keys.map((k) => [k, (s.args as Record<string, Arg>)[k]])) }
  }
  return out
}

describe('model.apply e2e', () => {
  // Regression for the 413 that a large static-scene DSL used to hit: `/model/apply`
  // reused `EXECUTE_BODY_LIMIT` (64KB, sized for `/execute`'s tiny nodeId-only
  // payload) instead of a limit sized for DSL *source text*. A scene with a few
  // hundred `mesh → part` instances easily clears 64KB and got rejected before a
  // single line was even parsed — surfacing to the agent as an opaque mid-run
  // failure with no DSL line number to fix.
  it('accepts a DSL source well past the old 64KB execute-body limit', async () => {
    const app = await buildApp()
    try {
      // Pad with a DSL comment (parser discards `#...` lines, see dsl-quickref.md)
      // so the HTTP body genuinely exceeds 64KB while the compiled graph stays a
      // handful of nodes — this isolates the bodyLimit regression from unrelated
      // large-graph compile/execute cost.
      const padding = `# ${'x'.repeat(80 * 1024)}`
      const source = [padding, 'b = box(size=[0.2, 0.2, 0.2])', 'p = part(shape=b)'].join('\n')
      expect(source.length).toBeGreaterThan(64 * 1024)

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/projects/main/model/apply',
        payload: { source },
      })
      expect(res.statusCode).not.toBe(413)
      expect(res.statusCode).toBe(200)
      expect(res.json().ok).toBe(true)
    } finally {
      await app.close()
    }
  })

  it('returns source hashes, non-blocking metrics, and compact QC metadata', async () => {
    const app = await buildApp()
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/projects/main/model/apply',
        payload: { source: ASSEMBLY },
      })
      const body = res.json()
      expect(body.ok).toBe(true)
      expect(body.sourceHash).toMatch(/^[a-f0-9]{64}$/)
      expect(body.metrics.nonBlocking).toBe(true)
      expect(typeof body.metrics.score).toBe('number')
      expect(typeof body.metrics.primitiveRatio).toBe('number')
      expect(body.qc.total).toBeGreaterThanOrEqual(0)
      expect(body.qc.omittedCount).toBeGreaterThanOrEqual(0)
      expect(body.qualityReport.hash).toMatch(/^[a-f0-9]{64}$/)
    } finally {
      await app.close()
    }
  })

  it('rejects stale patches and applies a matching source-hash patch', async () => {
    const app = await buildApp()
    try {
      await app.inject({ method: 'POST', url: '/api/v1/projects/main/model/apply', payload: { source: ASSEMBLY } })
      const got = (await app.inject({ method: 'GET', url: '/api/v1/projects/main/model/get' })).json()
      const stale = await app.inject({
        method: 'POST',
        url: '/api/v1/projects/main/model/patch',
        payload: { baseHash: 'stale', patches: [{ line: 2, content: 'base = box(size=[0.3, 0.2, 0.1])' }] },
      })
      expect(stale.statusCode).toBe(409)
      expect(stale.json().code).toBe('source-hash-conflict')

      const patched = await app.inject({
        method: 'POST',
        url: '/api/v1/projects/main/model/patch',
        payload: { baseHash: got.sourceHash, patches: [{ line: 2, content: 'base = box(size=[0.3, 0.2, 0.1])' }] },
      })
      expect(patched.statusCode).toBe(200)
      expect(patched.json().ok).toBe(true)
      expect(patched.json().sourceHash).not.toBe(got.sourceHash)
    } finally {
      await app.close()
    }
  })

  it('bakeBatch reports partial failures without discarding item receipts', async () => {
    const app = await buildApp()
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/projects/main/model/bake-batch',
        payload: {
          items: [
            { name: 'valid', source: 'b = box(size=[1,1,1])', target: 'b', expectedDims: [1, 1, 1] },
            { name: 'invalid', source: 'x = unknown_shape(foo=1)', target: 'x' },
          ],
        },
      })
      const body = res.json()
      expect(body.count).toBe(2)
      expect(body.failed).toBeGreaterThanOrEqual(1)
      expect(body.results).toHaveLength(2)
      expect(body.results[1]).toMatchObject({ name: 'invalid', ok: false })
    } finally {
      await app.close()
    }
  })

  it('compiles + executes a primitive assembly and returns a compact receipt', async () => {
    const app = await buildApp()
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/projects/main/model/apply',
        payload: { source: ASSEMBLY, name: 'stack' },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.ok).toBe(true)
      expect(body.statements).toBe(6)
      expect(body.errors).toEqual([])
      expect(body.execution.status).toBe('completed')
      expect(body.qc.valid).toBe(true)
      expect(body.qc.islands).toBe(1)
      expect(typeof body.urdf.fingerprint).toBe('string')
      expect(body.urdf.fingerprint.length).toBeGreaterThan(0)
    } finally {
      await app.close()
    }
  })

  it('stacks storeys end-to-end, one merged GLB link per storey, keeping one rooted tree', async () => {
    const app = await buildApp()
    try {
      // A "storey" of `extra` walls beyond the slab + wall + column core, all fixed
      // onto the slab. Architecture ops (not primitives) so the storey really goes
      // through the baker.
      const storey = (extra: number, mode: string) => [
        'mat = material(rgba=[0.7, 0.7, 0.68, 1])',
        'slab = floor_slab(size=[8, 6], thickness=0.2)',
        'w = wall(length=8, height=3, thickness=0.2)',
        'col = column(height=3, radius=0.2, shape="square")',
        'p_slab = part(shape=slab, material=mat)',
        'p_w = part(shape=w, material=mat)',
        'p_col = part(shape=col, material=mat)',
        'j_w = joint(type="fixed", parent=p_slab, child=p_w, origin=[0, -2.9, 0.2])',
        'j_col = joint(type="fixed", parent=p_slab, child=p_col, origin=[3.5, 2.5, 0.2])',
        ...Array.from({ length: extra }, (_, i) => [
          `p_x${i} = part(shape=w, material=mat)`,
          `j_x${i} = joint(type="fixed", parent=p_slab, child=p_x${i}, origin=[0, ${i - 2}, 0.2])`,
        ]).flat(),
        `tower = storey_stack(parts=[p_slab, p_w, p_col${Array.from({ length: extra }, (_, i) => `, p_x${i}`).join('')}], ` +
          `root=p_slab, mode="${mode}", count=6, storey_height=3.2)`,
      ].join('\n')

      const apply = async (source: string) => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/projects/main/model/apply',
          payload: { source },
        })
        expect(res.statusCode).toBe(200)
        const body = res.json()
        expect(body.errors, JSON.stringify(body.errors)).toEqual([])
        expect(body.ok).toBe(true)
        return body
      }

      const merged3 = await apply(storey(0, 'merge'))
      const merged6 = await apply(storey(3, 'merge'))
      const instanced3 = await apply(storey(0, 'instance'))
      const instanced6 = await apply(storey(3, 'instance'))

      // Merge mode is the whole point: however many elements a storey has, the tower
      // is 6 links referencing one baked <sha>.glb, so the URDF does not grow at all
      // when the storey gets richer — while instance mode pays for every element on
      // every storey. (The exact link/part counts are asserted in the battery unit test.)
      expect(merged6.urdf.bytes).toBe(merged3.urdf.bytes)
      expect(instanced6.urdf.bytes).toBeGreaterThan(instanced3.urdf.bytes * 1.8)
      expect(merged6.urdf.bytes).toBeLessThan(instanced6.urdf.bytes / 2)
      // Every storey is still wired into the same root tree.
      expect(merged6.qc.valid).toBe(true)
      expect(merged6.qc.islands).toBe(1)
      expect(merged6.qc.floating_links).toBe(0)
    } finally {
      await app.close()
    }
  })

  it('model.get reconstructs an equivalent DSL (round-trip)', async () => {
    const app = await buildApp()
    try {
      await app.inject({ method: 'POST', url: '/api/v1/projects/main/model/apply', payload: { source: ASSEMBLY } })
      const got = await app.inject({ method: 'GET', url: '/api/v1/projects/main/model/get' })
      expect(got.statusCode).toBe(200)
      const source = got.json().source as string
      const reparsed = parseDSL(source)
      expect(reparsed.errors).toEqual([])
      expect(canon(reparsed.statements)).toEqual(canon(parseDSL(ASSEMBLY).statements))
    } finally {
      await app.close()
    }
  })

  it('compiles a joint + animation(keyframes=...) statement end-to-end', async () => {
    const app = await buildApp()
    try {
      const src = [
        'mat = material(rgba=[0.2, 0.2, 0.2, 1])',
        'base = box(size=[0.2, 0.2, 0.1])',
        'p_base = part(shape=base, material=mat)',
        'top = box(size=[0.1, 0.1, 0.1])',
        'p_top = part(shape=top, material=mat)',
        'j = joint(type="revolute", parent=p_base, child=p_top, axis=[0,0,1], lower=-1, upper=1, origin=[0,0,0.1])',
        'anim = animation(fps=10, keyframes="{\\"j\\":[{\\"t\\":0,\\"q\\":0},{\\"t\\":1,\\"q\\":0.5}]}")',
      ].join('\n')
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/projects/main/model/apply',
        payload: { source: src, name: 'waving-arm' },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.errors).toEqual([])
      expect(body.ok).toBe(true)
      expect(body.execution.status).toBe('completed')

      // model.get round-trips the AUTHORED form (sparse `keyframes`, not the
      // sampled-out full clip) — re-applying it re-derives the same q(t).
      const got = await app.inject({ method: 'GET', url: '/api/v1/projects/main/model/get' })
      const source = got.json().source as string
      const reparsed = parseDSL(source)
      expect(reparsed.errors).toEqual([])
      const animStmt = reparsed.statements.find((s) => s.op === 'animation')
      expect(animStmt).toBeTruthy()
      expect(animStmt!.args.keyframes?.kind).toBe('string')
      const kf = JSON.parse((animStmt!.args.keyframes as { kind: 'string'; value: string }).value)
      expect(kf.j).toEqual([{ t: 0, q: 0 }, { t: 1, q: 0.5 }])

      // Re-applying the round-tripped DSL should compile+execute cleanly too.
      const reapplied = await app.inject({
        method: 'POST',
        url: '/api/v1/projects/main/model/apply',
        payload: { source },
      })
      expect(reapplied.json().ok).toBe(true)
    } finally {
      await app.close()
    }
  })

  it('routes a joint-less mesh-ref scene through the STATIC pipeline and returns a scene receipt', async () => {
    const app = await buildApp()
    try {
      // Scene assembly = placed mesh refs, no joints → static pipeline (no URDF, no OCCT bake).
      const src = [
        'red = material(rgba=[0.8, 0.2, 0.2, 1])',
        'm1 = mesh(filename="aaa.obj", bbox_min=[0,0,0], bbox_max=[1,1,1])',
        'p1 = part(shape=m1, material=red, origin=[0, 0, 0])',
        'm2 = mesh(filename="bbb.obj", bbox_min=[0,0,0], bbox_max=[1,1,1])',
        'p2 = part(shape=m2, origin=[2, 0, 0])',
      ].join('\n')
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/projects/main/model/apply',
        payload: { source: src, name: 'street' },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.mode).toBe('static')
      expect(body.errors).toEqual([])
      expect(body.execution.status).toBe('completed')
      // static receipt carries geometry QC + a SceneSpec fingerprint, and NO urdf field
      expect(body.qc).toBeTruthy()
      expect(typeof body.scene.fingerprint).toBe('string')
      expect(body.scene.fingerprint.length).toBeGreaterThan(0)
      expect(body.scene.items).toBe(2)
      expect(body.urdf).toBeUndefined()
    } finally {
      await app.close()
    }
  })

  it('builds a jointless little house on the STATIC pipeline (place_local seats the window in the wall)', async () => {
    const app = await buildApp()
    try {
      // No joint() anywhere: the slab, the yaw-90° east wall and the roof carry absolute
      // origins, and the ONE pose that can only be stated relative to its parent — the
      // window sitting in the wall opening — goes through place_local.
      // Architecture ops put their local origin at the floor (boxFloor), so the window's
      // offset is literally the opening's [x, 0, sill] from the wall statement.
      const src = [
        'stone = material(rgba=[0.78, 0.75, 0.70, 1])',
        'trim = material(rgba=[0.35, 0.30, 0.28, 1])',
        'slab = floor_slab(size=[8, 6], thickness=0.2)',
        'p_slab = part(shape=slab, material=stone)',
        'w_e = wall(length=6, height=3, thickness=0.2, openings=[[-1, 1.2, 0.9, 2.3]])',
        'p_w_e = part(shape=w_e, material=stone, origin=[3.9, 0, 0.2], rpy=[0, 0, 1.5707963268])',
        'win = window(size=[1.2, 1.4], depth=0.2, frame=0.08)',
        'p_win = part(shape=win, material=trim)',
        'mount = place_local(parent=p_w_e, child=p_win, offset=[-1, 0, 0.9])',
        'rf = roof(footprint=[8.4, 6.4], type="gable", height=1.2)',
        'p_roof = part(shape=rf, material=stone, origin=[0, 0, 3.2])',
      ].join('\n')
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/projects/main/model/apply',
        payload: { source: src, name: 'cottage' },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.errors, JSON.stringify(body.errors)).toEqual([])
      expect(body.mode).toBe('static')
      expect(body.ok).toBe(true)
      expect(body.execution.status).toBe('completed')
      expect(body.urdf).toBeUndefined()

      // Jointless is not "unfinished": no floating-link / island complaints, and the
      // four real-shape parts come out as ONE merged multi-material GLB.
      expect(body.qc.valid).toBe(true)
      expect(body.qc.floating_links).toBe(0)
      expect(body.scene.error).toBeUndefined()
      expect(body.scene.items).toBe(1)
      expect(body.scene.fingerprint.length).toBeGreaterThan(0)

      // Proof the placement actually happened in world space: the only rest-pose AABB
      // overlap is the window inside its wall. Had place_local been a no-op the window
      // would still be at the origin, overlapping the slab instead.
      const overlaps = (body.qc.signals as Array<{ code: string; ids?: string[] }>).filter((s) => s.code === 'aabb_overlap')
      expect(overlaps).toHaveLength(1)
      expect(overlaps[0]!.ids!.slice().sort()).toEqual(['p_w_e', 'p_win'])
    } finally {
      await app.close()
    }
  })

  it('honors an explicit pipeline override on model.apply', async () => {
    const app = await buildApp()
    try {
      // A joint-less mesh-ref scene forced onto the URDF pipeline.
      const src = [
        'm1 = mesh(filename="aaa.obj", bbox_min=[0,0,0], bbox_max=[1,1,1])',
        'p1 = part(shape=m1, origin=[0, 0, 0])',
      ].join('\n')
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/projects/main/model/apply',
        payload: { source: src, pipeline: 'mechanical' },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.mode).toBe('urdf')
      expect(body.urdf).toBeTruthy()
    } finally {
      await app.close()
    }
  })

  it('maps an unknown op back to its DSL line without touching the graph', async () => {
    const app = await buildApp()
    try {
      const src = ['b = box(size=[1,1,1])', 'x = totally_unknown_op(foo=1)'].join('\n')
      const res = await app.inject({ method: 'POST', url: '/api/v1/projects/main/model/apply', payload: { source: src } })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.ok).toBe(false)
      expect(body.phase).toBe('compile')
      const unmapped = (body.errors as Array<{ line: number; kind: string; message: string }>).find(
        (e) => e.kind === 'unmapped-op',
      )
      expect(unmapped).toBeTruthy()
      expect(unmapped!.line).toBe(2)
    } finally {
      await app.close()
    }
  })

  it('parts.list is empty before any bake', async () => {
    const app = await buildApp()
    try {
      const res = await app.inject({ method: 'GET', url: '/api/v1/projects/main/parts' })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ count: 0, parts: [] })
    } finally {
      await app.close()
    }
  })

  it('merges separately-baked <sha>.obj parts into one skinnable mesh on the CHARACTER path', async () => {
    const app = await buildApp()
    try {
      // Phase 1: bake a body part on its own → reusable <sha>.obj (separate submission).
      // Use CSG shells (bare primitives are native URDF prims and refuse to bake).
      const bodyBake = await app.inject({
        method: 'POST',
        url: '/api/v1/projects/main/model/apply',
        payload: {
          source: [
            'outerB = box(size=[0.5, 0.3, 0.3])',
            'cavB = box(size=[0.4, 0.2, 0.2])',
            'body = difference(base=outerB, tool=cavB)',
          ].join('\n'),
          bake: 'body',
        },
      })
      expect(bodyBake.json().mode).toBe('bake')
      const bodyObj = bodyBake.json().baked.filename as string
      const bboxMin = bodyBake.json().baked.bbox_min as number[]
      const bboxMax = bodyBake.json().baked.bbox_max as number[]
      expect(bodyObj).toMatch(/\.obj$/)

      // Phase 1: bake a leg part separately too.
      const legBake = await app.inject({
        method: 'POST',
        url: '/api/v1/projects/main/model/apply',
        payload: {
          source: [
            'outerL = cylinder(radius=0.06, length=0.25)',
            'cavL = cylinder(radius=0.04, length=0.26)',
            'leg = difference(base=outerL, tool=cavL)',
          ].join('\n'),
          bake: 'leg',
        },
      })
      const legObj = legBake.json().baked.filename as string
      const legMin = legBake.json().baked.bbox_min as number[]
      const legMax = legBake.json().baked.bbox_max as number[]

      // Phase 2: assemble by REFERENCE (mesh refs) + hand-authored skeleton + one skin.
      // The character terminal g_bake_object must read back both <sha>.obj blobs and
      // merge them into one skinnable mesh (rig.meshFilename → <sha>.glb).
      const bb = (v: number[]): string => `[${v.join(', ')}]`
      const character = [
        `mbody = mesh(filename="${bodyObj}", bbox_min=${bb(bboxMin)}, bbox_max=${bb(bboxMax)})`,
        'p_body = part(shape=mbody)',
        `mleg = mesh(filename="${legObj}", bbox_min=${bb(legMin)}, bbox_max=${bb(legMax)})`,
        'p_leg = part(shape=mleg, origin=[0.1, 0, -0.3])',
        'b_spine = bone(origin=[0,0,0], tail=[0.25,0,0], source_part=p_body)',
        'b_leg = bone(origin=[0.1,0,-0.15], tail=[0.1,0,-0.4], parent=b_spine, source_part=p_leg)',
        'sk = skeleton(root=b_spine)',
        'sn = skin(skeleton=sk, method="auto")',
      ].join('\n')
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/projects/main/model/apply',
        payload: { source: character, name: 'critter' },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.mode).toBe('character')
      expect(body.errors).toEqual([])
      expect(body.execution.status).toBe('completed')
      expect(body.skinQc.valid).toBe(true)
      expect(body.rig.error).toBeUndefined()
      // proof the pre-baked .obj parts were merged into one skinnable mesh:
      expect(typeof body.rig.meshFilename).toBe('string')
      expect(body.rig.meshFilename).toMatch(/\.glb$/)
      expect(body.rig.boneCount).toBe(2)
    } finally {
      await app.close()
    }
  })

  it('bake mode bakes a CSG shell, registers it in parts.json, and parts.list finds it', async () => {
    const app = await buildApp()
    try {
      const src = [
        'outer = cylinder(radius=0.04, length=0.1)',
        'cavity = cylinder(radius=0.035, length=0.09)',
        'shell = difference(base=outer, tool=cavity)',
      ].join('\n')
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/projects/main/model/apply',
        payload: { source: src, bake: 'shell' },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.mode).toBe('bake')
      expect(body.ok).toBe(true)
      expect(typeof body.baked.filename).toBe('string')
      expect(body.baked.filename).toMatch(/\.obj$/)
      expect(typeof body.baked.sha256).toBe('string')
      expect(Array.isArray(body.baked.bbox_min)).toBe(true)

      const parts = await app.inject({ method: 'GET', url: '/api/v1/projects/main/parts' })
      const listed = parts.json()
      expect(listed.count).toBe(1)
      expect(listed.parts[0].name).toBe('shell')
      expect(listed.parts[0].filename).toBe(body.baked.filename)
    } finally {
      await app.close()
    }
  })

  it('bakes Architecture DSL at authored slab/window/door dimensions', async () => {
    const app = await buildApp()
    try {
      const bake = async (source: string, id: string) => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/projects/main/model/apply',
          payload: { source, bake: id },
        })
        expect(res.statusCode).toBe(200)
        const body = res.json()
        expect(body.ok, JSON.stringify(body)).toBe(true)
        return body.baked as { bbox_min: number[]; bbox_max: number[] }
      }
      const dims = (b: { bbox_min: number[]; bbox_max: number[] }) =>
        b.bbox_max.map((v, i) => v - b.bbox_min[i])

      expect(dims(await bake(
        'wall1 = wall(length=9, height=3, thickness=0.28, openings=[[1,1.8,0.9,2]])',
        'wall1',
      ))).toEqual([
        expect.closeTo(9, 5), expect.closeTo(0.28, 5), expect.closeTo(3, 5),
      ])
      expect(dims(await bake('slab = floor_slab(size=[9,7], thickness=0.35)', 'slab'))).toEqual([
        expect.closeTo(9, 5), expect.closeTo(7, 5), expect.closeTo(0.35, 5),
      ])
      expect(dims(await bake('win = window(size=[1.8,1.1], depth=0.28, frame=0.07)', 'win'))).toEqual([
        expect.closeTo(1.8, 5), expect.closeTo(0.28, 5), expect.closeTo(1.1, 5),
      ])
      expect(dims(await bake('frame1 = door_frame(size=[1.4,2.3], depth=0.28, frame=0.09)', 'frame1'))).toEqual([
        expect.closeTo(1.4, 5), expect.closeTo(0.28, 5), expect.closeTo(2.3, 5),
      ])
      const leaf = await bake('leaf1 = door_leaf(size=[1.1,2.15], thickness=0.05, hinge="left")', 'leaf1')
      expect(dims(leaf)).toEqual([
        expect.closeTo(1.1, 5), expect.closeTo(0.05, 5), expect.closeTo(2.15, 5),
      ])
      expect(leaf.bbox_min[0]).toBeCloseTo(0, 5)
    } finally {
      await app.close()
    }
  })

  it('bake mode bakes a rock primitive (mesh-backed, not an OCCT solid) into a valid OBJ', async () => {
    const app = await buildApp()
    try {
      const src = 'r1 = rock(radius=0.2, irregularity=0.4, seed=3, detail=1, stretch=[1.2, 1, 0.8])'
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/projects/main/model/apply',
        payload: { source: src, bake: 'r1' },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.mode).toBe('bake')
      expect(body.ok).toBe(true)
      expect(body.baked.error).toBeUndefined()
      expect(body.baked.filename).toMatch(/\.obj$/)
      expect(Array.isArray(body.baked.bbox_min)).toBe(true)
      expect(Array.isArray(body.baked.bbox_max)).toBe(true)

      // same params (incl. seed) → same content-addressed blob on a second bake (determinism + cache).
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/projects/main/model/apply',
        payload: { source: src, bake: 'r1' },
      })
      expect(res2.json().baked.sha256).toBe(body.baked.sha256)
    } finally {
      await app.close()
    }
  })

  it('rejects a rock inside a boolean op (mesh-backed shapes cannot participate in CSG)', async () => {
    const app = await buildApp()
    try {
      const src = [
        'r1 = rock(radius=0.2)',
        'b1 = box(size=[0.5, 0.5, 0.5])',
        'd1 = difference(base=b1, tool=r1)',
      ].join('\n')
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/projects/main/model/apply',
        payload: { source: src, bake: 'd1' },
      })
      // route always answers 200; a mesh-backed boolean misuse throws inside node execution,
      // surfacing as execution.status="error" with the baker's message (QC would also flag
      // this DSL as an advisory error pre-bake, but this test exercises the baker's own guard).
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.ok).toBe(false)
      expect(body.execution.status).toBe('error')
      expect(String(body.execution.error.message)).toMatch(/mesh-backed/i)
    } finally {
      await app.close()
    }
  })
})
