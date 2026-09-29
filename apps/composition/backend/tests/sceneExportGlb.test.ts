import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/main.js'
import { tools } from '../src/tool-handlers.js'

describe('scene export glb integration', () => {
  let app: FastifyInstance
  let backendUrl: string
  let createdProjectId: string | undefined

  beforeAll(async () => {
    app = await buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const address = app.server.address()
    const port = typeof address === 'object' && address ? address.port : 9557
    backendUrl = `http://127.0.0.1:${port}`
  })

  afterAll(async () => {
    if (createdProjectId) {
      await app.inject({
        method: 'DELETE',
        url: `/api/v1/projects/${createdProjectId}`,
      })
    }
    await app.close()
  })

  it('exports scene mesh to standard glTF 2.0 .glb in game assets directory', async () => {
    // 1. Create a scene project
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      payload: { name: 'Zhangjiajie Terrain' },
    })
    expect(createRes.statusCode).toBe(201)
    const projectId = (createRes.json() as { id: string }).id
    createdProjectId = projectId

    // 2. Commit a complete scene script with generator + heightfield + hung mesh + sceneOutput
    const generatorCode = `
import { defineGenerator } from '@forgeax/project-generator'

export const mountainGen = defineGenerator({
  inputs: { width: 'number', height: 'number' },
  outputs: { heightGrid: 'grid' },
  run(ctx, args) {
    const grid: number[][] = []
    for (let r = 0; r < args.height; r++) {
      grid[r] = []
      for (let c = 0; c < args.width; c++) {
        grid[r][c] = 10 + Math.sin(r * 0.2) * 5 + Math.cos(c * 0.2) * 5
      }
    }
    return { heightGrid: grid }
  }
})
`

    const sceneScript = `
import { addChild, basePlane, emptyScene, heightfield, sceneNode, sceneOutput } from '@forgeax/scene'
import { mountainGen } from './generators/mountain.generator.ts'

export const world = basePlane({ width: 100, height: 100 })
export const terrain = mountainGen({ width: 20, height: 20 })
const field = heightfield({ geometry: world, height: terrain.heightGrid })
const groundNode = sceneNode({
  name: 'zhangjiajie-ground',
  geometry: { kind: 'mesh', positions: [0, 0, 0, 10, 0, 0, 0, 10, 5], indices: [0, 1, 2] },
})
void field
sceneOutput({ scene: addChild({ scene: emptyScene(), nodes: [groundNode.scene] }).scene })
`

    const commitRes = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/scene-script/commit`,
      payload: {
        files: [
          { file: 'generators/mountain.generator.ts', source: generatorCode },
          { file: 'main.scene.ts', source: sceneScript },
        ],
        entryFile: 'main.scene.ts',
      },
    })
    expect(commitRes.statusCode).toBe(200)
    expect(commitRes.json().ok).toBe(true)

    // 3. Call tool handler scene:export.glb
    const toolCtx = {
      caller: { kind: 'ai' as const },
      cwd: process.cwd(),
      env: {
        FORGEAX_SCENE_BACKEND_URL: backendUrl,
      },
    }

    const exportResult = await (tools['scene:export.glb'] as any)({
      projectId,
      name: 'zhangjiajie-peaks',
      gameSlug: 'multi-region',
    }, toolCtx)

    expect(exportResult.ok).toBe(true)
    expect(exportResult.name).toBe('zhangjiajie-peaks')
    expect(exportResult.filename).toBe('zhangjiajie-peaks.glb')
    expect(exportResult.triangleCount).toBeGreaterThan(0)
    expect(exportResult.bytes).toBeGreaterThan(100)
    expect(exportResult.nodes).toContain('zhangjiajie-ground')

    // 4. Verify file on disk
    expect(existsSync(exportResult.path)).toBe(true)
    const fileBytes = readFileSync(exportResult.path)
    expect(fileBytes.length).toBe(exportResult.bytes)

    // Verify glTF 2.0 binary header
    expect(fileBytes.readUInt32LE(0)).toBe(0x46546c67) // 'glTF'
    expect(fileBytes.readUInt32LE(4)).toBe(2)          // version 2

    // Clean up exported test file
    if (existsSync(exportResult.path)) {
      rmSync(exportResult.path, { force: true })
    }
  })

  it('rejects export if project produces no 3D meshes', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      payload: { name: 'Empty Scene' },
    })
    const emptyProjId = (createRes.json() as { id: string }).id

    const exportRes = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${emptyProjId}/export/glb`,
      payload: { name: 'empty' },
    })

    expect(exportRes.statusCode).toBe(400)
    expect(exportRes.json().error).toMatch(/No 3D meshes found/)

    await app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${emptyProjId}`,
    })
  })
})
