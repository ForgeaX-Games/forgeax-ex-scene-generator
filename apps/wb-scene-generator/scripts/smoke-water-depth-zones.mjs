// One-off manual verification for the WaterDepthZones template (not wired into CI).
// Spins up the real backend on an ephemeral port + isolated temp project root,
// instantiates the template, wires a synthetic "sea with island hole" region,
// executes, and asserts shallow/mid/deep partition + asset_name/asset_type wiring.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = Number(process.env.SMOKE_PORT ?? 9698)
const HOST = '127.0.0.1'

const projectRoot = mkdtempSync(join(tmpdir(), 'wb-water-depth-zones-'))
process.env.FORGEAX_PROJECT_ROOT = projectRoot

const { buildApp } = await import('../backend/src/main.ts')
const app = await buildApp()

function fail(msg, extra) {
  console.error(`[smoke-water-depth-zones] FAIL — ${msg}`, extra !== undefined ? JSON.stringify(extra) : '')
  process.exitCode = 1
}

async function api(path, body) {
  const res = await fetch(`http://${HOST}:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  return res.json()
}

// 20x20 grid, all 1 (sea), with a 4x4 hole (island) centered around (9,9).
function seaWithIslandGrid(size = 20, holeSize = 4) {
  const grid = Array.from({ length: size }, () => new Array(size).fill(1))
  const start = Math.floor((size - holeSize) / 2)
  for (let y = start; y < start + holeSize; y++)
    for (let x = start; x < start + holeSize; x++) grid[y][x] = 0
  return grid
}

// Diamond-shaped organic sea (does NOT touch all 4 bbox edges at every cell) with the same island hole.
function organicSeaWithIslandGrid(size = 20, holeSize = 4) {
  const grid = Array.from({ length: size }, () => new Array(size).fill(0))
  const cx = (size - 1) / 2, cy = (size - 1) / 2
  const radius = size / 2
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if (Math.abs(x - cx) + Math.abs(y - cy) <= radius) grid[y][x] = 1
    }
  const start = Math.floor((size - holeSize) / 2)
  for (let y = start; y < start + holeSize; y++)
    for (let x = start; x < start + holeSize; x++) grid[y][x] = 0
  return grid
}

function countNonZero(grid) {
  let n = 0
  for (const row of grid) for (const v of row) if (v !== 0) n++
  return n
}

function unwrap(entries) {
  return entries?.[0]?.items?.[0]
}

// ScenePortValue shape: { graph: { [id]: { name, parent, children: {name: id}, content, attributes|attrs } }, focus: id }
function focusNode(scene) {
  const graph = scene?.graph
  if (!graph) return null
  return graph[scene.focus] ?? null
}

function countDenseNonZero(content) {
  if (!content) return 0
  if (content.kind === 'dense' && Array.isArray(content.data)) {
    let n = 0
    for (const v of content.data) if (v !== 0 && v !== null && v !== undefined) n++
    return n
  }
  if (content.kind === 'sparse' && content.cells && typeof content.cells === 'object') {
    return Object.keys(content.cells).length
  }
  return 0
}

function collectVoxelCount(scene) {
  const graph = scene?.graph
  const target = focusNode(scene)
  if (!graph || !target) return 0
  let total = countDenseNonZero(target.content)
  const visit = (node) => {
    for (const childId of Object.values(node.children ?? {})) {
      const child = graph[childId]
      if (!child) continue
      total += countDenseNonZero(child.content)
      visit(child)
    }
  }
  visit(target)
  return total
}

function getAttr(scene, key) {
  const target = focusNode(scene)
  return target?.attributes?.[key] ?? target?.attrs?.[key]
}

async function runCase(label, grid, thresholds) {
  const seaGrid = grid
  const total = countNonZero(seaGrid)

  const proj = await api('/api/v1/projects', { name: `wdz-${label}` })
  if (!proj.id) { fail(`${label}: project create failed`, proj); return }
  const P = proj.id
  console.log(`[smoke-water-depth-zones] [${label}] project=${P}`)

  const seaOps = [
    { type: 'createNode', nodeId: 'sea', opId: 'grid2node', position: { x: 0, y: 0 }, params: { name: 'Sea', grid: seaGrid } },
    { type: 'createNode', nodeId: 'thr1', opId: 'number_const', position: { x: 0, y: 100 }, params: { value: thresholds[0] } },
    { type: 'createNode', nodeId: 'thr2', opId: 'number_const', position: { x: 0, y: 200 }, params: { value: thresholds[1] } },
  ]
  const batch1 = await api(`/api/v1/projects/${P}/batch`, { ops: seaOps })
  if (batch1.status !== 'ok') { fail(`${label}: setup batch rejected`, batch1); return }

  const inst = await api(`/api/v1/group-templates/WaterDepthZones/instantiate`, {
    templateId: 'WaterDepthZones',
    projectId: P,
    position: { x: 400, y: 0 },
  })
  if (!inst.groupId) { fail(`${label}: instantiate failed`, inst); return }
  const G = inst.groupId
  console.log(`[smoke-water-depth-zones] [${label}] group=${G}`)

  const wireOps = [
    { type: 'connect', edgeId: 'e_scene', source: { nodeId: 'sea', port: 'scene' }, target: { nodeId: G, port: 'in_0' } },
    { type: 'connect', edgeId: 'e_thr1', source: { nodeId: 'thr1', port: 'value' }, target: { nodeId: G, port: 'in_1' } },
    { type: 'connect', edgeId: 'e_thr2', source: { nodeId: 'thr2', port: 'value' }, target: { nodeId: G, port: 'in_2' } },
  ]
  const batch2 = await api(`/api/v1/projects/${P}/batch`, { ops: wireOps })
  if (batch2.status !== 'ok') { fail(`${label}: wire batch rejected`, batch2); return }

  const exec = await api(`/api/v1/projects/${P}/execute`, {})
  if (exec.status !== 'completed') { fail(`${label}: execute did not complete`, exec); return }

  const shallow = unwrap(exec.outputs?.[G]?.out_1)
  const mid = unwrap(exec.outputs?.[G]?.out_2)
  const deep = unwrap(exec.outputs?.[G]?.out_3)

  const shallowCount = collectVoxelCount(shallow)
  const midCount = collectVoxelCount(mid)
  const deepCount = collectVoxelCount(deep)
  const sum = shallowCount + midCount + deepCount

  console.log(`[${label}] total=${total} shallow=${shallowCount} mid=${midCount} deep=${deepCount} sum=${sum}`)

  if (sum !== total) fail(`${label}: shallow+mid+deep (${sum}) != total sea cells (${total})`)
  if (shallowCount === 0) fail(`${label}: shallow partition is empty`)
  if (deepCount === 0) fail(`${label}: deep partition is empty`)

  const shallowAsset = getAttr(shallow, 'asset_name')
  const midAsset = getAttr(mid, 'asset_name')
  const deepAsset = getAttr(deep, 'asset_name')
  console.log(`[${label}] assets: shallow=${shallowAsset} mid=${midAsset} deep=${deepAsset}`)
  if (shallowAsset !== '浅水') fail(`${label}: shallow asset_name mismatch`, shallowAsset)
  if (midAsset !== '中水') fail(`${label}: mid asset_name mismatch`, midAsset)
  if (deepAsset !== '深水') fail(`${label}: deep asset_name mismatch`, deepAsset)
}

try {
  await app.listen({ port: PORT, host: HOST })

  await runCase('rect-outer-edge (island in open sea)', seaWithIslandGrid(20, 4), [3, 6])
  await runCase('organic-outer-edge (natural coastline + island)', organicSeaWithIslandGrid(20, 4), [1, 2])

  if (!process.exitCode) console.log('[smoke-water-depth-zones] OK')
} catch (err) {
  fail('threw', err instanceof Error ? err.message : String(err))
} finally {
  await app.close()
  rmSync(projectRoot, { recursive: true, force: true })
}
