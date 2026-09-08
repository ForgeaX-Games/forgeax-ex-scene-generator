#!/usr/bin/env node
/**
 * Verify all batteries/templates, generate icon.png (809×500), build master project.
 * Each template block has its own scene_output; executeNode({ nodeId }) runs only that closure.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve, basename, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { applyBatch, executeNode, listNodes, getNodeOutput } from '@forgeax/node-runtime'
import { splitTemplate, buildTemplateOps } from '../backend/src/lib/templateOps.ts'
import { getProjectRegistry } from '../backend/src/runtime.ts'
import { renderToPng } from '../frontend/src/renderer/server/renderToPng.ts'
import { flattenWireList } from '../frontend/src/renderer/bridge/flattenWire.ts'
import { setServerImageResolver } from '../frontend/src/renderer/framework/asset/imageCache.ts'
import { matchAssetEntry } from '../frontend/src/renderer/framework/asset/matchAssetEntry.ts'

const here = dirname(fileURLToPath(import.meta.url))
const APP_ROOT = resolve(here, '..')
const TEMPLATE_ROOT = join(APP_ROOT, 'batteries', 'templates')
const PROJECT_NAME = 'template-thumbnail-verify'
const THUMB_W = 809
const THUMB_H = 500
const GRID = 50

// ── declarative port wiring ─────────────────────────────────────────────────
// port value: { from:[node,port] } | { text } | { num } | { bool } | { points:[{x,y}] }

const A = {
  scene: { from: ['tpl_abg', 'out_1'] },
  indoor: { from: ['tpl_indoor', 'out_1'] },
  seed: { from: ['tpl_seed', 'seed'] },
  grass: { text: '草地' },
  road: { text: '土路' },
  water: { text: '水面' },
  wall: { text: '院墙' },
  building: { text: '房屋' },
  tree: { text: '树木' },
  bush: { text: '灌木' },
  floor: { text: '木地板' },
  dirt: { text: '泥土' },
}

/** @type {Record<string, { ports?: Record<string, object>, sceneOut?: string, custom?: (ctx: object) => { ops: object[], connects: object[] } }>} */
const WIRING = {
  AddBaseGrid: {
    sceneOut: 'out_1',
    custom: ({ groupId }) => ({
      ops: [],
      connects: [
        { type: 'connect', edgeId: 'e_abg_in0', source: { nodeId: 'tpl_empty', port: 'scene' }, target: { nodeId: groupId, port: 'in_0' } },
        { type: 'connect', edgeId: 'e_abg_name', source: { nodeId: 'base_name', port: 'output' }, target: { nodeId: groupId, port: 'in_1' } },
        { type: 'connect', edgeId: 'e_abg_w', source: { nodeId: 'base_w', port: 'value' }, target: { nodeId: groupId, port: 'in_2' } },
        { type: 'connect', edgeId: 'e_abg_h', source: { nodeId: 'base_h', port: 'value' }, target: { nodeId: groupId, port: 'in_3' } },
        { type: 'connect', edgeId: 'e_abg_asset', source: { nodeId: 'base_asset', port: 'output' }, target: { nodeId: groupId, port: 'in_4' } },
        { type: 'connect', edgeId: 'e_abg_seed', source: { nodeId: 'tpl_seed', port: 'seed' }, target: { nodeId: groupId, port: 'in_8' } },
      ],
    }),
  },
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
    ports: {
      in_0: A.scene, in_1: A.grass, in_2: A.seed,
      in_3: { text: '[[15,15,80,1],[35,35,60,1]]' },
    },
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
      in_3: { json: '[[10,10],[25,15],[40,35]]' },
      in_4: { text: 'noise' }, in_5: { num: 3 },
    },
    sceneOut: 'out_0',
  },
  PoiPlace: {
    ports: {
      in_0: A.scene, in_1: A.bush,
      in_2: { json: '[["灌木", 1, [20, 20], [30, 30]]]' },
      in_3: { num: 3 }, in_4: { num: 5 }, in_5: A.seed,
    },
    sceneOut: 'out_0',
  },
  PoiScatter: {
    ports: { in_0: A.scene, in_1: A.bush, in_2: { text: '[{"asset":"灌木","density":0.05}]' }, in_3: A.seed },
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
  PickOneBuilding: {
    ports: {
      in_0: { text: 'demo_house' }, in_1: A.scene, in_2: { num: 3 }, in_3: { points: [{ x: 20, y: 20 }] },
      in_4: A.building, in_5: { num: 18 }, in_6: { num: 16 }, in_14: A.seed,
    },
    sceneOut: 'out_1',
  },
  BuildingStructures: {
    sceneOut: 'out_0',
    custom: ({ groupId, prefix }) => {
      const pk = `${prefix}_pk`
      const pkPath = templateJsonPath('PickOneBuilding')
      const { built: pkBuilt } = instantiateOps(pkPath, pk, 0, 0)
      const pkWire = resolvePorts(pk, {
        in_0: { text: 'demo_house' }, in_1: A.scene, in_2: { num: 3 }, in_3: { points: [{ x: 20, y: 20 }] },
        in_4: A.building, in_5: { num: 18 }, in_6: { num: 16 }, in_14: A.seed,
      }, `${prefix}_pk`)
      const bsWire = resolvePorts(groupId, { in_0: { from: [pk, 'out_1'] }, in_1: A.wall, in_2: A.seed }, `${prefix}_bs`)
      return { ops: [...pkBuilt.ops, ...pkWire.ops, ...bsWire.ops], connects: [...pkWire.connects, ...bsWire.connects] }
    },
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
      in_4: {
        json: '[{"rank":1,"name":"书桌","furniture_id":"small_rect","type":"single","placement":"edge"},{"rank":2,"name":"椅子","furniture_id":"small_square","type":"single","placement":"edge"},{"rank":8,"name":"花瓶","furniture_id":"small_square","type":"single","placement":"center"}]',
      },
    },
    sceneOut: 'out_0',
  },
  AreaPartition: {
    sceneOut: 'out_0',
    custom: ({ groupId, prefix }) => {
      const ops = []
      const connects = []
      const pts = [[22, 20], [40, 18], [20, 42], [42, 40]]
      const ptIds = pts.map((p, i) => {
        const id = `${prefix}_pt${i}`
        ops.push({ type: 'createNode', nodeId: id, opId: 'manual_points', position: { x: 0, y: i * 30 }, params: { points: [{ x: p[0], y: p[1] }] } })
        return id
      })
      const mPts = `${prefix}_mpts`
      ops.push({ type: 'createNode', nodeId: mPts, opId: 'tree_merge', position: { x: 100, y: 0 }, params: { inferredAccess: 'item', inferredType: 'point2d', portCount: 4 } })
      ptIds.forEach((id, i) => connects.push({ type: 'connect', edgeId: `${prefix}_pt${i}`, source: { nodeId: id, port: 'point' }, target: { nodeId: mPts, port: `item_${i}` } }))
      const areas = [3, 2, 1.5, 1]
      const areaIds = areas.map((v, i) => {
        const id = `${prefix}_ar${i}`
        ops.push({ type: 'createNode', nodeId: id, opId: 'number_const', position: { x: 0, y: 200 + i * 30 }, params: { value: v } })
        return id
      })
      const mAreas = `${prefix}_marea`
      ops.push({ type: 'createNode', nodeId: mAreas, opId: 'tree_merge', position: { x: 100, y: 200 }, params: { inferredAccess: 'item', inferredType: 'number', portCount: 4 } })
      areaIds.forEach((id, i) => connects.push({ type: 'connect', edgeId: `${prefix}_ar${i}`, source: { nodeId: id, port: 'value' }, target: { nodeId: mAreas, port: `item_${i}` } }))
      const names = ['zone_a', 'zone_b', 'zone_c', 'zone_d']
      const nameIds = names.map((t, i) => {
        const id = `${prefix}_zn${i}`
        ops.push({ type: 'createNode', nodeId: id, opId: 'text_panel', position: { x: 0, y: 400 + i * 30 }, params: { text: t } })
        return id
      })
      const mNames = `${prefix}_mnames`
      ops.push({ type: 'createNode', nodeId: mNames, opId: 'tree_merge', position: { x: 100, y: 400 }, params: { inferredAccess: 'item', inferredType: 'string', portCount: 4 } })
      nameIds.forEach((id, i) => connects.push({ type: 'connect', edgeId: `${prefix}_zn${i}`, source: { nodeId: id, port: 'output' }, target: { nodeId: mNames, port: `item_${i}` } }))
      const tiles = ['草地', '泥土', '草地', '泥土']
      const tileIds = tiles.map((t, i) => {
        const id = `${prefix}_ta${i}`
        ops.push({ type: 'createNode', nodeId: id, opId: 'text_panel', position: { x: 0, y: 600 + i * 30 }, params: { text: t } })
        return id
      })
      const mTiles = `${prefix}_mtiles`
      ops.push({ type: 'createNode', nodeId: mTiles, opId: 'tree_merge', position: { x: 100, y: 600 }, params: { inferredAccess: 'item', inferredType: 'string', portCount: 4 } })
      tileIds.forEach((id, i) => connects.push({ type: 'connect', edgeId: `${prefix}_ta${i}`, source: { nodeId: id, port: 'output' }, target: { nodeId: mTiles, port: `item_${i}` } }))
      connects.push(
        { type: 'connect', edgeId: `${prefix}_sc`, source: { nodeId: 'tpl_abg', port: 'out_1' }, target: { nodeId: groupId, port: 'in_0' } },
        { type: 'connect', edgeId: `${prefix}_pts`, source: { nodeId: mPts, port: 'tree' }, target: { nodeId: groupId, port: 'in_1' } },
        { type: 'connect', edgeId: `${prefix}_areas`, source: { nodeId: mAreas, port: 'tree' }, target: { nodeId: groupId, port: 'in_2' } },
        { type: 'connect', edgeId: `${prefix}_names`, source: { nodeId: mNames, port: 'tree' }, target: { nodeId: groupId, port: 'in_3' } },
        { type: 'connect', edgeId: `${prefix}_tiles`, source: { nodeId: mTiles, port: 'tree' }, target: { nodeId: groupId, port: 'in_4' } },
        { type: 'connect', edgeId: `${prefix}_seed`, source: { nodeId: 'tpl_seed', port: 'seed' }, target: { nodeId: groupId, port: 'in_5' } },
      )
      return { ops, connects }
    },
  },
  IslandRegions: {
    sceneOut: 'out_0',
    custom: ({ groupId, prefix }) => {
      const ops = []
      const connects = []
      const anchors = [{ x: 25, y: 25 }, { x: 35, y: 30 }]
      const ptIds = anchors.map((p, i) => {
        const id = `${prefix}_anc${i}`
        ops.push({ type: 'createNode', nodeId: id, opId: 'manual_points', position: { x: 0, y: i * 40 }, params: { points: [p] } })
        return id
      })
      const mAnc = `${prefix}_manc`
      ops.push({ type: 'createNode', nodeId: mAnc, opId: 'tree_merge', position: { x: 100, y: 0 }, params: { inferredAccess: 'item', inferredType: 'point2d', portCount: 2 } })
      ptIds.forEach((id, i) => connects.push({ type: 'connect', edgeId: `${prefix}_anc${i}`, source: { nodeId: id, port: 'point' }, target: { nodeId: mAnc, port: `item_${i}` } }))
      const sizes = [8, 6].map((v, i) => {
        const id = `${prefix}_sz${i}`
        ops.push({ type: 'createNode', nodeId: id, opId: 'number_const', position: { x: 0, y: 100 + i * 30 }, params: { value: v } })
        return id
      })
      const mSz = `${prefix}_msz`
      ops.push({ type: 'createNode', nodeId: mSz, opId: 'tree_merge', position: { x: 100, y: 100 }, params: { inferredAccess: 'item', inferredType: 'number', portCount: 2 } })
      sizes.forEach((id, i) => connects.push({ type: 'connect', edgeId: `${prefix}_sz${i}`, source: { nodeId: id, port: 'value' }, target: { nodeId: mSz, port: `item_${i}` } }))
      ops.push(
        { type: 'createNode', nodeId: `${prefix}_iname`, opId: 'text_panel', position: { x: 0, y: 180 }, params: { text: 'island' } },
        { type: 'createNode', nodeId: `${prefix}_iasset`, opId: 'text_panel', position: { x: 0, y: 220 }, params: { text: '草地' } },
      )
      connects.push(
        { type: 'connect', edgeId: `${prefix}_sc`, source: { nodeId: 'tpl_abg', port: 'out_1' }, target: { nodeId: groupId, port: 'in_0' } },
        { type: 'connect', edgeId: `${prefix}_pts`, source: { nodeId: mAnc, port: 'tree' }, target: { nodeId: groupId, port: 'in_1' } },
        { type: 'connect', edgeId: `${prefix}_szs`, source: { nodeId: mSz, port: 'tree' }, target: { nodeId: groupId, port: 'in_2' } },
        { type: 'connect', edgeId: `${prefix}_iname`, source: { nodeId: `${prefix}_iname`, port: 'output' }, target: { nodeId: groupId, port: 'in_3' } },
        { type: 'connect', edgeId: `${prefix}_iasset`, source: { nodeId: `${prefix}_iasset`, port: 'output' }, target: { nodeId: groupId, port: 'in_4' } },
        { type: 'connect', edgeId: `${prefix}_seed`, source: { nodeId: 'tpl_seed', port: 'seed' }, target: { nodeId: groupId, port: 'in_5' } },
      )
      return { ops, connects }
    },
  },
  PathConnection: {
    sceneOut: 'out_0',
    custom: ({ groupId, prefix }) => {
      const w = poiWire(groupId, prefix, [{ x: 10, y: 10 }, { x: 40, y: 10 }, { x: 25, y: 40 }], '土路')
      w.connects.push(
        { type: 'connect', edgeId: `${prefix}_rw`, source: { nodeId: `${prefix}_n_in_4`, port: 'value' }, target: { nodeId: groupId, port: 'in_4' } },
        { type: 'connect', edgeId: `${prefix}_rn`, source: { nodeId: `${prefix}_t_in_0`, port: 'output' }, target: { nodeId: groupId, port: 'in_0' } },
      )
      w.ops.push(
        { type: 'createNode', nodeId: `${prefix}_n_in_4`, opId: 'number_const', position: { x: 0, y: 240 }, params: { value: 2 } },
        { type: 'createNode', nodeId: `${prefix}_t_in_0`, opId: 'text_panel', position: { x: 0, y: 280 }, params: { text: 'main_road' } },
      )
      return w
    },
  },
  PathConnectionLink: {
    sceneOut: 'out_0',
    custom: ({ groupId, prefix }) => {
      const w = poiWire(groupId, prefix, [{ x: 10, y: 10 }, { x: 40, y: 10 }, { x: 25, y: 40 }], '土路')
      w.ops.push(
        { type: 'createNode', nodeId: `${prefix}_n_in_4`, opId: 'number_const', position: { x: 0, y: 240 }, params: { value: 2 } },
        { type: 'createNode', nodeId: `${prefix}_t_in_0`, opId: 'text_panel', position: { x: 0, y: 280 }, params: { text: 'link_road' } },
      )
      w.connects.push(
        { type: 'connect', edgeId: `${prefix}_rw`, source: { nodeId: `${prefix}_n_in_4`, port: 'value' }, target: { nodeId: groupId, port: 'in_4' } },
        { type: 'connect', edgeId: `${prefix}_rn`, source: { nodeId: `${prefix}_t_in_0`, port: 'output' }, target: { nodeId: groupId, port: 'in_0' } },
      )
      return w
    },
  },
  PickMultiBuildings: {
    sceneOut: 'out_2',
    custom: ({ groupId, prefix }) => {
      const ops = []
      const connects = []
      const mkList = (values, type, baseY, port) => {
        const ids = values.map((v, i) => {
          const id = `${prefix}_${port}${i}`
          if (type === 'num') ops.push({ type: 'createNode', nodeId: id, opId: 'number_const', position: { x: 0, y: baseY + i * 30 }, params: { value: v } })
          else ops.push({ type: 'createNode', nodeId: id, opId: 'text_panel', position: { x: 0, y: baseY + i * 30 }, params: { text: String(v) } })
          return id
        })
        const mid = `${prefix}_m_${port}`
        ops.push({ type: 'createNode', nodeId: mid, opId: 'tree_merge', position: { x: 100, y: baseY }, params: { inferredAccess: 'item', inferredType: type === 'num' ? 'number' : 'string', portCount: values.length } })
        ids.forEach((id, i) => connects.push({ type: 'connect', edgeId: `${prefix}_${port}${i}`, source: { nodeId: id, port: type === 'num' ? 'value' : 'output' }, target: { nodeId: mid, port: `item_${i}` } }))
        return mid
      }
      const pts = [{ x: 15, y: 15 }, { x: 35, y: 35 }]
      const ptIds = pts.map((p, i) => {
        const id = `${prefix}_bp${i}`
        ops.push({ type: 'createNode', nodeId: id, opId: 'manual_points', position: { x: 0, y: i * 40 }, params: { points: [p] } })
        return id
      })
      const mPts = `${prefix}_mbp`
      ops.push({ type: 'createNode', nodeId: mPts, opId: 'tree_merge', position: { x: 80, y: 0 }, params: { inferredAccess: 'item', inferredType: 'point2d', portCount: 2 } })
      ptIds.forEach((id, i) => connects.push({ type: 'connect', edgeId: `${prefix}_bp${i}`, source: { nodeId: id, port: 'point' }, target: { nodeId: mPts, port: `item_${i}` } }))
      const mW = mkList([12, 12], 'num', 120, 'w')
      const mH = mkList([12, 12], 'num', 200, 'h')
      const mA = mkList(['房屋', '房屋'], 'str', 280, 'a')
      const mBh = mkList([3, 3], 'num', 360, 'bh')
      connects.push(
        { type: 'connect', edgeId: `${prefix}_sc`, source: { nodeId: 'tpl_abg', port: 'out_1' }, target: { nodeId: groupId, port: 'in_6' } },
        { type: 'connect', edgeId: `${prefix}_pts`, source: { nodeId: mPts, port: 'tree' }, target: { nodeId: groupId, port: 'in_5' } },
        { type: 'connect', edgeId: `${prefix}_ws`, source: { nodeId: mW, port: 'tree' }, target: { nodeId: groupId, port: 'in_0' } },
        { type: 'connect', edgeId: `${prefix}_hs`, source: { nodeId: mH, port: 'tree' }, target: { nodeId: groupId, port: 'in_1' } },
        { type: 'connect', edgeId: `${prefix}_as`, source: { nodeId: mA, port: 'tree' }, target: { nodeId: groupId, port: 'in_4' } },
        { type: 'connect', edgeId: `${prefix}_bhs`, source: { nodeId: mBh, port: 'tree' }, target: { nodeId: groupId, port: 'in_3' } },
        { type: 'connect', edgeId: `${prefix}_seed`, source: { nodeId: 'tpl_seed', port: 'seed' }, target: { nodeId: groupId, port: 'in_13' } },
      )
      return { ops, connects }
    },
  },
}

