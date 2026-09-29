import { pluginFetch } from './pluginHttp'

const WAKE_TOOL_ID = 'scene:renderer.info'

async function backendIsUp(): Promise<boolean> {
  try {
    const response = await pluginFetch('/api/v1/projects')
    // 409 = backend is up but no active game yet.
    return response.ok || response.status === 409
  } catch {
    return false
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('aborted', 'AbortError'))
    }, { once: true })
  })
}

/**
 * `embeddedAlso: true` stops Studio from spawning `bun run dev`. Opening the
 * iframe does not import tool-handlers, so the first UI fetch would otherwise
 * miss :9557. A host tool call loads that module, which starts the backend.
 */
export async function wakeSceneBackend(timeoutMs = 60_000, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted || await backendIsUp()) return
  // Deliberately a bare fetch, NOT pluginFetch: `/api/tools/call` is Studio's own
  // tool API on the host origin. Prefixing it with the plugin base would 404.
  void fetch('/api/tools/call', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      toolId: WAKE_TOOL_ID,
      args: {},
      caller: { kind: 'user' },
    }),
    signal,
  }).catch(() => undefined)

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (signal?.aborted) return
    if (await backendIsUp()) return
    try {
      await delay(400, signal)
    } catch {
      return
    }
  }
}
