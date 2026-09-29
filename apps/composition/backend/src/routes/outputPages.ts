import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'

// JSON paths keep large objects/arrays independently parseable. This is transport
// only: the reconstructed value still uses the existing output/blob wire contract.
type Path = Array<string | number>
const PAGE_BYTES = 8 * 1024 * 1024
const KEEP_MS = 10 * 60 * 1000

/** Stops counting at the budget; never stringify a complete unbounded scene. */
function fits(value: unknown, budget: number): boolean {
  function size(v: unknown): number {
    if (budget < 0) return 0
    if (typeof v === 'string' && v.length > budget) { budget = -1; return 0 }
    if (v === null || typeof v !== 'object') {
      budget -= Buffer.byteLength(JSON.stringify(v) ?? 'null')
    } else {
      budget -= 2
      for (const [key, child] of Object.entries(v)) {
        if (!Array.isArray(v)) budget -= Buffer.byteLength(JSON.stringify(key)) + 1
        budget -= 1
        size(child)
        if (budget < 0) break
      }
    }
    return 0
  }
  size(value)
  return budget >= 0
}

/** Bounded UTF-8 JSON pages; containers precede children, including empty ones. */
export function* encodeOutputPages(value: unknown, maxBytes = PAGE_BYTES): Generator<string> {
  if (maxBytes < 256) throw new Error('output page budget must be at least 256 bytes')
  function* records(v: unknown, path: Path): Generator<string> {
    const prefix = `{"path":${JSON.stringify(path)},"value":`
    const budget = maxBytes - Buffer.byteLength(prefix) - 3
    if (budget < 32) throw new Error('output nesting exceeds page budget')
    if (fits(v, budget)) {
      yield `${prefix}${JSON.stringify(v) ?? 'null'}}`
    } else if (typeof v === 'string') {
      yield `${prefix}""}`
      // JSON escaping is at most six bytes per UTF-16 code unit. Splitting a
      // surrogate pair is safe: JSON escapes it and concatenation restores it.
      const chars = Math.max(1, Math.floor((budget - 16) / 6))
      for (let i = 0; i < v.length; i += chars) {
        yield JSON.stringify({ path, appendText: v.slice(i, i + chars) })
      }
    } else if (v && typeof v === 'object') {
      yield `${prefix}${Array.isArray(v) ? '[]' : '{}'}}`
      for (const [key, child] of Object.entries(v)) {
        yield* records(child, [...path, Array.isArray(v) ? Number(key) : key])
      }
    } else {
      throw new Error('output value cannot fit page budget')
    }
  }
  let page: string[] = [], bytes = 2
  for (const record of records(value, [])) {
    const count = Buffer.byteLength(record)
    if (count + 2 > maxBytes) throw new Error('output record exceeds page budget')
    if (bytes + count + (page.length ? 1 : 0) > maxBytes) {
      yield `[${page.join(',')}]`
      page = []; bytes = 2
    }
    bytes += count + (page.length ? 1 : 0)
    page.push(record)
  }
  if (page.length) yield `[${page.join(',')}]`
}

interface OutputSource {
  jsonPath(n: string, p: string): string
  readWithBlobRefs(n: string, p: string): { entry: { data?: unknown }; blobs: Record<string, unknown> } | null
}
interface Snapshot { id: string; directory: string; pages: number; bytes: number; accessed: number; key: string }
interface Dependencies {
  getProjectRegistry(): Promise<{ getProject(id: string): unknown }>
  getRuntimeForProject(id: string): Promise<{ outputs: OutputSource }>
}