function poiWire(groupId, prefix, points, roadAsset) {
  const ops = []
  const connects = []
  const ptIds = points.map((p, i) => {
    const id = `${prefix}_poi${i}`
    ops.push({ type: 'createNode', nodeId: id, opId: 'manual_points', position: { x: 0, y: i * 40 }, params: { points: [p] } })
    return id
  })
  const mPoi = `${prefix}_mpoi`
  ops.push({ type: 'createNode', nodeId: mPoi, opId: 'tree_merge', position: { x: 100, y: 0 }, params: { inferredAccess: 'item', inferredType: 'point2d', portCount: points.length } })
  ptIds.forEach((id, i) => connects.push({ type: 'connect', edgeId: `${prefix}_poi${i}`, source: { nodeId: id, port: 'point' }, target: { nodeId: mPoi, port: `item_${i}` } }))
  const assetId = `${prefix}_road`
  ops.push({ type: 'createNode', nodeId: assetId, opId: 'text_panel', position: { x: 0, y: 200 }, params: { text: roadAsset } })
  connects.push(
    { type: 'connect', edgeId: `${prefix}_sc`, source: { nodeId: 'tpl_abg', port: 'out_1' }, target: { nodeId: groupId, port: 'in_2' } },
    { type: 'connect', edgeId: `${prefix}_pois`, source: { nodeId: mPoi, port: 'tree' }, target: { nodeId: groupId, port: 'in_3' } },
    { type: 'connect', edgeId: `${prefix}_road`, source: { nodeId: assetId, port: 'output' }, target: { nodeId: groupId, port: 'in_1' } },
  )
  return { ops, connects }
}

