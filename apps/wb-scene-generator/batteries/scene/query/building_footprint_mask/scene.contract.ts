// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "buildingFootprintMask",
  "contractVersion": "1.0.0",
  "opId": "building_footprint_mask",
  "description": "Extract a footprint mask grid from the focused building scene node: walk the subtree voxels and output a bbox-cropped 0/1/2 grid (0=empty, 1=occupied, 2=door). Doors default to the outer_door child; output size is the voxel union bounding box, not the node bounds canvas.",
  "inputs": [
    {
      "name": "scene",
      "type": "scene",
      "access": "item",
      "required": true,
      "description": "Scene port with focus on a single building node (or its subtree root); typically fed from scene_focus_children fanout.",
      "label": "scene"
    },
    {
      "name": "z",
      "type": "number",
      "access": "item",
      "description": "Optional: only count voxels with voxel.z equal to z; when omitted, column-project all z levels onto (x,y).",
      "label": "z 切片",
      "mode": "parameter"
    },
    {
      "name": "doorNames",
      "type": "string",
      "access": "item",
      "defaultValue": "outer_door",
      "description": "Direct child node names treated as doors, comma-separated; default outer_door.",
      "label": "门子节点名",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "exists",
      "type": "bool",
      "access": "item",
      "description": "Focus exists and the subtree has at least one voxel.",
      "label": "exists"
    },
    {
      "name": "grid",
      "type": "grid",
      "access": "item",
      "description": "Bbox-cropped 0/1/2 grid: 0=empty, 1=occupied, 2=door (door overwrites occupied).",
      "label": "占地掩码"
    },
    {
      "name": "width",
      "type": "number",
      "access": "item",
      "description": "Output grid column count (bbox width).",
      "label": "宽度"
    },
    {
      "name": "height",
      "type": "number",
      "access": "item",
      "description": "Output grid row count (bbox height).",
      "label": "高度"
    },
    {
      "name": "originX",
      "type": "number",
      "access": "item",
      "description": "Bounding-box min column in parent grid coordinates.",
      "label": "originX"
    },
    {
      "name": "originY",
      "type": "number",
      "access": "item",
      "description": "Bounding-box min row in parent grid coordinates.",
      "label": "originY"
    },
    {
      "name": "cellCount",
      "type": "number",
      "access": "item",
      "description": "Total non-zero cells in the grid.",
      "label": "非空格数"
    },
    {
      "name": "doorCount",
      "type": "number",
      "access": "item",
      "description": "Number of cells with value 2 (doors).",
      "label": "门格数"
    }
  ],
  "deterministic": true
})
