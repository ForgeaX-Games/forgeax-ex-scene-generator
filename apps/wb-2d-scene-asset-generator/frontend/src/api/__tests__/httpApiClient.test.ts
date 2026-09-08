import { describe, it, expect, vi } from 'vitest'
import { HttpApiClient } from '../HttpApiClient'

// Minimal WebSocket stand-in so we can drive the client's onmessage path (the
// single source of graph reactivity) without a real server.
class FakeWebSocket {
  static last: FakeWebSocket | null = null
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  sent: string[] = []
  constructor(public url: string) {
    FakeWebSocket.last = this
  }
  send(d: string): void {
    this.sent.push(d)
  }
  close(): void {
    this.onclose?.()
  }
}

describe('HttpApiClient', () => {
  it('listOps GETs /api/v1/ops and returns the array', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([{ id: 'relu', inputs: [], outputs: [] }]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const c = new HttpApiClient({ baseUrl: '', pipelineId: 'main' })
    const ops = await c.listOps()
    expect(ops[0].id).toBe('relu')
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/ops', expect.anything())
  })
  it('applyBatch POSTs ops to the viewing project batch route and does NOT synthesize a graph event', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/v1/workspace') {
        return new Response(JSON.stringify({ viewingProjectId: 'main', recentProjectIds: ['main'], lastOpenedAt: '' }), { status: 200 })
      }
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const c = new HttpApiClient({ baseUrl: '', pipelineId: 'main' })
    await c.getWorkspace()
    const graphEvents: unknown[] = []
    c.subscribe('graph', (e) => graphEvents.push(e))
    const r = await c.applyBatch([{ type: 'createNode', nodeId: 'n', opId: 'relu', position: { x: 0, y: 0 }, params: {} }] as never)
    expect(r.status).toBe('ok')
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/projects/main/batch', expect.objectContaining({ method: 'POST' }))
    expect(graphEvents.length).toBe(0)
  })
  it('forwards a WS runtime graph:applied frame to graph listeners (single source)', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('null', { status: 200 })))
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket)
    const c = new HttpApiClient({ baseUrl: 'http://localhost:9999', pipelineId: 'main' })
    const graphEvents: unknown[] = []
    c.subscribe('graph', (e) => graphEvents.push(e)) // opens the (fake) socket
    const sock = FakeWebSocket.last
    expect(sock).toBeTruthy()
    sock!.onmessage?.({
      data: JSON.stringify({
        event: 'runtime',
        payload: { kind: 'graph:applied', pipelineId: 'main', batchId: 'b1', newHash: 'h1' },
      }),
    })
    expect(graphEvents.length).toBe(1)
    expect((graphEvents[0] as { batchId: string }).batchId).toBe('b1')
    c.dispose()
  })
  it('execute({}) POSTs to the viewing project execute route and returns the parsed ExecutionResult', async () => {
    const result = {
      executionId: 'e1',
      status: 'completed',
      outputs: {},
      durationMs: 5,
    }
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/v1/workspace') {
        return new Response(JSON.stringify({ viewingProjectId: 'main', recentProjectIds: ['main'], lastOpenedAt: '' }), { status: 200 })
      }
      return new Response(JSON.stringify(result), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const c = new HttpApiClient({ baseUrl: '', pipelineId: 'main' })
    await c.getWorkspace()
    const r = await c.execute({})
    expect(r.executionId).toBe('e1')
    expect(r.status).toBe('completed')
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/projects/main/execute', expect.objectContaining({ method: 'POST' }))
  })
})
