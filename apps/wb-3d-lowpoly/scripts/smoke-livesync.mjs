const PORT = process.env.PORT ?? 9567
const WS = `ws://localhost:${PORT}/ws`
const API = `http://localhost:${PORT}`

// Headless proof of the North-Star live-sync: a graph mutation POSTed to the
// running backend is forwarded over /ws as a `graph:applied` event, so the UI
// can refetch and the canvas updates live ("watch the AI work"). The backend
// must already be listening on $PORT (default 9567, matching `bun run serve`).
const received = []
const sock = new WebSocket(WS)

const result = new Promise((resolve) => {
  const timer = setTimeout(() => {
    console.error('FAIL: no graph:applied broadcast within 4s. received:', received)
    resolve(1)
  }, 4000)

  sock.onmessage = (ev) => {
    let msg
    try {
      msg = JSON.parse(String(ev.data))
    } catch {
      return
    }
    received.push(msg)
    if (msg?.event === 'runtime' && msg?.payload?.kind === 'graph:applied') {
      clearTimeout(timer)
      console.log('PASS: graph:applied broadcast received')
      resolve(0)
    }
  }

  sock.onerror = (err) => {
    clearTimeout(timer)
    console.error('FAIL: websocket error', err?.message ?? err)
    resolve(1)
  }

  sock.onopen = async () => {
    sock.send(JSON.stringify({ action: 'subscribe', channels: ['graph', 'execution'] }))
    await new Promise((r) => setTimeout(r, 300))

    // Try a trivial no-op delete first; if the kernel rejects it (the node does
    // not exist), fall back to an empty batch. Either way an `ok` batch must
    // broadcast graph:applied — that is the only assertion this test makes.
    let res = await fetch(`${API}/api/v1/batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ops: [{ type: 'deleteNode', nodeId: '__nope__' }],
        opts: { actor: 'smoke-livesync' },
      }),
    })
    let body = await res.json().catch(() => ({}))
    if (body?.status !== 'ok') {
      res = await fetch(`${API}/api/v1/batch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ops: [], opts: { actor: 'smoke-livesync' } }),
      })
      body = await res.json().catch(() => ({}))
    }
  }
})

const code = await result
sock.close()
process.exit(code)
