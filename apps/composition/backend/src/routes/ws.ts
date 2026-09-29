import type { FastifyInstance } from 'fastify'
import type { RuntimeChannel, RuntimeEvent } from '@forgeax/node-runtime'
import { getProjectRegistry, getRuntimeForProject } from '../runtime.js'
import { isCanvasPerfVerbose, logWsRuntimeEvent } from '../lib/canvasPerfDebug.js'

interface Socketish {
  send: (data: string) => void
}

interface ClientEntry {
  socket: Socketish
  channels: RuntimeChannel[] | null
  unsubs: Array<() => void>
}

const clients = new Map<Socketish, ClientEntry>()

export function broadcastToClients(msg: unknown): number {
  const data = JSON.stringify(msg)
  let n = 0
  for (const entry of clients.values()) {
    try {
      entry.socket.send(data)
      n++
    } catch {
      /* drop */
    }
  }
  return n
}

async function subscribedProjectIds(): Promise<string[]> {
  const reg = await getProjectRegistry()
  const ids = new Set<string>()
  const viewing = reg.getViewingProjectId()
  if (viewing) ids.add(viewing)
  for (const id of reg.listLockedProjectIds()) ids.add(id)
  return [...ids]
}

async function bind(entry: ClientEntry): Promise<void> {
  for (const unsub of entry.unsubs) unsub()
  entry.unsubs = []
  if (!entry.channels) return
  if (!clients.has(entry.socket)) return

  const projectIds = await subscribedProjectIds()
  if (!clients.has(entry.socket)) return

  const handler = (event: RuntimeEvent) => {
    if (isCanvasPerfVerbose()) {
      const kind = typeof event === 'object' && event !== null && 'kind' in event ? String((event as { kind: unknown }).kind) : 'unknown'
      if (kind === 'exec:completed' || kind === 'exec:started' || kind === 'node:output' || kind === 'graph:applied') {
        logWsRuntimeEvent('runtime', kind)
      }
    }
    try {
      entry.socket.send(JSON.stringify({ event: 'runtime', payload: event }))
    } catch {
      /* drop */
    }
  }

  for (const projectId of projectIds) {
    if (!clients.has(entry.socket)) {
      for (const unsub of entry.unsubs) unsub()
      entry.unsubs = []
      return
    }
    const rt = await getRuntimeForProject(projectId)
    if (!clients.has(entry.socket)) {
      for (const unsub of entry.unsubs) unsub()
      entry.unsubs = []
      return
    }
    const unsub = rt.subscriptions.subscribe(rt.config.pipelineId, entry.channels, handler)
    entry.unsubs.push(unsub)
  }
}

export async function rebindWsSubscriptions(): Promise<void> {
  await Promise.all([...clients.values()].map((entry) => bind(entry)))
}

const HOST_BRIDGED_WS_PATHS = ['/ws', '/ws/editor', '/ws/render', '/ws/log'] as const

export async function registerWsRoutes(app: FastifyInstance): Promise<void> {
  await app.register(import('@fastify/websocket'))
  const onConnection = async (socket: Socketish & {
    on(event: 'message' | 'close' | 'error', listener: (raw?: Buffer) => void): void
  }) => {
    await getProjectRegistry()
    const entry: ClientEntry = { socket, channels: null, unsubs: [] }
    const drop = () => {
      for (const unsub of entry.unsubs) unsub()
      entry.unsubs = []
      clients.delete(socket)
    }
    clients.set(socket, entry)
    socket.on('message', (raw) => {
      let msg: { action?: string; channels?: RuntimeChannel[] }
      try {
        msg = JSON.parse(String(raw ?? ''))
      } catch {
        return
      }
      if (msg.action === 'subscribe') {
        entry.channels = (msg.channels ?? ['graph', 'execution', 'asset']) as RuntimeChannel[]
        void bind(entry)
      }
    })
    socket.on('close', drop)
    socket.on('error', drop)
  }
  // Stock Studio already reverse-proxies /ws/{editor,render,log} to :9557.
  for (const path of HOST_BRIDGED_WS_PATHS) {
    app.get(path, { websocket: true }, onConnection)
  }
}
