import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { buildApp } from '../src/main.js'
import { applyBatch } from '@forgeax/node-runtime'
import { getRuntimeForProject } from '../src/runtime.js'

let app: Awaited<ReturnType<typeof buildApp>>
let projectRoot: string

async function mainProjectId(): Promise<string> {
  const ws = await app.inject({ method: 'GET', url: '/api/v1/workspace' })
  return ws.json().viewingProjectId as string
}

async function projectBase(): Promise<string> {
  return `/api/v1/projects/${await mainProjectId()}`
}

beforeAll(async () => {
  projectRoot = mkdtempSync(join(tmpdir(), 'wb-scene-test-'))
  process.env.FORGEAX_PROJECT_ROOT = projectRoot
  app = await buildApp()
})
afterAll(async () => {
  await app.close()
  rmSync(projectRoot, { recursive: true, force: true })
})

describe('bridge REST', () => {
  it('GET /health → ok', async () => {
    const r = await app.inject({ method: 'GET', url: '/health' })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ status: 'ok' })
  })
  it('GET /api/v1/ops → includes common relu category', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/ops' })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toContainEqual(expect.objectContaining({
      id: 'relu',
      category: 'common/number',
      type: 'common',
    }))
  })

  it('GET /api/v1/ops → preserves add_child list access metadata', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/ops' })
    expect(r.statusCode).toBe(200)
    const addChild = (r.json() as Array<{
      id: string
      inputs: Array<{ name: string; type: string; access?: string }>
      outputs: Array<{ name: string; type: string; access?: string }>
    }>).find((op) => op.id === 'add_child')

    expect(addChild?.inputs.find((p) => p.name === 'nodes')).toMatchObject({
      type: 'scene',
      access: 'list',
    })
    expect(addChild?.outputs.find((p) => p.name === 'childPaths')).toMatchObject({
      type: 'string',
      access: 'list',
    })
  })

  it('rejects direct Runtime Graph authoring for a noncanonical project', async () => {
    const base = await projectBase()
    const ops = [{ type: 'createNode', nodeId: 'n1', opId: 'relu', position: { x: 0, y: 0 }, params: { value: 5 } }]
    const post = await app.inject({ method: 'POST', url: `${base}/batch`, payload: { ops } })
    expect(post.statusCode).toBe(409)
    expect(post.json()).toEqual(expect.objectContaining({ code: 'scene-lift-required' }))
  })

  it('rejects direct Runtime Graph mutation by AI for a canonical Scene Project', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      payload: { type: 'scene', name: 'Canonical AI batch rejection' },
    })
    expect(created.statusCode).toBeLessThan(300)
    const projectId = created.json().id as string
    const source = 'const value = numberValue({ value: 1 })\nconst root = emptyScene({})\nsceneOutput({ scene: root.scene })\n'
    const committed = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${projectId}/scene-script`,
      payload: { source },
    })
    expect(committed.statusCode).toBe(200)
    const canonicalSource = committed.json().canonicalSource as string

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/batch`,
      headers: {
        'x-forgeax-caller-kind': 'ai',
        'x-forgeax-caller-agent-id': 'canonical-batch-test',
        'x-forgeax-caller-session-id': 'canonical-batch-session',
      },
      payload: {
        ops: [{ type: 'updateNode', nodeId: 'forbidden', params: { value: 2 } }],
      },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual(expect.objectContaining({ code: 'scene-script-is-canonical' }))

    const after = await app.inject({ method: 'GET', url: `/api/v1/projects/${projectId}/scene-script` })
    expect(after.json().source).toBe(canonicalSource)
  })
})

describe('execute', () => {
  it('POST project-scoped execute runs the pipeline and reports completed', async () => {
    const base = await projectBase()
    await applyBatch(await getRuntimeForProject(await mainProjectId()), [
      { type: 'createNode', nodeId: 'e1', opId: 'relu', position: { x: 0, y: 0 }, params: { value: 7 } },
    ], { actor: 'test-runtime-fixture' })
    const r = await app.inject({ method: 'POST', url: `${base}/execute`, payload: {} })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ status: 'completed' })
  })

  it('POST /api/v1/execute for an unknown nodeId returns a structured error, not a bare 500', async () => {
    // Regression: dragging a saved group onto the canvas fired its execute in the
    // same tick as the still-in-flight createGroup persist (useCanvasDrop), so the
    // group node did not exist in the kernel yet and buildExecutionClosure threw
    // "target node not found". With logger:false the throw surfaced as an opaque
    // HTTP 500. The kernel now resolves an unknown / cyclic target as a structured
    // ExecutionResult error instead of rejecting.
    const base = await projectBase()
    const r = await app.inject({
      method: 'POST',
      url: `${base}/execute`,
      payload: { nodeId: 'node-that-does-not-exist' },
    })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({
      status: 'error',
      error: { nodeId: 'node-that-does-not-exist' },
    })
    expect((r.json() as { error: { message: string } }).error.message).toMatch(/not found/)
  })
})

describe('ws', () => {
  it('forwards runtime events after subscribe', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' })
    const addr = app.server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    const { WebSocket } = await import('ws')
    const received: unknown[] = []
    const sock = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    await new Promise<void>((res) => sock.on('open', () => res()))
    sock.on('message', (d: Buffer) => received.push(JSON.parse(d.toString())))
    sock.send(JSON.stringify({ action: 'subscribe', channels: ['graph', 'execution'] }))
    await delay(50)
    // applyBatch emits no event to subscribers, but executeNode emits exec:* on
    // the execution channel — so trigger a run and observe a real forwarded event.
    const base = await projectBase()
    await applyBatch(await getRuntimeForProject(await mainProjectId()), [
      { type: 'createNode', nodeId: 'wsN', opId: 'relu', position: { x: 0, y: 0 }, params: { value: 1 } },
    ], { actor: 'test-runtime-fixture' })
    await app.inject({ method: 'POST', url: `${base}/execute`, payload: {} })
    await delay(100)
    sock.close()
    expect(received.length).toBeGreaterThan(0)
    expect(received).toContainEqual(
      expect.objectContaining({
        event: 'runtime',
        payload: expect.objectContaining({ kind: 'exec:completed' }),
      }),
    )
  })
})
