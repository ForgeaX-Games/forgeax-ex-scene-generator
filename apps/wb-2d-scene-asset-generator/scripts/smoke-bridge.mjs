// Boot the backend in-process and drive it the way the UI would (REST + execute)
// to prove the Stage-2b loop end-to-end over the migrated batteries. Uses a
// throwaway project root so re-runs stay idempotent (no persisted-state dupes).
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const projectRoot = mkdtempSync(join(tmpdir(), 'wb-scene-bridge-'))
process.env.FORGEAX_PROJECT_ROOT = projectRoot

const { buildApp } = await import('../backend/src/main.ts')
const app = await buildApp()

const ops = await (await app.inject({ method: 'GET', url: '/api/v1/ops' })).json()
if (!ops.some((o) => o.id === 'relu')) { console.error('relu not loaded'); process.exit(1) }

const batch = await app.inject({ method: 'POST', url: '/api/v1/batch', payload: { ops: [
  { type: 'createNode', nodeId: 'a', opId: 'relu', position: { x: 0, y: 0 }, params: { value: 9 } },
] } })
if (batch.json().status !== 'ok') { console.error('batch failed', batch.json()); process.exit(1) }

const exec = await app.inject({ method: 'POST', url: '/api/v1/execute', payload: {} })
if (exec.json().status !== 'completed') { console.error('execute failed', exec.json()); process.exit(1) }

await app.close()
rmSync(projectRoot, { recursive: true, force: true })
console.log(`[smoke-bridge] OK — ${ops.length} ops loaded, batch ok, execute completed`)
