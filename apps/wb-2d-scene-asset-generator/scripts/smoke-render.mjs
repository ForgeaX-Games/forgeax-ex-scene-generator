// Prove the renderer's data contract end-to-end: boot the backend in-process
// over a throwaway project root and assert the scene_output op the renderer
// reads from is loaded and exposes the `layers` + `names` output ports.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.FORGEAX_PROJECT_ROOT = mkdtempSync(join(tmpdir(), 'wb-scene-render-'))
const { buildApp } = await import('../backend/src/main.ts')
const app = await buildApp()

const ops = await (await app.inject({ method: 'GET', url: '/api/v1/ops' })).json()
const sceneOut = ops.find((o) => o.id === 'scene_output')
if (!sceneOut) {
  console.error('scene_output op not loaded')
  process.exit(1)
}
// Assert the contract the renderer reads: scene_output names its output ports.
const outNames = (sceneOut.outputs ?? []).map((o) => o.name)
if (!outNames.includes('layers') || !outNames.includes('names')) {
  console.error('scene_output output ports unexpected:', outNames)
  process.exit(1)
}

await app.close()
rmSync(process.env.FORGEAX_PROJECT_ROOT, { recursive: true, force: true })
console.log('[smoke-render] OK — scene_output present with layers+names ports (renderer data contract)')
