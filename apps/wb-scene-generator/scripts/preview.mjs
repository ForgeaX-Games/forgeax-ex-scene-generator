// 💡 Zero-browser preview CLI — the LLM's "render the scene to PNG" entry.
//
// Bridges three pieces with NO browser, NO jsdom:
//   1. the kernel runtime  — load the persisted graph at --project-root, execute,
//      read scene_output's `layers` + `names` voxel ports;
//   2. the frontend renderToPng (renderer/server) — paint those layers via
//      @napi-rs/canvas (the SAME pure paint code the browser runs);
//   3. (asset draw mode only) the backend library service — alias metadata +
//      sprite blobs, fed to the renderer through setServerImageResolver.
//
// Run via tsx (resolves the imported backend/frontend .ts by relative path,
// like scripts/smoke-*.mjs). Output: a PNG written to --out.

import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createRuntime, createBatteryLoader, executeNode, listNodes, getNodeOutput } from '@forgeax/node-runtime'
import { renderToPng } from '../frontend/src/renderer/server/renderToPng.ts'
import { flattenWireList } from '../frontend/src/renderer/bridge/flattenWire.ts'
import { setServerImageResolver } from '../frontend/src/renderer/framework/asset/imageCache.ts'
import { matchAssetEntry } from '../frontend/src/renderer/framework/asset/matchAssetEntry.ts'

// ── arg parse ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { mode: 'iso', out: '/tmp/wb-scene-preview.png', draw: 'color', projectRoot: '' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--mode') out.mode = argv[++i]
    else if (a === '--out') out.out = argv[++i]
    else if (a === '--draw') out.draw = argv[++i]
    else if (a === '--project-root') out.projectRoot = argv[++i]
  }
  return out
}

// ── scene_output layers → RendererVoxelLayer[] (replicates store.setLayers) ──

function shapeLayers(nodeId, voxelLayers, names) {
  const nameById = new Map(names.map((n) => [n.id, n]))
  const now = Date.now()
  return voxelLayers.map((l) => {
    const nm = nameById.get(l.value)
    return {
      key: `${nodeId}:${l.nodePath}`,
      nodeId,
      nodePath: l.nodePath,
      nodeName: l.nodeName,
      value: l.value,
      schema: l.schema,
      cells: l.cells,
      visible: true,
      updatedAt: now,
      assetName: nm?.name ?? '',
      assetType: nm?.type,
    }
  })
}

// ── main ─────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2))

if (args.mode === 'free3d') {
  console.log('free3d server render deferred (needs GL); use the browser path')
  process.exit(0)
}

const projectRoot = args.projectRoot || mkdtempSync(join(tmpdir(), 'wb-scene-preview-'))
process.env.FORGEAX_PROJECT_ROOT = projectRoot

const rt = createRuntime({ projectRoot, pipelineId: 'preview', pluginId: '@forgeax-plugin/wb-scene-generator' })
const loader = createBatteryLoader(rt.registry, { pluginId: '@forgeax-plugin/wb-scene-generator', scanDirs: ['batteries'], layout: 'flexible' })
await loader.scan()

// Execute the persisted graph. A fresh project root has no graph.json; the
// runtime throws rather than executing nothing, so treat that as an empty scene.
try {
  await (await executeNode(rt, {})).done
} catch (err) {
  if (!String(err?.message ?? err).includes('no graph.json')) throw err
  console.log('[preview] no persisted graph at project root → empty scene.')
}

// Collect every scene_output node and shape its voxel layers.
let sceneOutNodes = []
try {
  sceneOutNodes = listNodes(rt, { opId: 'scene_output' })
} catch {
  sceneOutNodes = []
}
const layers = []
for (const node of sceneOutNodes) {
  // voxel_layers / name_list are list-valued (double-wrapped) ports → unwrap to
  // the leaf VoxelLayer / NameEntry objects (see flattenWireList).
  const voxelLayers = flattenWireList(getNodeOutput(rt, node.id, 'layers'))
  const names = flattenWireList(getNodeOutput(rt, node.id, 'names'))
  layers.push(...shapeLayers(node.id, voxelLayers, names))
}

// Asset draw mode: preload sprite blobs and inject the server image resolver.
let aliasMetas
if (args.draw === 'asset' && layers.length > 0) {
  const { listMergedAliasMetasAllZones, resolveMergedAssetContent } = await import('../backend/src/library/mergedLibraryPool.ts')
  const { loadImage } = await import('@napi-rs/canvas')
  aliasMetas = await listMergedAliasMetasAllZones()
  const imageByAlias = new Map()
  for (const layer of layers) {
    const match = matchAssetEntry({ assetName: layer.assetName, assetType: layer.assetType }, aliasMetas, false)
    if (!match) continue
    for (const alias of match.variants) {
      if (imageByAlias.has(alias)) continue
      const content = await resolveMergedAssetContent(alias)
      if (!content) continue
      imageByAlias.set(alias, await loadImage(content.bytes))
    }
  }
  setServerImageResolver((alias) => imageByAlias.get(alias) ?? null)
}

const png = await renderToPng(layers, {
  mode: args.mode, drawMode: args.draw, aliases: args.draw === 'asset' ? aliasMetas : undefined,
})
writeFileSync(args.out, png)

console.log(`[preview] wrote ${args.out} — ${png.length} bytes, ${layers.length} layer(s), mode=${args.mode}, draw=${args.draw}`)
if (layers.length === 0) {
  console.log('[preview] NOTE: scene_output yielded no voxel layers → blank PNG (capture path proven; rich pixels await scene authoring).')
}
