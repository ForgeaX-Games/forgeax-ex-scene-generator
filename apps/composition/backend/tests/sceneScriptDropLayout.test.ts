import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildApp } from '../src/main.js'

const workspaceRoot = mkdtempSync(join(tmpdir(), 'drop-layout-'))
process.env.FORGEAX_PROJECT_ROOT = workspaceRoot

describe('Scene Script canvas drop layout', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  let projectId: string
  let emptyProjectId: string

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
      payload: { source: 'const plane = basePlane({ origin: [0, 0], width: 12, height: 8 })\n' },
    })
    expect(authored.statusCode).toBe(200)
    const empty = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      payload: { name: 'Empty BasePlane drop' },
    })
    emptyProjectId = (empty.json() as { id: string }).id
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
    expect(afterNodes['canvas-minted']?.position).toEqual({ x: 480, y: 240 })
    for (const node of Object.values(afterNodes)) {
      if (node.opId === 'relu') continue
      expect(node.position).not.toEqual({ x: 480, y: 240 })
    }
  })

  it('keeps a dropped heightfield on a new Scene Project even when required ports are unwired', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      payload: { name: 'Drop Heightfield' },
    })
    const id = (created.json() as { id: string }).id
    const primed = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${id}/execute`,
      payload: {},
    })
    expect(primed.statusCode, primed.body).toBe(200)

    const dropped = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${id}/batch`,
      payload: {
        ops: [{
          type: 'createNode',
          nodeId: 'canvas-minted-heightfield',
          opId: 'heightfield',
          position: { x: 200, y: 160 },
          params: {},
        }],
      },
    })
    expect(dropped.statusCode, dropped.body).toBe(200)

    const source = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${id}/scene-script`,
    })
    const text = (source.json() as { source: string }).source
    expect(text).toMatch(/\/\/ @scene-id canvas-minted-heightfield/)
    expect(text).toMatch(/const field = heightfield\s*\(/)

    const pipeline = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${id}/pipeline`,
    })
    const nodes = (pipeline.json() as {
      nodes: Record<string, { opId: string; position: { x: number; y: number }; status?: string }>
    }).nodes
    expect(nodes['canvas-minted-heightfield']?.opId).toBe('heightfield')
    expect(nodes['canvas-minted-heightfield']?.position).toEqual({ x: 200, y: 160 })

    const executed = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${id}/execute`,
      payload: {},
    })
    expect(executed.statusCode, executed.body).toBe(200)
    const after = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${id}/pipeline`,
    })
    const afterNodes = (after.json() as {
      nodes: Record<string, { opId: string }>
    }).nodes
    expect(afterNodes['canvas-minted-heightfield']?.opId).toBe('heightfield')
  })

  it('writes a basePlane statement when dropped onto a new empty Scene Project', async () => {
    const before = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${emptyProjectId}/scene-script`,
    })
    expect(before.statusCode).toBe(200)
    expect((before.json() as { source: string }).source.trim()).toMatch(/^\/\/ @scene-module-id /)

    const dropped = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${emptyProjectId}/batch`,
      payload: {
        ops: [{
          type: 'createNode',
          nodeId: 'canvas-minted-plane',
          opId: 'base_plane',
          position: { x: 120, y: 80 },
          params: {},
        }],
      },
    })
    expect(dropped.statusCode, dropped.body).toBe(200)

    const source = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${emptyProjectId}/scene-script`,
    })
    expect((source.json() as { source: string }).source).toMatch(/\/\/ @scene-id canvas-minted-plane/)
    expect((source.json() as { source: string }).source).toMatch(/const world = basePlane\s*\(/)

    const pipeline = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${emptyProjectId}/pipeline`,
    })
    const nodes = (pipeline.json() as {
      nodes: Record<string, { opId: string; position: { x: number; y: number } }>
    }).nodes
    const plane = Object.values(nodes).find((node) => node.opId === 'base_plane')
    expect(plane).toBeDefined()
    expect(plane?.position).toEqual({ x: 120, y: 80 })
    expect(nodes['canvas-minted-plane']?.position).toEqual({ x: 120, y: 80 })

    const executed = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${emptyProjectId}/execute`,
      payload: {},
    })
    expect(executed.statusCode, executed.body).toBe(200)
    const planeId = Object.entries(nodes).find(([, node]) => node.opId === 'base_plane')?.[0]
    expect(planeId).toBe('canvas-minted-plane')
    const output = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${emptyProjectId}/nodes/${planeId}/outputs/geometry`,
    })
    expect(output.statusCode, output.body).toBe(200)
    const payload = JSON.stringify(output.json())
    expect(payload).toMatch(/"kind":"plane"/)
    expect(payload).toMatch(/"width":10/)
  })

  it('persists BasePlane onto the default Default Scene project', async () => {
    const ws = await app.inject({ method: 'GET', url: '/api/v1/workspace' })
    const projectId = (ws.json() as { viewingProjectId: string }).viewingProjectId
    const before = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/scene-script`,
    })
    expect(before.statusCode).toBe(200)
    expect((before.json() as { source: string }).source).toMatch(/@scene-module-id /)

    const dropped = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/batch`,
      payload: {
        ops: [{
          type: 'createNode',
          nodeId: 'default-canvas-plane',
          opId: 'base_plane',
          position: { x: 80, y: 40 },
          params: {},
        }],
      },
    })
    expect(dropped.statusCode, dropped.body).toBe(200)

    const source = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/scene-script`,
    })
    expect((source.json() as { source: string }).source).toMatch(/const world = basePlane\s*\(/)
  })

  it('removes the basePlane statement when the compiled node is deleted', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      payload: { name: 'Delete BasePlane' },
    })
    const deleteProjectId = (created.json() as { id: string }).id
    const dropped = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${deleteProjectId}/batch`,
      payload: {
        ops: [{
          type: 'createNode',
          nodeId: 'canvas-minted-delete',
          opId: 'base_plane',
          position: { x: 40, y: 20 },
          params: {},
        }],
      },
    })
    expect(dropped.statusCode, dropped.body).toBe(200)

    const pipeline = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${deleteProjectId}/pipeline`,
    })
    const nodes = (pipeline.json() as {
      nodes: Record<string, { opId: string }>
    }).nodes
    const planeId = Object.entries(nodes).find(([, node]) => node.opId === 'base_plane')?.[0]
    expect(planeId).toBe('canvas-minted-delete')

    const missing = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${deleteProjectId}/batch`,
      payload: {
        ops: [{ type: 'deleteNode', nodeId: 'never-a-node' }],
      },
    })
    expect(missing.statusCode, missing.body).toBe(422)
    expect((missing.json() as { code: string }).code).toBe('scene-authoring-entity-not-found')

    const missingEdge = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${deleteProjectId}/batch`,
      payload: {
        ops: [{ type: 'disconnect', edgeId: 'edge-already-gone' }],
      },
    })
    expect(missingEdge.statusCode, missingEdge.body).toBe(200)

    const deleted = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${deleteProjectId}/batch`,
      payload: {
        ops: [{ type: 'deleteNode', nodeId: planeId }],
      },
    })
    expect(deleted.statusCode, deleted.body).toBe(200)

    const source = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${deleteProjectId}/scene-script`,
    })
    expect((source.json() as { source: string }).source).not.toMatch(/basePlane\s*\(/)
  })

  it('writes a dropped InputNumber as a primitive const, not numberValue()', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      payload: { name: 'Drop number const' },
    })
    const id = (created.json() as { id: string }).id
    const dropped = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${id}/batch`,
      payload: {
        ops: [{
          type: 'createNode',
          nodeId: 'canvas-n',
          opId: 'number_const',
          position: { x: 40, y: 40 },
          params: { value: 10 },
        }],
      },
    })
    expect(dropped.statusCode, dropped.body).toBe(200)
    const source = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${id}/scene-script`,
    })
    expect((source.json() as { source: string }).source).toMatch(/const n = 10/)
    expect((source.json() as { source: string }).source).not.toMatch(/numberValue\s*\(/)
  })

  it('persists a slider change onto the written literal and leaves ephemeral ticks off the script', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      payload: { name: 'Slider literal' },
    })
    const id = (created.json() as { id: string }).id
    const authored = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${id}/scene-script`,
      payload: { source: 'const width = 12\nconst plane = basePlane({ width, height: 8 })\n' },
    })
    expect(authored.statusCode, authored.body).toBe(200)

    const pipeline = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${id}/pipeline`,
    })
    const namedWidth = Object.entries(
      (pipeline.json() as { nodes: Record<string, { opId: string; params?: { value?: number } }> }).nodes,
    ).find(([, node]) => node.opId === 'number_const' && node.params?.value === 12)?.[0]
    expect(namedWidth).toBeDefined()

    const live = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${id}/batch`,
      payload: {
        ops: [{ type: 'updateNode', nodeId: namedWidth, params: { value: 48 } }],
        opts: { ephemeral: true },
      },
    })
    expect(live.statusCode, live.body).toBe(200)
    const during = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${id}/scene-script`,
    })
    expect((during.json() as { source: string }).source).toMatch(/const width = 12/)

    const persist = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${id}/batch`,
      payload: {
        ops: [{ type: 'updateNode', nodeId: namedWidth, params: { value: 48 } }],
      },
    })
    expect(persist.statusCode, persist.body).toBe(200)
    const after = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${id}/scene-script`,
    })
    expect((after.json() as { source: string }).source).toMatch(/const width = 48/)
  })

  it('initializes InputNumber max to 2× value and keeps it when the script changes the value', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      payload: { name: 'Slider range' },
    })
    const id = (created.json() as { id: string }).id
    const authored = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${id}/scene-script`,
      payload: { source: 'const width = 12\nconst plane = basePlane({ width, height: 8 })\n' },
    })
    expect(authored.statusCode, authored.body).toBe(200)
    const first = await app.inject({ method: 'GET', url: `/api/v1/projects/${id}/pipeline` })
    const firstNodes = (first.json() as { nodes: Record<string, { opId: string; params?: Record<string, unknown> }> }).nodes
    const firstEntry = Object.entries(firstNodes).find(([, node]) => node.opId === 'number_const' && node.params?.value === 12)
    expect(firstEntry?.[1]?.params).toMatchObject({ value: 12, min: 0, max: 24, precision: 0 })

    const retuned = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${id}/batch`,
      payload: { ops: [{ type: 'updateNode', nodeId: firstEntry?.[0], params: { max: 99 } }] },
    })
    expect(retuned.statusCode, retuned.body).toBe(200)

    const rewritten = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${id}/scene-script`,
      payload: { source: 'const width = 8\nconst plane = basePlane({ width, height: 4 })\n' },
    })
    expect(rewritten.statusCode, rewritten.body).toBe(200)
    const second = await app.inject({ method: 'GET', url: `/api/v1/projects/${id}/pipeline` })
    const secondNodes = (second.json() as { nodes: Record<string, { opId: string; params?: Record<string, unknown> }> }).nodes
    const secondWidth = firstEntry?.[0] ? secondNodes[firstEntry[0]] : undefined
    expect(secondWidth?.params).toMatchObject({ value: 8, min: 0, max: 99, precision: 0 })
    const source = await app.inject({ method: 'GET', url: `/api/v1/projects/${id}/scene-script` })
    expect((source.json() as { source: string }).source).toMatch(/const width = 8/)
    expect((source.json() as { source: string }).source).not.toMatch(/99/)
  })

  it('persists an inline helper slider onto that argument only and keeps sibling positions', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      payload: { name: 'Inline helper slider' },
    })
    const id = (created.json() as { id: string }).id
    const authored = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${id}/scene-script`,
      payload: {
        source: [
          'const width = 12',
          'const world = basePlane({ origin: [0, 0], width, height: width })',
          'const strip = basePlane({ origin: [0, 20], width, height: 8 })',
          '',
        ].join('\n'),
      },
    })
    expect(authored.statusCode, authored.body).toBe(200)

    const pipeline = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${id}/pipeline`,
    })
    const nodes = (pipeline.json() as {
      nodes: Record<string, { opId: string; position: { x: number; y: number }; params?: Record<string, unknown> }>
    }).nodes
    const heightHelper = Object.entries(nodes).find(([, node]) =>
      node.opId === 'number_const' && node.params?.value === 8)
    expect(heightHelper).toBeDefined()
    const siblingPositions = Object.fromEntries(
      Object.entries(nodes)
        .filter(([nodeId]) => nodeId !== heightHelper?.[0])
        .map(([nodeId, node]) => [nodeId, node.position]),
    )

    const persist = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${id}/batch`,
      payload: {
        ops: [{
          type: 'updateNode',
          nodeId: heightHelper?.[0],
          params: {
            value: 3,
            min: 0,
            max: 16,
            precision: 0,
            __sceneScriptFunctionName: 'numberValue',
          },
        }],
      },
    })
    expect(persist.statusCode, persist.body).toBe(200)
    const persistBody = persist.json() as {
      importMode?: string
      invalidatedNodeCount?: number
      changedOperationCount?: number
    }
    const nodeCount = Object.keys(nodes).length
    expect(persistBody.importMode).toBe('incremental')
    expect(persistBody.changedOperationCount ?? nodeCount).toBeLessThan(nodeCount)
    expect(persistBody.invalidatedNodeCount ?? nodeCount).toBeLessThan(nodeCount)

    const after = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${id}/scene-script`,
    })
    const source = (after.json() as { source: string }).source
    expect(source).toMatch(/height:\s*3/)
    expect(source).toMatch(/const width = 12/)
    expect(source).not.toMatch(/numberValue/)
    expect(source).not.toMatch(/__sceneScriptFunctionName/)
    expect(source).not.toMatch(/\bmin:\s*0/)
    expect(source).not.toMatch(/\bmax:\s*16/)
    expect(source).not.toMatch(/\bvalue:\s*3/)

    const afterPipeline = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${id}/pipeline`,
    })
    const afterNodes = (afterPipeline.json() as {
      nodes: Record<string, { opId: string; position: { x: number; y: number }; params?: Record<string, unknown> }>
    }).nodes
    for (const [nodeId, position] of Object.entries(siblingPositions)) {
      expect(afterNodes[nodeId]?.position, nodeId).toEqual(position)
    }
    for (const node of Object.values(afterNodes)) {
      if (node.opId !== 'base_plane') continue
      expect(node.params).not.toHaveProperty('value')
      expect(node.params).not.toHaveProperty('min')
      expect(node.params).not.toHaveProperty('max')
    }

    const executed = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${id}/execute`,
      payload: {},
    })
    expect(executed.statusCode, executed.body).toBe(200)
  })

  it('strips leaked slider chrome off a parent call on the next persist', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      payload: { name: 'Strip leaked chrome' },
    })
    const id = (created.json() as { id: string }).id
    const authored = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${id}/scene-script`,
      payload: {
        source: [
          'const strip = basePlane({',
          '  origin: [0, 20],',
          '  width: 12,',
          '  height: 8,',
          '  value: 0,',
          '  min: 0,',
          '  max: 16,',
          '  precision: 0,',
          '  __sceneScriptFunctionName: "numberValue",',
          '})',
          '',
        ].join('\n'),
      },
    })
    expect(authored.statusCode, authored.body).toBe(200)
    const pipeline = await app.inject({ method: 'GET', url: `/api/v1/projects/${id}/pipeline` })
    const helper = Object.entries(
      (pipeline.json() as { nodes: Record<string, { opId: string; params?: { value?: number } }> }).nodes,
    ).find(([, node]) => node.opId === 'number_const' && node.params?.value === 8)?.[0]
    expect(helper).toBeDefined()

    const persist = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${id}/batch`,
      payload: {
        ops: [{
          type: 'updateNode',
          nodeId: helper,
          params: { value: 5, min: 0, max: 16, precision: 0, __sceneScriptFunctionName: 'numberValue' },
        }],
      },
    })
    expect(persist.statusCode, persist.body).toBe(200)
    const source = ((await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${id}/scene-script`,
    })).json() as { source: string }).source
    expect(source).toMatch(/height:\s*5/)
    expect(source).not.toMatch(/numberValue/)
    expect(source).not.toMatch(/\bmin:/)
    expect(source).not.toMatch(/\bmax:/)
    expect(source).not.toMatch(/\bvalue:/)
  })

  it('connects a Grid to heightfield.height without minting n=0', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      payload: { name: 'Heightfield grid connect' },
    })
    const id = (created.json() as { id: string }).id
    const authored = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${id}/scene-script`,
      payload: {
        source: [
          "import { heightfield, gridMul, basePlane } from '@forgeax/scene'",
          '// @scene-id world',
          'const world = basePlane({})',
          '// @scene-id product',
          'const product = gridMul({ a: [[1, 2], [3, 4]], value: 3 })',
          '// @scene-id field',
          'const field = heightfield({ geometry: world.geometry, height: 0 })',
          '',
        ].join('\n'),
      },
    })
    expect(authored.statusCode, authored.body).toBe(200)

    const pipeline = await app.inject({ method: 'GET', url: `/api/v1/projects/${id}/pipeline` })
    const snap = pipeline.json() as {
      edges: Record<string, { id?: string; target: { nodeId: string; port: string } }> | Array<{ id: string; target: { nodeId: string; port: string } }>
    }
    const edgeEntries = Array.isArray(snap.edges)
      ? snap.edges.map((edge) => [edge.id, edge] as const)
      : Object.entries(snap.edges)
    const heightEdge = edgeEntries.find(([, edge]) => edge.target.nodeId === 'field' && edge.target.port === 'height')
    expect(heightEdge).toBeDefined()

    const connected = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${id}/batch`,
      payload: {
        ops: [
          {
            type: 'connect',
            source: { nodeId: 'product', port: 'grid' },
            target: { nodeId: 'field', port: 'height' },
          },
          { type: 'disconnect', edgeId: heightEdge![0] },
        ],
      },
    })
    expect(connected.statusCode, connected.body).toBe(200)

    const source = ((await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${id}/scene-script`,
    })).json() as { source: string }).source
    expect(source).toContain('height: product')
    expect(source).not.toContain('product.grid')
    expect(source).not.toMatch(/height:\s*0/)
    expect(source).not.toMatch(/const n\s*=\s*0/)

    const after = await app.inject({ method: 'GET', url: `/api/v1/projects/${id}/pipeline` })
    const afterNodes = (after.json() as {
      nodes: Record<string, { opId: string; params?: { value?: number } }>
    }).nodes
    expect(Object.values(afterNodes).some((node) => node.opId === 'number_const' && node.params?.value === 0)).toBe(false)
  })
})
