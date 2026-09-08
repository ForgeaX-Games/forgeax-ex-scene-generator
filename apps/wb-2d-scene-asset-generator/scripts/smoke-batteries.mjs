// EXECUTE acceptance: load the migrated batteries, assert the must-run set
// loads cleanly, then run executeNode over a self-contained pipeline to prove
// the execute path end-to-end. (Scene-domain ops needing ScenePort inputs are
// exercised later, in the Stage-2b frontend/pipeline work; here we prove the
// engine path + that loading is clean.)
import { createRuntime, createBatteryLoader, applyBatch, executeNode } from '@forgeax/node-runtime'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(tmpdir(), `wb-scene-exec-${process.pid}`)
const rt = createRuntime({ projectRoot: root, pipelineId: 'smoke', pluginId: '@forgeax-plugin/wb-2d-scene-asset-generator' })
const loader = createBatteryLoader(rt.registry, { pluginId: '@forgeax-plugin/wb-2d-scene-asset-generator', scanDirs: ['batteries'], layout: 'flexible' })
const scan = await loader.scan()
const isMustRun = (d) =>
  d.startsWith('batteries/scene/') ||
  d.startsWith('batteries/scenealg/') ||
  (d.startsWith('batteries/special/') && !d.startsWith('batteries/special/sort/'))
const gated = scan.errors.filter((e) => isMustRun(e.dir))
if (gated.length) { console.error('must-run load errors:', gated); process.exit(1) }

const ops = loader.list()
if (!ops.includes('relu')) { console.error('missing op: relu'); process.exit(1) }

const batch = await applyBatch(rt, [
  { type: 'createNode', nodeId: 'n1', opId: 'relu', position: { x: 0, y: 0 }, params: { value: 5 } },
  { type: 'createNode', nodeId: 'n2', opId: 'relu', position: { x: 200, y: 0 }, params: { value: -3 } },
], { actor: 'smoke' })
if (batch.status !== 'ok') { console.error('applyBatch failed:', batch); process.exit(1) }

const h = await executeNode(rt, {})
const result = await h.done
if (result.status !== 'completed') { console.error('execute did not complete:', result); process.exit(1) }
console.log('[smoke-batteries] OK — loaded', ops.length, 'ops; execute status', result.status)
rmSync(root, { recursive: true, force: true })
