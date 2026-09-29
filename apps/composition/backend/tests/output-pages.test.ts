import { afterEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { encodeOutputPages, registerOutputPageRoutes } from '../src/routes/outputPages.js'
import { applyOutputPage, type OutputPageRecord } from '../../frontend/src/api/outputPages.js'

function decode(pages: string[]): unknown {
  return pages.reduce((root, page) => applyOutputPage(root, JSON.parse(page) as OutputPageRecord[]), undefined as unknown)
}
const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const fn of cleanup.splice(0)) await fn() })

describe('bounded output pages', () => {
  it('round trips a large blob, unicode, escaped text, empty containers and prototype-named keys within the byte limit', () => {
    const value = {
      value: [{ path: [0], items: [{ __outputCacheBlobRef: 'mesh' }] }],
      blobs: { mesh: { text: '窓🪟\\\n"'.repeat(800), vertices: Array.from({ length: 3000 }, (_, i) => i / 7), empty: [{}, []], special: JSON.parse('{"__proto__":{"constructor":"data"}}') } },
    }
    const pages = [...encodeOutputPages(value, 1024)]
    expect(pages.length).toBeGreaterThan(10)
    expect(pages.every((p) => Buffer.byteLength(p) <= 1024)).toBe(true)
    expect(decode(pages)).toEqual(value)
    expect(({} as Record<string, unknown>).constructor).toBe(Object)
  })

  it('serves immutable snapshots scoped to the project and port, reuses them and cleans up on close', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'page-test-'))
    cleanup.push(() => rm(dir, { recursive: true, force: true }))
    const metadata = join(dir, 'output.json')
    await writeFile(metadata, 'first')
    let value = { text: 'first' }
    let reads = 0
    const app = Fastify()
    await registerOutputPageRoutes(app, {
      getProjectRegistry: async () => ({ getProject: (id) => id === 'p' }),
      getRuntimeForProject: async () => ({ outputs: {
        jsonPath: () => metadata,
        readWithBlobRefs: () => { reads++; return { entry: { data: value }, blobs: {} } },
      } }),
    })
    cleanup.unshift(() => app.close())
    const path = '/api/v1/projects/p/nodes/n/outputs/scene/pages'
    const first = (await app.inject(path)).json()
    expect(first.format).toBe('output-pages/1')
    expect((await app.inject(path)).json().snapshot).toBe(first.snapshot)
    expect(reads).toBe(1)
    value = { text: 'new revision' }
    await writeFile(metadata, 'second revision')
    const next = (await app.inject(path)).json()
    expect(next.snapshot).not.toBe(first.snapshot)
    const read = async (id: string) => (await app.inject(`${path}/${id}/0`)).body
    expect(decode([await read(first.snapshot)])).toEqual({ value: { text: 'first' }, blobs: {} })
    expect(decode([await read(next.snapshot)])).toEqual({ value, blobs: {} })
    expect((await app.inject(`${path}/${first.snapshot}/-1`)).statusCode).toBe(404)
    expect((await app.inject(`${path}/${first.snapshot}/999`)).statusCode).toBe(404)
    expect((await app.inject(`${path.replace('/scene/', '/other/')}/${first.snapshot}/0`)).statusCode).toBe(410)
    expect((await app.inject(path.replace('/projects/p/', '/projects/absent/'))).statusCode).toBe(404)
  })
})
