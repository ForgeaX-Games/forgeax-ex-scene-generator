// 💡 North-Star §8 loop, zero browser: build → execute → render PNG → iterate.
//
// Drives the in-process kernel runtime headlessly (NO browser, NO jsdom):
//   1. build a pipeline of >=5 connected nodes, execute, render a PNG (#1);
//   2. add >=2 more nodes + a reconnect, execute, render a PNG (#2);
//   3. assert both files are valid PNGs (magic bytes);
//   4. assert determinism — run the SAME build+execute sequence twice and
//      assert an identical op-output hash (reuse acceptance-loop's approach).
//
// The renderer captures whatever scene_output yields. With only relu math nodes
// (no scene-domain authoring yet) that capture is a valid BLANK PNG — the loop
// mechanics + capture path + determinism are what this asserts; rich pixels
// follow scene-domain authoring.

import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

import { createRuntime, createBatteryLoader, applyBatch, executeNode, listNodes, getNodeOutput } from '@forgeax/node-runtime'
import { renderToPng } from '../frontend/src/renderer/server/renderToPng.ts'
import { flattenWireList } from '../frontend/src/renderer/bridge/flattenWire.ts'

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function isPng(path) {
  const head = readFileSync(path).subarray(0, 8)
  return head.equals(PNG_MAGIC)
}

async function newRuntime() {
  const root = mkdtempSync(join(tmpdir(), 'wb-scene-north-star-'))
  process.env.FORGEAX_PROJECT_ROOT = root
  const rt = createRuntime({ projectRoot: root, pipelineId: 'north-star', pluginId: '@forgeax-plugin/wb-scene-generator' })
  const loader = createBatteryLoader(rt.registry, { pluginId: '@forgeax-plugin/wb-scene-generator', scanDirs: ['batteries'], layout: 'flexible' })
  await loader.scan()
  return { rt, root }
}

// Build a >=5-node relu chain: 4 sources fanning into a sink (5 nodes, 4 edges).
async function buildBase(rt) {
  await applyBatch(rt, [
    { type: 'createNode', nodeId: 'a', opId: 'relu', position: { x: 0, y: 0 }, params: { value: 5 } },
    { type: 'createNode', nodeId: 'b', opId: 'relu', position: { x: 0, y: 80 }, params: { value: -2 } },
    { type: 'createNode', nodeId: 'c', opId: 'relu', position: { x: 0, y: 160 }, params: { value: 7 } },
    { type: 'createNode', nodeId: 'd', opId: 'relu', position: { x: 0, y: 240 }, params: { value: 3 } },
    { type: 'createNode', nodeId: 'sink', opId: 'relu', position: { x: 240, y: 120 }, params: { value: 1 } },
    { type: 'connect', edgeId: 'e_a', source: { nodeId: 'a', port: 'result' }, target: { nodeId: 'sink', port: 'value' } },
    { type: 'connect', edgeId: 'e_b', source: { nodeId: 'b', port: 'result' }, target: { nodeId: 'sink', port: 'value' } },
    { type: 'connect', edgeId: 'e_c', source: { nodeId: 'c', port: 'result' }, target: { nodeId: 'sink', port: 'value' } },
    { type: 'connect', edgeId: 'e_d', source: { nodeId: 'd', port: 'result' }, target: { nodeId: 'sink', port: 'value' } },
  ], { actor: 'north-star' })
}

// Iterate: add >=2 more nodes and rewire the sink's source.
async function iterate(rt) {
  await applyBatch(rt, [
    { type: 'createNode', nodeId: 'e', opId: 'relu', position: { x: 0, y: 320 }, params: { value: 11 } },
    { type: 'createNode', nodeId: 'f', opId: 'relu', position: { x: 0, y: 400 }, params: { value: -8 } },
    { type: 'disconnect', edgeId: 'e_a' },
    { type: 'connect', edgeId: 'e_e', source: { nodeId: 'e', port: 'result' }, target: { nodeId: 'sink', port: 'value' } },
    { type: 'connect', edgeId: 'e_f', source: { nodeId: 'f', port: 'result' }, target: { nodeId: 'sink', port: 'value' } },
  ], { actor: 'north-star' })
}

