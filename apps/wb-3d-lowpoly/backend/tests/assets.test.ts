import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/main.js'
import { resetRuntimeForTests } from '../src/runtime.js'

let root: string

beforeEach(() => {
  root = join(tmpdir(), `wb3d-assets-${process.pid}-${Date.now()}`)
  process.env.FORGEAX_PROJECT_ROOT = root
})

afterEach(() => {
  resetRuntimeForTests()
  rmSync(root, { recursive: true, force: true })
  delete process.env.FORGEAX_PROJECT_ROOT
})

describe('asset routes', () => {
  it('lists model assets under the active lowpoly project asset root', async () => {
    mkdirSync(join(root, 'assets', 'models'), { recursive: true })
    writeFileSync(join(root, 'assets', 'models', 'fox.glb'), 'glb')

    const app = await buildApp()
    try {
      const res = await app.inject({ method: 'GET', url: '/api/v1/assets?type=models&suffix=.glb' })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({
        items: [
          expect.objectContaining({
            type: 'models',
            relPath: 'models/fox.glb',
            size: 3,
          }),
        ],
      })
    } finally {
      await app.close()
    }
  })
})