function resolvePorts(groupId, ports, prefix) {
  const ops = []
  const connects = []
  let n = 0
  for (const [port, spec] of Object.entries(ports)) {
    if (spec.from) {
      connects.push({ type: 'connect', edgeId: `${prefix}_${port}`, source: { nodeId: spec.from[0], port: spec.from[1] }, target: { nodeId: groupId, port } })
      continue
    }
    if (spec.points) {
      const id = `${prefix}_mp_${port}`
      ops.push({ type: 'createNode', nodeId: id, opId: 'manual_points', position: { x: 0, y: n++ * 40 }, params: { points: spec.points } })
      connects.push({ type: 'connect', edgeId: `${prefix}_${port}`, source: { nodeId: id, port: 'point' }, target: { nodeId: groupId, port } })
      continue
    }
    if (spec.text !== undefined) {
      const id = `${prefix}_t_${port}`
      ops.push({ type: 'createNode', nodeId: id, opId: 'text_panel', position: { x: 0, y: n++ * 40 }, params: { text: spec.text } })
      connects.push({ type: 'connect', edgeId: `${prefix}_${port}`, source: { nodeId: id, port: 'output' }, target: { nodeId: groupId, port } })
      continue
    }
    if (spec.json !== undefined) {
      const textId = `${prefix}_tj_${port}`
      const listId = `${prefix}_sl_${port}`
      ops.push({ type: 'createNode', nodeId: textId, opId: 'text_panel', position: { x: 0, y: n++ * 40 }, params: { text: spec.json } })
      ops.push({ type: 'createNode', nodeId: listId, opId: 'str_to_list', position: { x: 120, y: (n - 1) * 40 }, params: {} })
      connects.push(
        { type: 'connect', edgeId: `${prefix}_${port}_t`, source: { nodeId: textId, port: 'output' }, target: { nodeId: listId, port: 'str' } },
        { type: 'connect', edgeId: `${prefix}_${port}`, source: { nodeId: listId, port: 'list' }, target: { nodeId: groupId, port } },
      )
      continue
    }
    if (spec.num !== undefined) {
      const id = `${prefix}_n_${port}`
      ops.push({ type: 'createNode', nodeId: id, opId: 'number_const', position: { x: 0, y: n++ * 40 }, params: { value: spec.num } })
      connects.push({ type: 'connect', edgeId: `${prefix}_${port}`, source: { nodeId: id, port: 'value' }, target: { nodeId: groupId, port } })
      continue
    }
    if (spec.bool !== undefined) {
      const id = `${prefix}_b_${port}`
      ops.push({ type: 'createNode', nodeId: id, opId: 'toggle', position: { x: 0, y: n++ * 40 }, params: { value: spec.bool } })
      connects.push({ type: 'connect', edgeId: `${prefix}_${port}`, source: { nodeId: id, port: 'value' }, target: { nodeId: groupId, port } })
      continue
    }
  }
  return { ops, connects }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function findTemplates({ filterOnly = true } = {}) {
  const out = []
  function walk(dir) {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, ent.name)
      if (ent.isDirectory()) walk(full)
      else if (ent.name.endsWith('.json') && !ent.name.startsWith('_')) {
        const name = basename(ent.name, '.json')
        if (name === ent.name.replace('.json', '')) out.push({ name, jsonPath: full, relDir: dirname(relative(TEMPLATE_ROOT, full)) })
      }
    }
  }
  walk(TEMPLATE_ROOT)
  const sorted = out.sort((a, b) => a.name.localeCompare(b.name))
  // Prefer scene/ > general/ > structures/ when the same template name appears twice.
  const rank = (relDir) => (relDir.startsWith('scene') ? 0 : relDir.startsWith('general') ? 1 : 2)
  const byName = new Map()
  for (const t of sorted) {
    const prev = byName.get(t.name)
    if (!prev || rank(t.relDir) < rank(prev.relDir)) byName.set(t.name, t)
  }
  const unique = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
  const only = process.env.ONLY_TEMPLATES?.split(',').map((s) => s.trim()).filter(Boolean)
  return filterOnly && only?.length ? unique.filter((t) => only.includes(t.name)) : unique
}

