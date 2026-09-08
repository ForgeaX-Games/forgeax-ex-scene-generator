import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/main.js'
import { resetRuntimeForTests } from '../src/runtime.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'wb3d-projects-'))
  process.env.FORGEAX_PROJECT_ROOT = root
})

afterEach(() => {
  resetRuntimeForTests()
  rmSync(root, { recursive: true, force: true })
  delete process.env.FORGEAX_PROJECT_ROOT
})

describe('projects/import routes', () => {
  it('exposes lowpoly projects and import template endpoints', async () => {
    const app = await buildApp()
    try {
      const projects = await app.inject({ method: 'GET', url: '/api/v1/projects' })
      expect(projects.statusCode).toBe(200)
      expect(projects.json()).toEqual([
        expect.objectContaining({ id: 'main', type: 'lowpoly', name: 'Default Lowpoly' }),
      ])

      const workspace = await app.inject({ method: 'GET', url: '/api/v1/workspace' })
      expect(workspace.statusCode).toBe(200)
      expect(workspace.json()).toEqual(expect.objectContaining({ viewingProjectId: 'main' }))

      const templates = await app.inject({ method: 'GET', url: '/api/v1/projects/main/pipeline/templates' })
      expect(templates.statusCode).toBe(200)
      expect(templates.json()).toEqual([])
    } finally {
      await app.close()
    }
  })
})
