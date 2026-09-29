import { createServer } from 'node:net'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isTcpPortOpen, shouldSpawnSceneBackend } from '../src/ensure-host-backend.js'

describe('ensureSceneBackend', () => {
  it('does not spawn under vitest', () => {
    expect(shouldSpawnSceneBackend()).toBe(false)
  })

  it('detects an open TCP port without leaking the probe socket', async () => {
    const server = createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    expect(await isTcpPortOpen(port)).toBe(true)
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()))
    expect(await isTcpPortOpen(port)).toBe(false)
  })

  it('host start script is a single tsx process, not --watch', () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '../package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }
    expect(pkg.scripts?.start).toBe('tsx src/main.ts')
    expect(pkg.scripts?.start).not.toMatch(/--watch/)
  })
})
