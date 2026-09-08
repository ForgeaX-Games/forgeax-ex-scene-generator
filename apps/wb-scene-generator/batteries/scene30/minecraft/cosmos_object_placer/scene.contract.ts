// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "cosmosObjectPlacer",
  "contractVersion": "1.1.0",
  "opId": "cosmos_object_placer",
  "description": "Generates decoration, resource, structure, and enemy placement data based on terrain and zone grids.",
  "inputs": [
    {
      "name": "terrainGrid",
      "type": "array",
      "defaultValue": [],
      "description": "Terrain grid list (from cosmos_terrain_variation.variedGridList); multiple single-value grids, merged internally into one terrain grid.",
      "label": "地形网格列表"
    },
    {
      "name": "zoneGrid",
      "type": "array",
      "defaultValue": [],
      "description": "Zone grid list (from cosmos_zone_marker.zoneGridList, optional); values 100/200/300 = structure/crystal/ancient zones; merged internally.",
      "label": "区域网格列表（可选）"
    },
    {
      "name": "planetType",
      "type": "string",
      "defaultValue": "lush",
      "description": "Determines decoration, resource, and enemy type pools.",
      "label": "星球类型",
      "options": [
        "lush",
        "desert",
        "frozen",
        "volcanic",
        "toxic",
        "barren"
      ],
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed; 0 uses current timestamp.",
      "label": "随机种子",
      "mode": "parameter"
    },
    {
      "name": "decorDensity",
      "type": "number",
      "defaultValue": 0.15,
      "description": "Decoration density multiplier.",
      "label": "装饰密度",
      "mode": "parameter"
    },
    {
      "name": "resourceMultiplier",
      "type": "number",
      "defaultValue": 0.34,
      "description": "Resource node spawn probability multiplier.",
      "label": "资源倍率",
      "mode": "parameter"
    },
    {
      "name": "enemyDensity",
      "type": "number",
      "defaultValue": 1,
      "description": "Enemy count multiplier per chunk.",
      "label": "敌人密度",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "objectNameList",
      "type": "array",
      "description": "Standard name list, one entry per object type {id, name, type:\"asset\", height}; aligned 1-to-1 with objectGridList.",
      "label": "对象名称清单"
    },
    {
      "name": "objectGridList",
      "type": "array",
      "description": "Per-type single-value grid list aligned with objectNameList; 1=object present at cell, 0=absent.",
      "label": "对象网格列表"
    }
  ],
  "deterministic": true
})