// Capture the current scene_output voxel layers → PNG. May be blank (no scene
// authoring yet); that is the honest state.
async function capturePng(rt, out) {
  const layers = []
  for (const node of listNodes(rt, { opId: 'scene_output' })) {
    const voxelLayers = flattenWireList(getNodeOutput(rt, node.id, 'layers'))
    const names = flattenWireList(getNodeOutput(rt, node.id, 'names'))
    const nameById = new Map(names.map((n) => [n.id, n]))
    const now = Date.now()
    for (const l of voxelLayers) {
      const nm = nameById.get(l.value)
      layers.push({
        key: `${node.id}:${l.nodePath}`, nodeId: node.id, nodePath: l.nodePath, nodeName: l.nodeName,
        value: l.value, schema: l.schema, cells: l.cells, visible: true, updatedAt: now,
        assetName: nm?.name ?? '', assetType: nm?.type,
      })
    }
  }
  const png = await renderToPng(layers, { mode: 'iso', drawMode: 'color' })
  writeFileSync(out, png)
  return { layerCount: layers.length, bytes: png.length }
}

// Deterministic op-output hash over every node's `result` (acceptance-loop style).
function outputHash(rt) {
  const outputs = {}
  for (const node of listNodes(rt)) {
    outputs[node.id] = getNodeOutput(rt, node.id, 'result')
  }
  return createHash('sha256').update(JSON.stringify(outputs)).digest('hex')
}

// One full build → execute → iterate → execute pass; returns the final hash.
async function runOnce(png1, png2) {
  const { rt, root } = await newRuntime()
  await buildBase(rt)
  await (await executeNode(rt, {})).done
  const cap1 = png1 ? await capturePng(rt, png1) : null
  await iterate(rt)
  await (await executeNode(rt, {})).done
  const cap2 = png2 ? await capturePng(rt, png2) : null
  const hash = outputHash(rt)
  rmSync(root, { recursive: true, force: true })
  return { hash, cap1, cap2 }
}

// ── run ────────────────────────────────────────────────────────────────────

const PNG1 = '/tmp/wb-scene-north-star-1.png'
const PNG2 = '/tmp/wb-scene-north-star-2.png'

const r1 = await runOnce(PNG1, PNG2)
const r2 = await runOnce(null, null) // determinism: same sequence, hash only

const png1Ok = isPng(PNG1)
const png2Ok = isPng(PNG2)
const deterministic = r1.hash === r2.hash

console.log('[north-star] §8 loop summary (zero browser):')
console.log(`  build(5 nodes/4 edges) → execute → PNG #1: ${PNG1} (${r1.cap1.bytes} bytes, ${r1.cap1.layerCount} layer(s), valid PNG=${png1Ok})`)
console.log(`  iterate(+2 nodes, reconnect) → execute → PNG #2: ${PNG2} (${r1.cap2.bytes} bytes, ${r1.cap2.layerCount} layer(s), valid PNG=${png2Ok})`)
console.log(`  determinism: run twice → identical op-output hash=${deterministic} (${r1.hash.slice(0, 12)})`)
if (r1.cap1.layerCount === 0 && r1.cap2.layerCount === 0) {
  console.log('  NOTE: scene_output empty (relu math pipeline, no scene-domain authoring yet) → PNGs are valid blanks. Loop + capture path + determinism proven; rich pixels await scene authoring.')
}

if (!png1Ok || !png2Ok) { console.error('[north-star] FAIL — a PNG is not valid'); process.exit(1) }
if (!deterministic) { console.error('[north-star] FAIL — non-deterministic outputs:', r1.hash, r2.hash); process.exit(1) }
console.log('[north-star] OK — 2 valid PNGs + determinism pass')
