// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "furnitureStamp",
  "contractVersion": "1.0.1",
  "opId": "furniture_stamp",
  "description": "Stamps a furniture mask into the room at the given (x, y) offset relative to the top-left of the usable room area.",
  "inputs": [
    {
      "name": "furnitureMask",
      "type": "grid",
      "description": "Furniture mask grid; 1=body, >1=sub-component, 0=aisle/border.",
      "label": "家具 mask"
    },
    {
      "name": "furnitureName",
      "type": "string",
      "defaultValue": "自定义家具",
      "description": "Furniture name string, written into the furniture index.",
      "label": "家具名称",
      "mode": "parameter"
    },
    {
      "name": "x",
      "type": "number",
      "defaultValue": 0,
      "description": "Column offset of furniture's non-zero top-left from the room's usable top-left (positive = right).",
      "label": "X 坐标（列偏移）",
      "mode": "parameter"
    },
    {
      "name": "y",
      "type": "number",
      "defaultValue": 0,
      "description": "Row offset of furniture's non-zero top-left from the room's usable top-left (positive = down).",
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
      "description": "Existing furniture index array; pass [] if none. New furniture rank = max old rank + 1.",
      "label": "旧家具编号列表"
    }
  ],
  "outputs": [
    {
      "name": "newMaskA",
      "type": "grid",
      "description": "Updated furniture body occupancy grid after stamping.",
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
      "description": "All furniture index entries (old + new); each has rank, name, isGroup.",
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
