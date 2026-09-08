#!/usr/bin/env node
/**
 * Build the template test project through the standard backend HTTP API, then
 * capture one Billboard/Asset icon per template from the live browser renderer.
 *
 * Everything goes through the documented routes (projects / group-templates /
 * batch / execute / agent renderer + screenshot) — no direct .forgeax-runtime
 * writes, so the running backend and the open editor stay authoritative.
 *
 * The browser DrawMode (Wire/Color/Asset) has no remote channel; a human must
 * leave the toolbar on `Asset` for the captures to contain sprites.
 *
 * Usage:
 *   BASE=http://localhost:9657 PROJECT=p_xxx tsx scripts/template-icons-live.mjs [--build] [--capture]
 */
import { readdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve, basename, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadImage, createCanvas } from '@napi-rs/canvas'

const here = dirname(fileURLToPath(import.meta.url))
const APP_ROOT = resolve(here, '..')
const TEMPLATE_ROOT = join(APP_ROOT, 'batteries', 'templates')
const BASE = process.env.BASE ?? 'http://localhost:9657'
const PROJECT = process.env.PROJECT
const GRID = 50

if (!PROJECT) {
  console.error('PROJECT env var is required (a project id from POST /api/v1/projects)')
  process.exit(1)
}

// ── HTTP ────────────────────────────────────────────────────────────────────

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-forgeax-agent-id': 'ai:template-icons' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await res.text()
  let json
  try { json = text ? JSON.parse(text) : null } catch { json = { raw: text } }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 400)}`)
  return json
}

async function batch(ops, label) {
  if (ops.length === 0) return { status: 'ok' }
  const r = await api('POST', `/api/v1/projects/${PROJECT}/batch`, { ops, opts: { actor: 'ai:template-icons', label } })
  if (r.status && r.status !== 'ok') {
    throw new Error(`batch '${label}' rejected: ${r.reason ?? ''} ${JSON.stringify(r.diagnostics ?? []).slice(0, 500)}`)
  }
  return r
}

async function instantiate(templateName, groupId, position) {
  return api('POST', `/api/v1/group-templates/${encodeURIComponent(templateName)}/instantiate`, {
    projectId: PROJECT, templateId: templateName, groupId, position,
    opts: { actor: 'ai:template-icons', label: `instantiate ${templateName}` },
  })
}

// ── port wiring config ──────────────────────────────────────────────────────
// spec: {from:[node,port]} | {text} | {num} | {bool} | {points:[{x,y}]}
//     | {json} (text → str_to_list) | {list:{type,values}} (N consts → tree_merge)

const A = {
  scene: { from: ['tpl_abg', 'out_1'] },
  indoor: { from: ['tpl_indoor', 'out_1'] },
  seed: { from: ['tpl_seed', 'seed'] },
  grass: { text: '森林草地' },
  road: { text: '城镇土路' },
  water: { text: '清水面' },
  wall: { text: '中式高院墙山门' },
  building: { text: '中世纪红瓦房屋' },
  tree: { text: '樱花树' },
  bush: { text: '樱花树' },
  floor: { text: '地板' },
  dirt: { text: '土地' },
}

const PICK_ONE_BUILDING_PORTS = {
  in_0: { text: 'demo_house' }, in_1: A.scene, in_2: { num: 3 }, in_3: { points: [{ x: 20, y: 20 }] },
  in_4: A.building, in_5: { num: 18 }, in_6: { num: 16 }, in_14: A.seed,
}

const WIRING = {
  // AddBaseGrid is the shared base grid itself (tpl_abg) — wired in buildBase().
  AddBaseGrid: { base: true, sceneOut: 'out_1' },

  TownIslandLayout: {
    ports: { in_0: A.scene, in_1: A.road, in_2: A.seed, in_3: { num: 2 }, in_4: { num: 4 }, in_5: { text: 'organic' }, in_6: { num: 0.7 }, in_7: { num: 0.35 } },
    sceneOut: 'out_0',
  },
  FarmlandGrid: { ports: { in_0: A.scene, in_1: A.grass, in_2: A.seed }, sceneOut: 'out_0' },
  FenceFarm: { ports: { in_0: A.scene, in_1: A.grass, in_2: A.seed }, sceneOut: 'out_0' },
  ParkGenerator: { ports: { in_0: A.scene, in_1: A.grass, in_2: A.seed }, sceneOut: 'out_0' },
  ShrineLayout: { ports: { in_0: A.scene, in_1: A.grass, in_2: A.seed }, sceneOut: 'out_0' },
  BspDistrictCluster: { ports: { in_0: A.scene, in_1: A.road, in_2: A.seed }, sceneOut: 'out_0' },
  PointZoneGen: {
    ports: { in_0: A.scene, in_1: A.grass, in_2: A.seed, in_3: { text: '[[15,15,80,1],[35,35,60,1]]' } },
    sceneOut: 'out_0',
  },
  ZoneNesting: { ports: { in_0: A.scene, in_1: A.grass, in_2: A.seed }, sceneOut: 'out_0' },
  EdgeGrassClusters: { ports: { in_0: A.scene, in_1: A.grass, in_2: A.seed, in_3: { num: 0.15 } }, sceneOut: 'out_0' },
  EdgeTreeClusters: { ports: { in_0: A.scene, in_1: A.tree, in_2: A.seed, in_3: { num: 0.12 } }, sceneOut: 'out_0' },
  NaturalDecorationDistribution: { ports: { in_1: A.scene, in_2: { num: 0.06 }, in_5: A.bush, in_3: A.seed }, sceneOut: 'out_0' },
  OutdoorTextureGround: { ports: { in_0: A.scene, in_1: A.dirt, in_2: A.seed }, sceneOut: 'out_0' },
  IndoorTextureGround: { ports: { in_0: A.indoor, in_1: A.floor, in_2: A.seed }, sceneOut: 'out_0' },
  MultiLayerGround: { ports: { in_0: A.scene, in_1: A.grass, in_2: A.seed }, sceneOut: 'out_0' },
  DecorationBorder: { ports: { in_0: A.scene, in_1: A.bush, in_2: A.seed }, sceneOut: 'out_0' },
  MountainContourGenerate: { ports: { in_0: A.scene, in_1: A.dirt, in_2: A.seed, in_3: { num: 2 } }, sceneOut: 'out_0' },
  HillContourGenerate: { ports: { in_0: A.scene, in_1: A.dirt, in_2: A.seed, in_3: { num: 2 } }, sceneOut: 'out_0' },
  OrganicIslandShape: { ports: { in_0: A.scene, in_1: A.water, in_2: A.seed }, sceneOut: 'out_0' },
  RandomLakeRegions: { ports: { in_0: A.scene, in_1: A.water, in_2: A.seed }, sceneOut: 'out_0' },
  RiverLakeGen: { ports: { in_0: A.scene, in_1: A.water, in_2: A.seed }, sceneOut: 'out_0' },
  RiverSpline: {
    ports: {
      in_0: A.scene, in_1: A.water, in_2: A.seed,
      in_3: { json: '[[10,10],[25,15],[40,35]]' }, in_4: { text: 'noise' }, in_5: { num: 3 },
    },
    sceneOut: 'out_0',
  },
  PlaceMultipleDecorations: {
    ports: {
      in_0: A.scene, in_1: A.bush, in_2: { json: '[["樱花树", 1, [20, 20], [30, 30]]]' },
      in_3: { num: 3 }, in_4: { num: 5 }, in_5: A.seed,
    },
    sceneOut: 'out_0',
  },
  PoiScatter: {
    ports: { in_0: A.scene, in_1: A.bush, in_2: { text: '[{"asset":"樱花树","density":0.05}]' }, in_3: A.seed },
    sceneOut: 'out_0',
  },
  LocalPreciseDecoration: {
    ports: { in_1: A.scene, in_2: { points: [{ x: 25, y: 25 }] }, in_5: A.bush, in_3: A.seed, in_19: { num: 8 }, in_20: { num: 8 } },
    sceneOut: 'out_0',
  },
  PlaceOneDecoration: {
    ports: {
      in_1: A.scene, in_3: { points: [{ x: 25, y: 25 }] }, in_5: { num: 4 }, in_6: { num: 4 },
      in_2: { num: 2 }, in_0: { text: 'deco' }, in_4: A.bush,
    },
    sceneOut: 'out_1',
  },
  PickOneBuilding: { ports: PICK_ONE_BUILDING_PORTS, sceneOut: 'out_1' },
  BuildingStructures: {
    deps: [{ template: 'PickOneBuilding', groupId: 'bs_pick', ports: PICK_ONE_BUILDING_PORTS }],
    ports: { in_0: { from: ['bs_pick', 'out_1'] }, in_1: A.wall, in_2: A.seed },
    sceneOut: 'out_0',
  },
  DistanceZones: {
    ports: { in_0: A.scene, in_1: { num: 5 }, in_2: { bool: true }, in_3: { text: 'near' }, in_4: A.grass, in_5: { text: 'far' }, in_6: A.dirt },
    sceneOut: 'out_0',
  },
  RoomLayoutPlacer: {
    ports: {
      in_0: A.indoor, in_1: A.floor, in_2: A.seed,
      in_4: { text: '[{"rank":1,"name":"chair","w":2,"h":2},{"rank":2,"name":"table","w":3,"h":2}]' },
      in_5: { text: 'grid' },
    },
    sceneOut: 'out_0',
  },
  AdaptiveRoomFurniturePlacer: {
    ports: {
      in_0: A.indoor, in_1: A.floor, in_2: A.seed,
      in_4: { json: '[{"rank":1,"name":"书桌","furniture_id":"small_rect","type":"single","placement":"edge"},{"rank":2,"name":"椅子","furniture_id":"small_square","type":"single","placement":"edge"},{"rank":8,"name":"花瓶","furniture_id":"small_square","type":"single","placement":"center"}]' },
    },
    sceneOut: 'out_0',
  },
  AreaPartition: {
    ports: {
      in_0: A.scene,
      in_1: { list: { type: 'point2d', values: [{ x: 22, y: 20 }, { x: 40, y: 18 }, { x: 20, y: 42 }, { x: 42, y: 40 }] } },
      in_2: { list: { type: 'number', values: [3, 2, 1.5, 1] } },
      in_3: { list: { type: 'string', values: ['zone_a', 'zone_b', 'zone_c', 'zone_d'] } },
      in_4: { list: { type: 'string', values: ['森林草地', '土地', '森林草地', '土地'] } },
      in_5: A.seed,
    },
    sceneOut: 'out_0',
  },
  IslandRegions: {
    ports: {
      in_0: A.scene,
      in_1: { list: { type: 'point2d', values: [{ x: 25, y: 25 }, { x: 35, y: 30 }] } },
      in_2: { list: { type: 'number', values: [8, 6] } },
      in_3: { text: 'island' }, in_4: { text: '沙地' }, in_5: A.seed,
    },
    sceneOut: 'out_0',
  },
  PathConnection: {
    ports: {
      in_0: { text: 'main_road' }, in_1: A.road, in_2: A.scene,
      in_3: { list: { type: 'point2d', values: [{ x: 10, y: 10 }, { x: 40, y: 10 }, { x: 25, y: 40 }] } },
      in_4: { num: 2 },
    },
    sceneOut: 'out_0',
  },
  PathConnectionLink: {
    ports: {
      in_0: { text: 'link_road' }, in_1: A.road, in_2: A.scene,
      in_3: { list: { type: 'point2d', values: [{ x: 10, y: 10 }, { x: 40, y: 10 }, { x: 25, y: 40 }] } },
      in_4: { num: 2 },
    },
    sceneOut: 'out_0',
  },
  PickMultiBuildings: {
    ports: {
      in_6: A.scene,
      in_5: { list: { type: 'point2d', values: [{ x: 15, y: 15 }, { x: 35, y: 35 }] } },
      in_0: { list: { type: 'number', values: [12, 12] } },
      in_1: { list: { type: 'number', values: [12, 12] } },
      in_3: { list: { type: 'number', values: [3, 3] } },
      in_4: { list: { type: 'string', values: ['中世纪红瓦房屋', '中世纪红瓦房屋'] } },
      in_13: A.seed,
    },
    sceneOut: 'out_2',
  },
}

// ── port spec → batch ops ───────────────────────────────────────────────────

function resolvePorts(groupId, ports, prefix) {
  const ops = []
  let n = 0
  const at = () => ({ x: 0, y: n++ * 40 })
  for (const [port, spec] of Object.entries(ports)) {
    const edgeId = `${prefix}_${port}`
    if (spec.from) {
      ops.push({ type: 'connect', edgeId, source: { nodeId: spec.from[0], port: spec.from[1] }, target: { nodeId: groupId, port } })
      continue
    }
    if (spec.points) {
      const id = `${prefix}_mp_${port}`
      ops.push({ type: 'createNode', nodeId: id, opId: 'manual_points', position: at(), params: { points: spec.points } })
      ops.push({ type: 'connect', edgeId, source: { nodeId: id, port: 'point' }, target: { nodeId: groupId, port } })
      continue
    }
    if (spec.text !== undefined) {
      const id = `${prefix}_t_${port}`
      ops.push({ type: 'createNode', nodeId: id, opId: 'text_panel', position: at(), params: { text: spec.text } })
      ops.push({ type: 'connect', edgeId, source: { nodeId: id, port: 'output' }, target: { nodeId: groupId, port } })
      continue
    }
    if (spec.json !== undefined) {
      const textId = `${prefix}_tj_${port}`
      const listId = `${prefix}_sl_${port}`
      ops.push({ type: 'createNode', nodeId: textId, opId: 'text_panel', position: at(), params: { text: spec.json } })
      ops.push({ type: 'createNode', nodeId: listId, opId: 'str_to_list', position: { x: 120, y: (n - 1) * 40 }, params: {} })
      ops.push({ type: 'connect', edgeId: `${edgeId}_t`, source: { nodeId: textId, port: 'output' }, target: { nodeId: listId, port: 'str' } })
      ops.push({ type: 'connect', edgeId, source: { nodeId: listId, port: 'list' }, target: { nodeId: groupId, port } })
      continue
    }
    if (spec.num !== undefined) {
      const id = `${prefix}_n_${port}`
      ops.push({ type: 'createNode', nodeId: id, opId: 'number_const', position: at(), params: { value: spec.num } })
      ops.push({ type: 'connect', edgeId, source: { nodeId: id, port: 'value' }, target: { nodeId: groupId, port } })
      continue
    }
    if (spec.bool !== undefined) {
      const id = `${prefix}_b_${port}`
      ops.push({ type: 'createNode', nodeId: id, opId: 'toggle', position: at(), params: { value: spec.bool } })
      ops.push({ type: 'connect', edgeId, source: { nodeId: id, port: 'value' }, target: { nodeId: groupId, port } })
      continue
    }
    if (spec.list) {
      const { type, values } = spec.list
      const opId = type === 'number' ? 'number_const' : type === 'string' ? 'text_panel' : 'manual_points'
      const outPort = type === 'number' ? 'value' : type === 'string' ? 'output' : 'point'
      const baseY = n++ * 40
      const itemIds = values.map((v, i) => {
        const id = `${prefix}_l_${port}_${i}`
        const params = type === 'number' ? { value: v } : type === 'string' ? { text: String(v) } : { points: [v] }
        ops.push({ type: 'createNode', nodeId: id, opId, position: { x: 0, y: baseY + i * 30 }, params })
        return id
      })
      const mergeId = `${prefix}_m_${port}`
      ops.push({
        type: 'createNode', nodeId: mergeId, opId: 'tree_merge', position: { x: 140, y: baseY },
        params: { inferredAccess: 'item', inferredType: type, portCount: values.length },
      })
      itemIds.forEach((id, i) => ops.push({
        type: 'connect', edgeId: `${edgeId}_${i}`,
        source: { nodeId: id, port: outPort }, target: { nodeId: mergeId, port: `item_${i}` },
      }))
      ops.push({ type: 'connect', edgeId, source: { nodeId: mergeId, port: 'tree' }, target: { nodeId: groupId, port } })
      continue
    }
    throw new Error(`unknown port spec for ${groupId}.${port}: ${JSON.stringify(spec)}`)
  }
  return ops
}

// ── template discovery ──────────────────────────────────────────────────────

function findTemplates() {
  const out = []
  ;(function walk(dir) {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, ent.name)
      if (ent.isDirectory()) walk(full)
      else if (ent.name.endsWith('.json') && !ent.name.startsWith('_')) {
        out.push({ name: basename(ent.name, '.json'), jsonPath: full, relDir: dirname(relative(TEMPLATE_ROOT, full)) })
      }
    }
  })(TEMPLATE_ROOT)
  const sorted = out.sort((a, b) => a.name.localeCompare(b.name))
  const only = process.env.ONLY_TEMPLATES?.split(',').map((s) => s.trim()).filter(Boolean)
  return only?.length ? sorted.filter((t) => only.includes(t.name)) : sorted
}

const groupIdFor = (name) => (name === 'AddBaseGrid' ? 'tpl_abg' : `tpl_${name.toLowerCase()}`)

// ── build ───────────────────────────────────────────────────────────────────

async function buildBase() {
  await batch([
    { type: 'createNode', nodeId: 'tpl_empty', opId: 'empty_scene', position: { x: -1400, y: 0 }, params: {} },
    { type: 'createNode', nodeId: 'tpl_seed', opId: 'seed_control', position: { x: -1400, y: 200 }, params: { seed: 42 } },
    { type: 'createNode', nodeId: 'base_name', opId: 'text_panel', position: { x: -1400, y: 320 }, params: { text: 'ground' } },
    { type: 'createNode', nodeId: 'base_w', opId: 'number_const', position: { x: -1400, y: 440 }, params: { value: GRID } },
    { type: 'createNode', nodeId: 'base_h', opId: 'number_const', position: { x: -1400, y: 560 }, params: { value: GRID } },
    { type: 'createNode', nodeId: 'base_asset', opId: 'text_panel', position: { x: -1400, y: 680 }, params: { text: '沙地' } },
    { type: 'createNode', nodeId: 'indoor_empty', opId: 'empty_scene', position: { x: -1400, y: 900 }, params: {} },
    { type: 'createNode', nodeId: 'indoor_name', opId: 'text_panel', position: { x: -1400, y: 1020 }, params: { text: 'room' } },
    { type: 'createNode', nodeId: 'indoor_w', opId: 'number_const', position: { x: -1400, y: 1140 }, params: { value: 24 } },
    { type: 'createNode', nodeId: 'indoor_h', opId: 'number_const', position: { x: -1400, y: 1260 }, params: { value: 24 } },
    { type: 'createNode', nodeId: 'indoor_asset', opId: 'text_panel', position: { x: -1400, y: 1380 }, params: { text: '地板' } },
  ], 'base sources')

  await instantiate('AddBaseGrid', 'tpl_abg', { x: -1000, y: 0 })
  await instantiate('AddBaseGrid', 'tpl_indoor', { x: -1000, y: 900 })

  await batch([
    { type: 'connect', edgeId: 'e_empty_abg', source: { nodeId: 'tpl_empty', port: 'scene' }, target: { nodeId: 'tpl_abg', port: 'in_0' } },
    { type: 'connect', edgeId: 'e_name_abg', source: { nodeId: 'base_name', port: 'output' }, target: { nodeId: 'tpl_abg', port: 'in_1' } },
    { type: 'connect', edgeId: 'e_w_abg', source: { nodeId: 'base_w', port: 'value' }, target: { nodeId: 'tpl_abg', port: 'in_2' } },
    { type: 'connect', edgeId: 'e_h_abg', source: { nodeId: 'base_h', port: 'value' }, target: { nodeId: 'tpl_abg', port: 'in_3' } },
    { type: 'connect', edgeId: 'e_asset_abg', source: { nodeId: 'base_asset', port: 'output' }, target: { nodeId: 'tpl_abg', port: 'in_4' } },
    { type: 'connect', edgeId: 'e_seed_abg', source: { nodeId: 'tpl_seed', port: 'seed' }, target: { nodeId: 'tpl_abg', port: 'in_8' } },
    { type: 'connect', edgeId: 'e_indoor_empty', source: { nodeId: 'indoor_empty', port: 'scene' }, target: { nodeId: 'tpl_indoor', port: 'in_0' } },
    { type: 'connect', edgeId: 'e_indoor_name', source: { nodeId: 'indoor_name', port: 'output' }, target: { nodeId: 'tpl_indoor', port: 'in_1' } },
    { type: 'connect', edgeId: 'e_indoor_w', source: { nodeId: 'indoor_w', port: 'value' }, target: { nodeId: 'tpl_indoor', port: 'in_2' } },
    { type: 'connect', edgeId: 'e_indoor_h', source: { nodeId: 'indoor_h', port: 'value' }, target: { nodeId: 'tpl_indoor', port: 'in_3' } },
    { type: 'connect', edgeId: 'e_indoor_asset', source: { nodeId: 'indoor_asset', port: 'output' }, target: { nodeId: 'tpl_indoor', port: 'in_4' } },
    { type: 'connect', edgeId: 'e_indoor_seed', source: { nodeId: 'tpl_seed', port: 'seed' }, target: { nodeId: 'tpl_indoor', port: 'in_8' } },
  ], 'base grids')
}

async function buildTemplates(templates) {
  const built = []
  let col = 0
  for (const tmpl of templates) {
    const wiring = WIRING[tmpl.name]
    if (!wiring) { built.push({ tmpl, error: '无接线配置' }); continue }
    const groupId = groupIdFor(tmpl.name)
    const prefix = `w_${tmpl.name.toLowerCase()}`
    const pos = { x: 200 + (col % 6) * 420, y: Math.floor(col / 6) * 700 }
    col++
    try {
      if (!wiring.base) await instantiate(tmpl.name, groupId, pos)
      const ops = []
      for (const dep of wiring.deps ?? []) {
        await instantiate(dep.template, dep.groupId, { x: pos.x - 200, y: pos.y + 300 })
        ops.push(...resolvePorts(dep.groupId, dep.ports, `${prefix}_dep`))
      }
      ops.push(...resolvePorts(groupId, wiring.ports ?? {}, prefix))
      await batch(ops, `wire ${tmpl.name}`)
      built.push({ tmpl, groupId, scenePort: wiring.sceneOut ?? 'out_0' })
      console.log(`[build] ✓ ${tmpl.name}`)
    } catch (e) {
      built.push({ tmpl, error: String(e.message ?? e) })
      console.log(`[build] ✗ ${tmpl.name}: ${e.message ?? e}`)
    }
  }
  return built
}

// ── capture ─────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function cropToContent(inPath, outPath, tolerance = 8) {
  const img = await loadImage(inPath)
  const w = img.width, h = img.height
  const full = createCanvas(w, h)
  const ctx = full.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const { data } = ctx.getImageData(0, 0, w, h)
  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const a = data[i + 3]
      const bg = a === 0 || (data[i] <= tolerance && data[i + 1] <= tolerance && data[i + 2] <= tolerance)
      if (!bg) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  const cw = maxX - minX + 1, ch = maxY - minY + 1
  const out = createCanvas(cw, ch)
  out.getContext('2d').drawImage(full, minX, minY, cw, ch, 0, 0, cw, ch)
  writeFileSync(outPath, out.toBuffer('image/png'))
  return { w: cw, h: ch }
}

async function captureAll(built) {
  await batch([{ type: 'createNode', nodeId: 'out_preview', opId: 'scene_output', position: { x: -1800, y: -400 }, params: {} }], 'preview output')
  await api('PATCH', '/api/v1/agent/renderer/view-mode', { mode: 'billboard' })

  const results = []
  let wired = false
  for (const b of built) {
    if (b.error) { results.push({ name: b.tmpl.name, status: 'fail', reason: b.error }); continue }
    try {
      const ops = wired ? [{ type: 'deleteEdge', edgeId: 'e_preview' }] : []
      ops.push({ type: 'connect', edgeId: 'e_preview', source: { nodeId: b.groupId, port: b.scenePort }, target: { nodeId: 'out_preview', port: 'scene' } })
      await batch(ops, `preview ${b.tmpl.name}`)
      wired = true

      const exec = await api('POST', `/api/v1/projects/${PROJECT}/execute`, { nodeId: 'out_preview' })
      if (exec.status !== 'completed') {
        results.push({ name: b.tmpl.name, status: 'fail', reason: `execute status=${exec.status}` })
        console.log(`[capture] ✗ ${b.tmpl.name}: execute ${exec.status}`)
        continue
      }
      await sleep(Number(process.env.SETTLE_MS ?? 2500))
      const shot = await api('POST', '/api/v1/agent/screenshot/capture', { timeout: 20000 })
      const iconPath = join(dirname(b.tmpl.jsonPath), 'icon.png')
      const cropped = await cropToContent(shot.path, iconPath)
      if (!cropped) {
        results.push({ name: b.tmpl.name, status: 'fail', reason: '截图全为背景色（渲染器无内容）' })
        console.log(`[capture] ✗ ${b.tmpl.name}: blank`)
        continue
      }
      results.push({ name: b.tmpl.name, status: 'pass', size: `${cropped.w}x${cropped.h}`, relDir: b.tmpl.relDir })
      console.log(`[capture] ✓ ${b.tmpl.name} → ${cropped.w}x${cropped.h}`)
    } catch (e) {
      results.push({ name: b.tmpl.name, status: 'fail', reason: String(e.message ?? e) })
      console.log(`[capture] ✗ ${b.tmpl.name}: ${e.message ?? e}`)
    }
  }

  // scene_output is a capture-only terminal; leaving it would make Preview render
  // whichever template happened to be wired last.
  await batch([{ type: 'deleteNode', nodeId: 'out_preview' }], 'drop preview output')
  return results
}

// ── main ────────────────────────────────────────────────────────────────────

const wantBuild = process.argv.includes('--build') || !process.argv.includes('--capture')
const wantCapture = process.argv.includes('--capture') || !process.argv.includes('--build')

const templates = findTemplates()
console.log(`[template-icons] project=${PROJECT} templates=${templates.length}`)

await api('POST', `/api/v1/projects/${PROJECT}/view`, {})

let built
if (wantBuild) {
  await buildBase()
  built = await buildTemplates(templates)
} else {
  built = templates.map((tmpl) => {
    const w = WIRING[tmpl.name]
    return w ? { tmpl, groupId: groupIdFor(tmpl.name), scenePort: w.sceneOut ?? 'out_0' } : { tmpl, error: '无接线配置' }
  })
}

if (wantCapture) {
  const results = await captureAll(built)
  const pass = results.filter((r) => r.status === 'pass')
  const fail = results.filter((r) => r.status === 'fail')
  console.log(`\n[template-icons] ${pass.length}/${results.length} captured`)
  fail.forEach((r) => console.log(`  ✗ ${r.name}: ${r.reason}`))
}
process.exit(0)
