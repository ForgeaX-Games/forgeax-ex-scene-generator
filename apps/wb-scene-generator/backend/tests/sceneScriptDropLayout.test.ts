import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildApp } from '../src/main.js'

const workspaceRoot = mkdtempSync(join(tmpdir(), 'wb-drop-layout-'))
process.env.FORGEAX_PROJECT_ROOT = workspaceRoot

describe('Scene Script canvas drop layout', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  let projectId: string

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      payload: { name: 'Drop layout' },
    })
    projectId = (created.json() as { id: string }).id
    const authored = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${projectId}/scene-script`,
      payload: { source: 'const root = emptyScene({})\nsceneOutput({ scene: root })\n' },
    })
    expect(authored.statusCode).toBe(200)
  })

  afterAll(async () => {
    await app.close()
    rmSync(workspaceRoot, { recursive: true, force: true })
  })

  it('keeps a dropped battery at the canvas drop position after compile rewrite', async () => {
    const dropped = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/batch`,
      payload: {
        ops: [{
          type: 'createNode',
          nodeId: 'canvas-minted',
          opId: 'relu',
          position: { x: 480, y: 240 },
          params: { value: 1 },
        }],
      },
    })
    expect(dropped.statusCode, dropped.body).toBe(200)

    const after = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/pipeline`,
    })
    const afterNodes = (after.json() as {
      nodes: Record<string, { opId: string; position: { x: number; y: number } }>
    }).nodes
    const relu = Object.values(afterNodes).find((node) => node.opId === 'relu')
    expect(relu?.position).toEqual({ x: 480, y: 240 })
    expect(afterNodes['canvas-minted']).toBeUndefined()
    for (const node of Object.values(afterNodes)) {
      if (node.opId === 'relu') continue
      expect(node.position).not.toEqual({ x: 480, y: 240 })
    }
  })
})
