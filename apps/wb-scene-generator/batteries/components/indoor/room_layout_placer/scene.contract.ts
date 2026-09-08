// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "roomLayoutPlacer",
  "contractVersion": "2.0.0",
  "opId": "room_layout_placer",
  "description": "All-in-one indoor furniture placer with four layout modes on a single room grid, with built-in rank split. Grid: auto-infer grid from room size. Nested: corner subzone + remainder. Symmetric: mirror furniture along axes. OneOpen: reserve one side empty. Mode-specific params via layoutConfig JSON string. Grid lists are handled per-item by the DataTree engine.",
  "inputs": [
    {
      "name": "roomGrid",
      "type": "grid",
      "access": "item",
      "description": "Single room grid: 1=available, 0=wall/unavailable. The engine fans out a grid list one-by-one, pairing doorGrid per branch.",
      "label": "房间网格"
    },
    {
      "name": "doorGrid",
      "type": "grid",
      "access": "item",
      "description": "Door grid: 1=door cell, reserves corridor space (optional); paired with roomGrid per branch.",
      "label": "门位置网格"
    },
    {
      "name": "furnitureList",
      "type": "array",
      "description": "Full furniture list with rank/name/furniture_id/type/placement. Rank 1-7 → main, rank 8-9 → fill (auto-split, broadcast to every grid).",
      "label": "家具清单"
    },
    {
      "name": "layoutMode",
      "type": "string",
      "access": "item",
      "defaultValue": "grid",
      "description": "Layout mode: 'grid' (classroom/office), 'nested' (palace/warehouse), 'symmetric' (temple/hall), 'one_open' (courtyard/corridor/gallery).",
      "label": "布局模式",
      "options": [
        "grid",
        "nested",
        "symmetric",
        "one_open"
      ],
      "mode": "parameter"
    },
    {
      "name": "layoutConfig",
      "type": "string",
      "access": "item",
      "defaultValue": "{}",
      "description": "Mode-specific config JSON string. See LAYOUT_CONFIG_SKILL.md.",
      "label": "布局自定义配置",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "access": "item",
      "defaultValue": 0,
      "description": "Unified random seed; 0 uses current timestamp. Placer/filler seeds are auto-derived internally.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "access": "item",
      "description": "Merged furniture mask grid after all placements.",
      "label": "家具实体网格"
    },
    {
      "name": "nameList",
      "type": "array",
      "access": "item",
      "description": "Deduplicated furniture name list [{id, name, type}].",
      "label": "家具名称清单"
    },
    {
      "name": "furnitureIndex",
      "type": "array",
      "access": "item",
      "description": "Full furniture index for debugging.",
      "label": "家具编号列表"
    }
  ],
  "deterministic": true
})
