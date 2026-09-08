import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildApp } from '../src/main.js'

let app: Awaited<ReturnType<typeof buildApp>>
let projectRoot: string
beforeAll(async () => {
  projectRoot = mkdtempSync(join(tmpdir(), 'wb-asset2d-templates-'))
  process.env.FORGEAX_PROJECT_ROOT = projectRoot
  app = await buildApp()
})
afterAll(async () => {
  await app.close()
  rmSync(projectRoot, { recursive: true, force: true })
})

interface ListItem {
  id: string
  category: string
  builtin?: boolean
}

const group = {
  id: 'user-tmpl-1',
  name: 'My Template',
  nodes: {},
  edges: [],
  inputs: [],
  outputs: [],
}

describe('group-templates: user template save + delete', () => {
  it('user templates are builtin:false and presets are builtin:true', async () => {
    const save = await app.inject({
      method: 'POST',
      url: '/api/v1/group-templates/save-user',
      payload: { group, smallTag: 'misc', templateName: 'My Template' },
    })
    expect(save.statusCode).toBe(200)

    const list = await app.inject({ method: 'GET', url: '/api/v1/group-templates' })
    const items = list.json() as ListItem[]
    const mine = items.find((i) => i.id === 'user-tmpl-1')
    expect(mine).toBeTruthy()
    expect(mine?.builtin).toBe(false)
    expect(mine?.category).toBe('My templates')
    // Any preset (builtin) template/group, when present, must be read-only.
    expect(items.every((i) => i.builtin !== false || i.id === 'user-tmpl-1' || i.category === 'My templates')).toBe(true)
  })

  it('deletes a user template by id and it disappears from the list', async () => {
    const del = await app.inject({ method: 'DELETE', url: '/api/v1/group-templates/user/user-tmpl-1' })
    expect(del.statusCode).toBe(200)
    expect((del.json() as { ok: boolean }).ok).toBe(true)

    const list = await app.inject({ method: 'GET', url: '/api/v1/group-templates' })
    const ids = (list.json() as ListItem[]).map((i) => i.id)
    expect(ids).not.toContain('user-tmpl-1')
  })

  it('404s when deleting a non-user (missing/preset) template', async () => {
    const del = await app.inject({ method: 'DELETE', url: '/api/v1/group-templates/user/does-not-exist' })
    expect(del.statusCode).toBe(404)
  })
})

interface InstantiateResult {
  status?: string
  groupId?: string
  name?: string
  exposedInputs?: Array<{ portName: string; portType?: string }>
  exposedOutputs?: Array<{ portName: string; portType?: string }>
  opCount?: number
  error?: string
}

describe('group-templates: instantiate (one-shot template materialisation)', () => {
  it('instantiates the built-in dechouse_gen template as one group node with exposed in_N/out_N ports', async () => {
    // The dechouse_gen template ships under batteries/templates/2D/ and is the
    // packaged Scene→2D building-texture pipeline. Instantiating by file basename
    // must materialise it as ONE group node — no hand-wired chain.
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/group-templates/dechouse_gen/instantiate',
      payload: { position: { x: 100, y: 100 } },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as InstantiateResult
    expect(body.status).toBe('ok')
    expect(typeof body.groupId).toBe('string')
    expect(body.groupId).toBeTruthy()
    // The Scene→2D contract ports must survive instantiation verbatim.
    const inNames = (body.exposedInputs ?? []).map((p) => p.portName)
    const outNames = (body.exposedOutputs ?? []).map((p) => p.portName)
    expect(inNames).toContain('in_0')
    expect(outNames).toContain('out_3')
    expect(outNames).toContain('out_4')
    expect((body.opCount ?? 0)).toBeGreaterThan(0)

    // The materialised group node is now present in the live graph.
    const nodes = await app.inject({ method: 'GET', url: '/api/v1/projects/main/nodes' })
    expect((nodes.json() as Array<{ id: string }>).some((n) => n.id === body.groupId)).toBe(true)
  })

  it('404s when instantiating a template that does not exist', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/group-templates/does-not-exist/instantiate',
      payload: {},
    })
    expect(res.statusCode).toBe(404)
  })
})
