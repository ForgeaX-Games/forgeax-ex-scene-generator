import type { FastifyInstance } from 'fastify'
import type { RuntimeChannel, RuntimeEvent } from '@forgeax/node-runtime'
import { getProjectRegistry, getRuntimeForProject } from '../runtime.js'

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

  const projectIds = await subscribedProjectIds()
  const handler = (event: RuntimeEvent) => {
    try {
      entry.socket.send(JSON.stringify({ event: 'runtime', payload: event }))
    } catch {
      /* drop */
    }
  }

  for (const projectId of projectIds) {
    // A viewing/locked project can be deleted while a client stays subscribed
    // (stale viewing pointer, closed project, etc). getRuntimeForProject throws
    // "project not found" in that case; since bind() is invoked as `void bind()`
    // below, that rejection would surface as an unhandled rejection and crash
    // the whole backend. Skip the stale id instead of taking the process down.
    try {
      const rt = await getRuntimeForProject(projectId)
      const unsub = rt.subscriptions.subscribe(rt.config.pipelineId, entry.channels, handler)
      entry.unsubs.push(unsub)
    } catch {
      /* stale/deleted project still in subscribed set — skip */
    }
  }
}

export async function rebindWsSubscriptions(): Promise<void> {
  await Promise.all([...clients.values()].map((entry) => bind(entry)))
}

export async function registerWsRoutes(app: FastifyInstance): Promise<void> {
  await app.register(import('@fastify/websocket'))
  app.get('/ws', { websocket: true }, async (socket) => {
    await getProjectRegistry()
    const entry: ClientEntry = { socket, channels: null, unsubs: [] }
    clients.set(socket, entry)
    socket.on('message', (raw: Buffer) => {
      let msg: { action?: string; channels?: RuntimeChannel[] }
      try { msg = JSON.parse(raw.toString()) } catch { return }
      if (msg.action === 'subscribe') {
        entry.channels = (msg.channels ?? ['graph', 'execution', 'asset']) as RuntimeChannel[]
        void bind(entry).catch(() => {
          /* never let a subscribe bind failure crash the backend */
        })
      }
    })
    socket.on('close', () => {
      for (const unsub of entry.unsubs) unsub()
      clients.delete(socket)
    })
  })
}
