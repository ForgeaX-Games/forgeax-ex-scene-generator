// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "furnitureGroupStamp",
  "contractVersion": "1.0.0",
  "opId": "furniture_group_stamp",
  "description": "Stamps a furniture group mask at given coordinates; each non-zero mask value maps to a group sub-component, output rank = max old rank + relative rank.",
  "inputs": [
    {
      "name": "furnitureMask",
      "type": "grid",
      "description": "Furniture group mask; non-zero value = sub-component relative rank (matching groupIndex), 0=aisle/border.",
      "label": "家具组 mask"
    },
    {
      "name": "groupIndex",
      "type": "array",
      "description": "Index of sub-components in the furniture group; each has rank (relative, matching mask value), name, isGroup.",
      "label": "家具组编号列表"
    },
    {
      "name": "x",
      "type": "number",
      "defaultValue": 0,
      "description": "Column offset of furniture non-zero top-left from the room usable top-left (positive = right).",
      "label": "X 坐标（列偏移）",
      "mode": "parameter"
    },
    {
      "name": "y",
      "type": "number",
      "defaultValue": 0,
      "description": "Row offset of furniture non-zero top-left from the room usable top-left (positive = down).",
      "label": "Y 坐标（行偏移）",
      "mode": "parameter"
    },
    {
      "name": "roomGrid",
      "type": "grid",
      "description": "Room layout grid; 1=usable cell, 0=wall/out-of-bounds.",
      "label": "室内空间网格"
    },
    {
      "name": "maskA",
      "type": "grid",
      "description": "Furniture body occupancy grid; 0=empty, non-zero=existing furniture rank.",
      "label": "家具实体网格"
    },
    {
      "name": "maskB",
      "type": "grid",
      "description": "Aisle reservation grid; 0=empty, 1=occupied.",
      "label": "过道预留网格"
    },
    {
      "name": "oldFurnitureIndex",
      "type": "array",
      "description": "Existing furniture index; pass [] if none. New rank = max old rank + relative rank.",
      "label": "旧家具编号列表"
    }
  ],
  "outputs": [
    {
      "name": "newMaskA",
      "type": "grid",
      "description": "Updated furniture body occupancy grid after stamping the group.",
      "label": "新家具实体网格"
    },
    {
      "name": "newMaskB",
      "type": "grid",
      "description": "Updated aisle reservation grid after stamping.",
      "label": "新过道预留网格"
    },
    {
      "name": "furnitureIndex",
      "type": "array",
      "description": "All furniture index entries (old + new); new rank = max old rank + relative rank, matching maskA exactly.",
      "label": "新家具编号列表"
    },
    {
      "name": "placementFailed",
      "type": "bool",
      "description": "True if collision check failed; outputs are unchanged in that case.",
      "label": "放置失败"
    },
    {
      "name": "failReason",
      "type": "string",
      "description": "Description of why placement failed; empty string on success.",
      "label": "失败原因"
    }
  ],
  "deterministic": true
})
