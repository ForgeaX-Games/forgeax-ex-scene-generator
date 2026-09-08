// End-to-end preview smoke for multi-layer scene assembly (the bug repro, fixed).
//
// Builds grid2node leaves → add_child (faithful scene assembly) → scene_output,
// drives it over the REAL REST API on an EPHEMERAL alt port + isolated temp
// project root, and asserts the assembled scene is a non-empty 2-child tree that
// projects to 2 non-empty voxel layers. Tears everything down; never touches the
// user's running backend on :9557.
//
// Note on topology: two independent leaves first pass through `tree_merge` in
// its item-concat band. The merged DataTree branch is then consumed by
// add_child.nodes (access:list), matching legacy list collection semantics.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = Number(process.env.SMOKE_PORT ?? 9575)
const HOST = '127.0.0.1'

const projectRoot = mkdtempSync(join(tmpdir(), 'wb-scene-assembly-'))
process.env.FORGEAX_PROJECT_ROOT = projectRoot

const { buildApp } = await import('../backend/src/main.ts')
const app = await buildApp()

function fail(msg, extra) {
  console.error(`[smoke-scene-assembly] FAIL — ${msg}`, extra !== undefined ? JSON.stringify(extra) : '')
  process.exitCode = 1
}

async function api(path, body) {
  const res = await fetch(`http://${HOST}:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}

try {
  await app.listen({ port: PORT, host: HOST })

  // grid2node ×2 leaves (A, B) + a voxel-free structural root, assembled via
  // tree_merge(item concat) → add_child(list) → scene_output.
  const ops = [
    { type: 'createNode', nodeId: 'root', opId: 'grid2node', position: { x: 0, y: 0 }, params: { name: 'Root', grid: [[0]] } },
    { type: 'createNode', nodeId: 'a', opId: 'grid2node', position: { x: 0, y: 100 }, params: { name: 'A', grid: [[1]] } },
    { type: 'createNode', nodeId: 'b', opId: 'grid2node', position: { x: 0, y: 200 }, params: { name: 'B', grid: [[1, 1]] } },
    { type: 'createNode', nodeId: 'merge', opId: 'tree_merge', position: { x: 300, y: 160 }, params: { portCount: 2, inferredAccess: 'item', inferredType: 'scene' } },
    { type: 'createNode', nodeId: 'add', opId: 'add_child', position: { x: 600, y: 0 }, params: {} },
    { type: 'createNode', nodeId: 'out', opId: 'scene_output', position: { x: 900, y: 0 }, params: {} },
    { type: 'connect', edgeId: 'e1', source: { nodeId: 'a', port: 'scene' }, target: { nodeId: 'merge', port: 'item_0' } },
    { type: 'connect', edgeId: 'e2', source: { nodeId: 'b', port: 'scene' }, target: { nodeId: 'merge', port: 'item_1' } },
    { type: 'connect', edgeId: 'e3', source: { nodeId: 'root', port: 'scene' }, target: { nodeId: 'add', port: 'scene' } },
    { type: 'connect', edgeId: 'e4', source: { nodeId: 'merge', port: 'tree' }, target: { nodeId: 'add', port: 'nodes' } },
    { type: 'connect', edgeId: 'e5', source: { nodeId: 'add', port: 'scene' }, target: { nodeId: 'out', port: 'scene' } },
  ]

  const batch = await api('/api/v1/batch', { ops })
  if (batch.status !== 'ok') fail('applyBatch rejected', batch)

  const exec = await api('/api/v1/execute', {})
  if (exec.status !== 'completed') fail('execute did not complete', exec)

  // Wire values are DataTreeEntry[] (toJSON): unwrap the single item.
  const unwrap = (entries) => entries?.[0]?.items?.[0]

  // 1) Assembled scene: non-empty ScenePortValue with 2 children under /Root.
  const scene = unwrap(exec.outputs?.add?.scene)
  if (!scene || typeof scene !== 'object' || !scene.tree) fail('add.scene is not a ScenePortValue', exec.outputs?.add?.scene)
  const rootNode = scene?.tree?.children?.find((c) => c.name === 'Root')
  const childNames = (rootNode?.children ?? []).map((c) => c.name).sort()
  if (childNames.length !== 2 || childNames[0] !== 'A' || childNames[1] !== 'B') {
    fail('assembled scene does not have exactly 2 children [A,B]', childNames)
  }

  // 2) childPaths from add_child: /Root/A and /Root/B.
  const allChildPaths = (exec.outputs?.add?.childPaths ?? [])
    .flatMap((entry) => Array.isArray(entry.items) ? entry.items : [])
    .sort()
  if (allChildPaths.join(',') !== '/Root/A,/Root/B') fail('childPaths mismatch', allChildPaths)

  // 3) Voxel projection: 2 non-empty layers.
  const layers = unwrap(exec.outputs?.out?.layers)
  const nonEmpty = Array.isArray(layers) ? layers.filter((l) => Array.isArray(l.cells) && l.cells.length > 0) : []
  if (nonEmpty.length !== 2) fail('scene_output did not yield 2 non-empty voxel layers', layers)

  if (!process.exitCode) {
    console.log('[smoke-scene-assembly] OK — assembled scene has 2 children [%s]; scene_output → %d non-empty layers (%s)',
      childNames.join(','), nonEmpty.length, nonEmpty.map((l) => `${l.nodePath}:${l.cells.length}`).join(', '))
  }
} catch (err) {
  fail('threw', err instanceof Error ? err.message : String(err))
} finally {
  await app.close()
  rmSync(projectRoot, { recursive: true, force: true })
}