/** Immutable, short-lived disk snapshots; page fetches never rebuild geometry. */
export async function registerOutputPageRoutes(app: FastifyInstance, deps: Dependencies): Promise<void> {
  const snapshots = new Map<string, Snapshot>()
  const building = new Map<string, Promise<Snapshot>>()
  const latest = new Map<string, Snapshot>()
  let root: Promise<string> | undefined
  const remove = async (snapshot: Snapshot) => {
    snapshots.delete(snapshot.id)
    if (latest.get(snapshot.key) === snapshot) latest.delete(snapshot.key)
    await rm(snapshot.directory, { recursive: true, force: true })
  }
  const timer = setInterval(() => {
    for (const s of snapshots.values()) {
      if (Date.now() - s.accessed > KEEP_MS) void remove(s)
    }
  }, 60_000)
  timer.unref()
  app.addHook('onClose', async () => {
    clearInterval(timer)
    await Promise.allSettled(building.values())
    if (root) await rm(await root, { recursive: true, force: true })
  })
  type Params = { projectId: string; id: string; portId: string }
  const prefix = '/api/v1/projects/:projectId/nodes/:id/outputs/:portId/pages'
  app.get<{ Params: Params }>(prefix, async (req, reply) => {
    const { projectId, id, portId } = req.params
    if (!(await deps.getProjectRegistry()).getProject(projectId)) return reply.code(404).send({ reason: 'project not found' })
    if ([id, portId].some((part) => /[\/\\\0]/.test(part) || part === '..')) {
      return reply.code(400).send({ reason: 'invalid output identifier' })
    }
    const source = (await deps.getRuntimeForProject(projectId)).outputs
    const signature = async () => {
      const s = await stat(source.jsonPath(id, portId))
      return `${s.mtimeMs}:${s.ctimeMs}:${s.size}`
    }
    let revision: string
    try { revision = await signature() } catch { return reply.code(404).send({ reason: 'output not found' }) }
    const key = JSON.stringify([projectId, id, portId, revision])
    let snapshot = latest.get(key)
    if (!snapshot) {
      let pending = building.get(key)
      if (!pending) {
        pending = (async () => {
          const envelope = source.readWithBlobRefs(id, portId)
          if (!envelope) throw new Error('output unavailable; execute the project first')
          root ??= mkdtemp(join(tmpdir(), 'scene-output-pages-'))
          const directory = await mkdtemp(join(await root, 'snapshot-'))
          const result: Snapshot = { id: randomUUID(), directory, pages: 0, bytes: 0, accessed: Date.now(), key }
          try {
            for (const body of encodeOutputPages({ value: envelope.entry.data ?? null, blobs: envelope.blobs })) {
              await writeFile(join(directory, `${result.pages++}.json`), body)
              result.bytes += Buffer.byteLength(body)
            }
            // A source mutation during encoding must not publish a mixed revision.
            if (await signature() !== revision) throw new Error('output changed during transfer preparation; retry')
            latest.set(key, result); snapshots.set(result.id, result)
            return result
          } catch (error) {
            await rm(directory, { recursive: true, force: true })
            throw error
          }
        })()
        building.set(key, pending)
      }
      try { snapshot = await pending } finally { building.delete(key) }
    }
    snapshot.accessed = Date.now()
    reply.header('cache-control', 'no-store')
    return { format: 'output-pages/1', snapshot: snapshot.id, pages: snapshot.pages, bytes: snapshot.bytes, maxPageBytes: PAGE_BYTES }
  })
  app.get<{ Params: Params & { snapshot: string; page: string } }>(`${prefix}/:snapshot/:page`, async (req, reply) => {
    const { projectId, id, portId, snapshot: token, page } = req.params
    if (!(await deps.getProjectRegistry()).getProject(projectId)) return reply.code(404).send({ reason: 'project not found' })
    const s = snapshots.get(token)
    const identity = s ? JSON.parse(s.key) as string[] : []
    if (!s || identity[0] !== projectId || identity[1] !== id || identity[2] !== portId) {
      return reply.code(410).send({ reason: 'output snapshot expired; request a new manifest' })
    }
    const index = Number(page)
    if (!/^\d+$/.test(page) || !Number.isSafeInteger(index) || index < 0 || index >= s.pages) {
      return reply.code(404).send({ reason: 'output page not found' })
    }
    s.accessed = Date.now()
    reply.header('cache-control', 'no-store').type('application/json; charset=utf-8')
    return reply.send(createReadStream(join(s.directory, `${index}.json`)))
  })
}
