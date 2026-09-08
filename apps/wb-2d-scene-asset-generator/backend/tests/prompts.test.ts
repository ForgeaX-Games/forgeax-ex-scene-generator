import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildApp } from '../src/main.js'
import { promptTemplate } from '../../batteries/prompt/saved/prompt_template/index.js'

let app: Awaited<ReturnType<typeof buildApp>>
let projectRoot: string
beforeAll(async () => {
  projectRoot = mkdtempSync(join(tmpdir(), 'wb-asset2d-prompts-'))
  process.env.FORGEAX_PROJECT_ROOT = projectRoot
  app = await buildApp()
})
afterAll(async () => {
  await app.close()
  rmSync(projectRoot, { recursive: true, force: true })
})

describe('prompt op discovery', () => {
  it('GET /api/v1/ops exposes prompt_template with a single `prompt` output', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/ops' })
    expect(r.statusCode).toBe(200)
    const op = (r.json() as Array<{ id: string; outputs: Array<{ name: string }> }>).find(
      (o) => o.id === 'prompt_template',
    )
    expect(op).toBeTruthy()
    expect(op?.outputs.map((o) => o.name)).toEqual(['prompt'])
  })
})

describe('prompt routes', () => {
  it('create parses [xxx] vars + defaults tag, then lists and deletes', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/prompts',
      payload: { name: 'My Prompt', template: 'A [style] sprite of [subject], [style] again' },
    })
    expect(create.statusCode).toBe(200)
    const created = create.json() as { id: string; name: string; tag: string; vars: string[]; builtin: boolean }
    expect(created.name).toBe('My Prompt')
    expect(created.tag).toBe('saved')
    expect(created.vars).toEqual(['style', 'subject']) // ordered + de-duplicated
    expect(created.builtin).toBe(false)

    const withTag = await app.inject({
      method: 'POST',
      url: '/api/v1/prompts',
      payload: { name: 'Tagged', tag: 'sprites', template: 'hi [name]' },
    })
    expect((withTag.json() as { tag: string }).tag).toBe('sprites')

    const list = await app.inject({ method: 'GET', url: '/api/v1/prompts' })
    const entries = list.json().prompts as Array<{ id: string; builtin: boolean; iconSvg?: string }>
    const ids = entries.map((p) => p.id)
    expect(ids).toContain(created.id)

    // Preset vs user prompts carry distinct palette icons (no ⚡ fallback).
    const userIcon = entries.find((p) => p.id === created.id)?.iconSvg
    const presetIcon = entries.find((p) => p.builtin)?.iconSvg
    expect(userIcon).toBeTruthy()
    expect(presetIcon).toBeTruthy()
    expect(userIcon).not.toBe(presetIcon)

    const del = await app.inject({ method: 'DELETE', url: `/api/v1/prompts/${created.id}` })
    expect(del.statusCode).toBe(200)
    const list2 = await app.inject({ method: 'GET', url: '/api/v1/prompts' })
    expect((list2.json().prompts as Array<{ id: string }>).map((p) => p.id)).not.toContain(created.id)
  })

  it('rejects an empty template', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/prompts', payload: { template: '   ' } })
    expect(r.statusCode).toBe(400)
  })
})

describe('promptTemplate substitution', () => {
  it('substitutes connected vars (wire-form) and keeps unconnected placeholders', () => {
    const out = promptTemplate({
      template: 'A [style] sprite of [subject]',
      // Connected input arrives as toJSON wire entries; subject is unconnected.
      style: [{ path: [0], items: ['pixel-art'] }],
    })
    expect(out.prompt).toBe('A pixel-art sprite of [subject]')
  })

  it('coerces raw scalar inputs', () => {
    const out = promptTemplate({ template: '[a]+[b]', a: 1, b: true })
    expect(out.prompt).toBe('1+true')
  })
})
