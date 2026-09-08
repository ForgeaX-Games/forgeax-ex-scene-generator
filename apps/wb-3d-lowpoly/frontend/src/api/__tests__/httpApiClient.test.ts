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

describe('HttpApiClient (3d) — single-source graph:applied', () => {
  it('applyBatch POSTs ops to the viewing project batch route and does NOT synthesize a local graph event', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/v1/workspace') {
        return new Response(JSON.stringify({ viewingProjectId: 'main', recentProjectIds: ['main'], lastOpenedAt: '' }), { status: 200 })
      }
      return new Response(JSON.stringify({ status: 'ok', batchId: 'b1' }), { status: 200 })
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

  it('forwards a WS runtime graph:applied frame to graph listeners', () => {
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

  it('updates the internal viewing project from a WS project:viewing frame before dispatch', async () => {
    const fetchMock = vi.fn(async () => new Response('null', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket)
    const c = new HttpApiClient({ baseUrl: 'http://localhost:9999', pipelineId: 'main' })
    c.syncViewingProjectId('A')
    c.subscribe('graph', () => {}) // opens the (fake) socket
    const sock = FakeWebSocket.last
    // A cross-client switch to project B: the client must adopt B's prefix so
    // the kernel's loadPipeline() (fired on this same frame) hits the new project.
    sock!.onmessage?.({
      data: JSON.stringify({
        event: 'runtime',
        payload: { kind: 'project:viewing', projectId: 'B', pipelineId: 'main', newHash: 'h' },
      }),
    })
    await c.getPipeline()
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:9999/api/v1/projects/B/pipeline', expect.objectContaining({ method: 'GET' }))
    c.dispose()
  })
})
