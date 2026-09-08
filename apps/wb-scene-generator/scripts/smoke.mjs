// Smoke test — proves the plugin can drive the kernel via @forgeax/node-runtime.
//
// Bootstraps a throwaway runtime under tmp, applies a batch, reads it
// back through queries, asserts persisted state matches the in-memory
// view, then cleans up. Exit code 0 == kernel link is healthy.

import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { applyBatch, createRuntime, getPipeline, listEdges, listNodes } from '@forgeax/node-runtime'

const root = join(tmpdir(), `wb-scene-smoke-${Date.now()}`)
mkdirSync(root, { recursive: true })

const runtime = createRuntime({
  projectRoot: root,
  pipelineId: 'smoke-pipeline',
  pluginId: '@forgeax-plugin/wb-scene-generator',
})

const result = await applyBatch(
  runtime,
  [
    {
      type: 'createNode',
      nodeId: 'src',
      opId: 'wb-scene-generator.echo',
      position: { x: 0, y: 0 },
      params: { value: 'hello' },
    },
    {
      type: 'createNode',
      nodeId: 'sink',
      opId: 'wb-scene-generator.echo',
      position: { x: 200, y: 0 },
      params: { value: '' },
    },
    {
      type: 'connect',
      edgeId: 'e1',
      source: { nodeId: 'src', port: 'echo' },
      target: { nodeId: 'sink', port: 'value' },
    },
  ],
  { actor: 'smoke' },
)

if (result.status !== 'ok') {
  console.error('applyBatch rejected:', result)
  process.exit(1)
}

const snap = getPipeline(runtime)
const nodeIds = listNodes(runtime).map((n) => n.id).sort()
const edgeCount = listEdges(runtime).length
const historyLen = runtime.history.readAll().length

const ok =
  snap !== null &&
  nodeIds.length === 2 &&
  nodeIds[0] === 'sink' &&
  nodeIds[1] === 'src' &&
  edgeCount === 1 &&
  historyLen === 1 &&
  snap.hash === result.newHash

if (!ok) {
  console.error('smoke FAILED', { snap, nodeIds, edgeCount, historyLen, expectedHash: result.newHash })
  process.exit(1)
}

console.log('smoke OK')
console.log(`  pipeline=${snap.id} hash=${snap.hash.slice(0, 12)}...`)
console.log(`  nodes=${nodeIds.join(',')} edges=${edgeCount} history=${historyLen}`)

rmSync(root, { recursive: true, force: true })