async function executeWithTimeout(rt, nodeId, ms = 180_000) {
  const { done } = await executeNode(rt, { nodeId })
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`execute timeout ${ms}ms`)), ms)
  })
  try {
    return await Promise.race([done, timeout])
  } finally {
    clearTimeout(timer)
  }
}

const templatePathCache = new Map()
function findTemplateRelPath(name) {
  if (templatePathCache.has(name)) return templatePathCache.get(name)
  const t = findTemplates({ filterOnly: false }).find((x) => x.name === name)
  if (!t) throw new Error(`template not found: ${name}`)
  const parts = t.relDir.split(/[/\\]/).filter(Boolean)
  templatePathCache.set(name, parts)
  return parts
}
function templateJsonPath(name) {
  return join(TEMPLATE_ROOT, ...findTemplateRelPath(name), `${name}.json`)
}

function loadTemplate(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function instantiateOps(jsonPath, groupId, x, y) {
  const split = splitTemplate(loadTemplate(jsonPath))
  if (!split) throw new Error(`splitTemplate failed: ${jsonPath}`)
  const built = buildTemplateOps(split.root, split.deps, { x, y }, groupId)
  return { built, split }
}

function buildSharedBaseOps() {
  const ops = [
    { type: 'createNode', nodeId: 'tpl_empty', opId: 'empty_scene', position: { x: -1400, y: 0 }, params: {} },
    { type: 'createNode', nodeId: 'tpl_seed', opId: 'seed_control', position: { x: -1400, y: 200 }, params: { seed: 42 } },
    { type: 'createNode', nodeId: 'base_name', opId: 'text_panel', position: { x: -1400, y: 320 }, params: { text: 'ground' } },
    { type: 'createNode', nodeId: 'base_w', opId: 'number_const', position: { x: -1400, y: 440 }, params: { value: GRID } },
    { type: 'createNode', nodeId: 'base_h', opId: 'number_const', position: { x: -1400, y: 560 }, params: { value: GRID } },
    { type: 'createNode', nodeId: 'base_asset', opId: 'text_panel', position: { x: -1400, y: 680 }, params: { text: '草地' } },
    { type: 'createNode', nodeId: 'indoor_empty', opId: 'empty_scene', position: { x: -1400, y: 900 }, params: {} },
    { type: 'createNode', nodeId: 'indoor_name', opId: 'text_panel', position: { x: -1400, y: 1020 }, params: { text: 'room' } },
    { type: 'createNode', nodeId: 'indoor_w', opId: 'number_const', position: { x: -1400, y: 1140 }, params: { value: 24 } },
    { type: 'createNode', nodeId: 'indoor_h', opId: 'number_const', position: { x: -1400, y: 1260 }, params: { value: 24 } },
    { type: 'createNode', nodeId: 'indoor_asset', opId: 'text_panel', position: { x: -1400, y: 1380 }, params: { text: '木地板' } },
  ]
  const { built: abg } = instantiateOps(templateJsonPath('AddBaseGrid'), 'tpl_abg', -1000, 0)
  const { built: indoor } = instantiateOps(templateJsonPath('AddBaseGrid'), 'tpl_indoor', -1000, 900)
  ops.push(...abg.ops, ...indoor.ops)
  ops.push(
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
  )
  return ops
}

function buildTemplateBlock(tmpl, index) {
  const name = tmpl.name
  const wiring = WIRING[name]
  if (!wiring) return { error: `无接线配置（请在 WIRING 中补充）` }
  const prefix = `w_${name.toLowerCase()}`
  const groupId = name === 'AddBaseGrid' ? 'tpl_abg' : `tpl_${name.toLowerCase()}`
  const y = index * 80
  const x = 200 + (index % 6) * 320
  const outputId = `out_${name}`
  const ops = []
  const connects = []

  if (name !== 'AddBaseGrid') {
    const { built } = instantiateOps(tmpl.jsonPath, groupId, x, y)
    ops.push(...built.ops)
  }

  let wired
  if (wiring.custom) {
    wired = wiring.custom({ groupId, prefix, name })
  } else {
    wired = resolvePorts(groupId, wiring.ports ?? {}, prefix)
  }
  ops.push(...wired.ops, ...wired.connects)

  const scenePort = wiring.sceneOut ?? 'out_0'
  ops.push(
    { type: 'createNode', nodeId: outputId, opId: 'scene_output', position: { x: x + 400, y }, params: {} },
    { type: 'connect', edgeId: `${prefix}_2out`, source: { nodeId: groupId, port: scenePort }, target: { nodeId: outputId, port: 'scene' } },
  )
  return { name, groupId, outputId, ops, scenePort }
}

function shapeLayers(nodeId, voxelLayers, names) {
  const nameById = new Map(names.map((n) => [n.id, n]))
  const now = Date.now()
  return voxelLayers.map((l) => {
    const nm = nameById.get(l.value)
    return {
      key: `${nodeId}:${l.nodePath}`, nodeId, nodePath: l.nodePath, nodeName: l.nodeName,
      value: l.value, schema: l.schema, cells: l.cells, visible: true, updatedAt: now,
      assetName: nm?.name ?? '', assetType: nm?.type,
    }
  })
}

async function layersFromOutput(rt, outputId) {
  const voxelLayers = flattenWireList(getNodeOutput(rt, outputId, 'layers'))
  const names = flattenWireList(getNodeOutput(rt, outputId, 'names'))
  return shapeLayers(outputId, voxelLayers, names)
}

function countVoxels(layers) {
  return layers.reduce((s, l) => s + (Array.isArray(l.cells) ? l.cells.length : 0), 0)
}

async function renderThumb(layers, projectDir) {
  const { listMergedAliasMetasAllZonesForProjectDir, resolveMergedAssetContentForProjectDir } = await import('../backend/src/library/mergedLibraryPool.ts')
  const { loadImage } = await import('../frontend/node_modules/@napi-rs/canvas/index.js')
  const aliasMetas = listMergedAliasMetasAllZonesForProjectDir(projectDir)
  const imageByAlias = new Map()
  for (const layer of layers) {
    const match = matchAssetEntry({ assetName: layer.assetName, assetType: layer.assetType }, aliasMetas, false)
    if (!match) continue
    for (const alias of match.variants) {
      if (imageByAlias.has(alias)) continue
      const content = await resolveMergedAssetContentForProjectDir(projectDir, alias)
      if (!content) continue
      imageByAlias.set(alias, await loadImage(content.bytes))
    }
  }
  setServerImageResolver((alias) => imageByAlias.get(alias) ?? null)
  return renderToPng(layers, {
    mode: 'topBillboard', drawMode: 'asset', width: THUMB_W, height: THUMB_H, background: '#000',
    aliases: aliasMetas,
  })
}

function resetProjectGraph(rt, projectId) {
  const ts = new Date().toISOString()
  rt.graph.save({
    schemaVersion: 1,
    id: projectId,
    createdAt: ts,
    updatedAt: ts,
    nodes: {},
    edges: {},
  })
}

async function ensureVerifyProject(reg) {
  const existing = reg.listProjects().find((p) => p.name === PROJECT_NAME)
  if (existing) return existing.id
  const meta = await reg.createProject({ name: PROJECT_NAME, type: 'scene' })
  return meta.id
}

async function main() {
  console.log('[verify-templates] start')
  const templates = findTemplates()
  console.log(`[verify-templates] ${templates.length} templates`)

  const reg = await getProjectRegistry()
  const projectId = await ensureVerifyProject(reg)
  reg.viewProject(projectId)
  const rt = reg.getRuntimeFor(projectId)
  resetProjectGraph(rt, projectId)
  const { getProjectDir } = await import('../backend/src/runtime.ts')
  const projectDir = await getProjectDir(projectId)

  const allOps = [...buildSharedBaseOps()]
  const blocks = []
  for (let i = 0; i < templates.length; i++) {
    const block = buildTemplateBlock(templates[i], i)
    if (block.error) {
      blocks.push({ tmpl: templates[i], error: block.error })
      continue
    }
    allOps.push(...block.ops)
    blocks.push({ tmpl: templates[i], ...block })
  }

  console.log(`[verify-templates] applyBatch ${allOps.length} ops…`)
  const batch = await applyBatch(rt, allOps, { actor: 'ai:verify', label: 'template-thumbnail-verify' })
  if (batch.status !== 'ok') {
    console.error('[verify-templates] applyBatch failed:', batch.reason, batch)
    process.exit(1)
  }

  // Pre-run base grids once
  await (await executeNode(rt, { nodeId: 'tpl_abg' })).done
  await (await executeNode(rt, { nodeId: 'tpl_indoor' })).done

  const results = []
  for (const block of blocks) {
    const { tmpl, outputId } = block
    if (block.error) {
      results.push({ name: tmpl.name, status: 'fail', reason: block.error })
      continue
    }
    const iconPath = join(dirname(tmpl.jsonPath), 'icon.png')
    if (existsSync(iconPath) && !process.env.FORCE_THUMBS) {
      results.push({ name: tmpl.name, status: 'pass', voxels: -1, iconPath, relDir: tmpl.relDir, skipped: true })
      console.log(`[verify-templates] ↷ ${tmpl.name} (已有 icon.png，跳过)`)
      continue
    }
    try {
      const exec = await executeWithTimeout(rt, outputId)
      if (exec.status !== 'completed') {
        results.push({ name: tmpl.name, status: 'fail', reason: `execute status=${exec.status}` })
        continue
      }
      const layers = await layersFromOutput(rt, outputId)
      const voxels = countVoxels(layers)
      if (voxels === 0) {
        results.push({ name: tmpl.name, status: 'fail', reason: 'scene_output 无体素（接线不完整或静默空跑）' })
        continue
      }
      const png = await renderThumb(layers, projectDir)
      const iconPath = join(dirname(tmpl.jsonPath), 'icon.png')
      writeFileSync(iconPath, png)
      results.push({ name: tmpl.name, status: 'pass', voxels, iconPath, relDir: tmpl.relDir })
      console.log(`[verify-templates] ✓ ${tmpl.name} (${voxels} voxels)`)
    } catch (e) {
      results.push({ name: tmpl.name, status: 'fail', reason: String(e.message ?? e) })
      console.log(`[verify-templates] ✗ ${tmpl.name}: ${e.message ?? e}`)
    }
  }

  const passed = results.filter((r) => r.status === 'pass')
  const failed = results.filter((r) => r.status === 'fail')
  const reportPath = join(TEMPLATE_ROOT, 'TEMPLATE_VERIFY_REPORT.md')
  const projectPath = join(APP_ROOT, '.forgeax-runtime/projects', projectId)
  writeFileSync(reportPath, [
    '# Template 验证与缩略图报告', '',
    `生成时间：${new Date().toISOString()}`, '',
    `## 项目位置`, '',
    `- **名称**：\`${PROJECT_NAME}\``, `- **ID**：\`${projectId}\``,
    `- **路径**：\`${projectPath}\``, '',
    '在 Scene Generator 中通过项目列表打开 `template-thumbnail-verify`。',
    '每个 template 有独立 `out_<TemplateName>` 节点；切换 Preview 可改接任意 export 链末端。', '',
    '## 摘要', '',
    `| 总计 | 通过 | 失败 |`, `|------|------|------|`,
    `| ${results.length} | ${passed.length} | ${failed.length} |`, '',
    '## 通过', '',
    '| Template | 体素 | 缩略图 |',
    '|----------|------|--------|',
    ...passed.map((r) => `| ${r.name} | ${r.voxels} | \`${r.relDir}/icon.png\` |`),
    '', '## 失败', '',
    ...(failed.length ? ['| Template | 原因 |', '|----------|------|', ...failed.map((r) => `| ${r.name} | ${r.reason} |`)] : ['_无_']),
    '',
  ].join('\n'))

  console.log(`\n[verify-templates] done: ${passed.length}/${results.length} passed`)
  console.log(`  report: ${reportPath}`)
  console.log(`  project: ${projectPath}`)
  if (failed.length) failed.forEach((r) => console.log(`  ✗ ${r.name}: ${r.reason}`))
}

main().catch((e) => { console.error(e); process.exit(1) })
