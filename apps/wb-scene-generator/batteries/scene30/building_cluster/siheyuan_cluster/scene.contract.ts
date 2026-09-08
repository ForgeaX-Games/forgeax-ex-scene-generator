// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "siheyuanCluster",
  "contractVersion": "1.0.0",
  "opId": "siheyuan_cluster",
  "description": "Generates a traditional Siheyuan courtyard layout: an outer wall flush with the region's outer boundary, with N courtyards (进) stacked along the depth. Each courtyard is formed by horizontal house bands (main hall / halls / reverse house, spanning the courtyard width) + left/right vertical wing rooms + a corridor ring around the open courtyard connecting them. House count = 3 x courtyards + 1; courtyards=1 is the standard Siheyuan (4 houses). Outputs a merged multi-value grid, a list of house grids, the wall grid, the corridor grid, and a name list. Coordinates: x->column, y->row.",
  "inputs": [
    {
      "name": "region",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "Region grid; the wall is flush with the outer boundary of its non-zero bounding box (full grid if empty). The courtyard layout fills inside.",
      "label": "输入区域"
    },
    {
      "name": "courtyards",
      "type": "number",
      "access": "item",
      "defaultValue": 1,
      "description": "Number of courtyards along the depth. House count = 3 x courtyards + 1 (courtyards=1 is the standard 4-house Siheyuan).",
      "label": "进数(院落数)",
      "mode": "parameter"
    },
    {
      "name": "wallThk",
      "type": "number",
      "access": "item",
      "defaultValue": 1,
      "description": "Wall thickness in cells. Default 1.",
      "label": "围墙厚度",
      "mode": "parameter"
    },
    {
      "name": "hallDepth",
      "type": "number",
      "access": "item",
      "defaultValue": 4,
      "description": "Depth (rows) of the horizontal house bands. Default 4; auto-shrinks if it does not fit.",
      "label": "房屋进深",
      "mode": "parameter"
    },
    {
      "name": "wingWidth",
      "type": "number",
      "access": "item",
      "defaultValue": 4,
      "description": "Width (columns) of the vertical wing rooms. Default 4; auto-narrows to keep an open courtyard.",
      "label": "厢房宽度",
      "mode": "parameter"
    },
    {
      "name": "corridorThk",
      "type": "number",
      "access": "item",
      "defaultValue": 1,
      "description": "Width of the corridor ring around the open courtyard; 0 = no corridor. Default 1.",
      "label": "围廊宽度",
      "mode": "parameter"
    },
    {
      "name": "gateWidth",
      "type": "number",
      "access": "item",
      "defaultValue": 2,
      "description": "Gate opening width in the bottom wall; 0 = fully enclosed. Default 2.",
      "label": "院门宽度",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "access": "item",
      "description": "Merged multi-value grid: each house an increasing id, plus one value each for corridor and wall; pipe to grid_split_by_value.",
      "label": "合并网格"
    },
    {
      "name": "houses",
      "type": "grid",
      "access": "list",
      "description": "One 0/1 grid (same shape as region) per house, ordered main hall -> halls -> reverse house -> each courtyard's west/east wings.",
      "label": "房屋列表"
    },
    {
      "name": "wall",
      "type": "grid",
      "access": "item",
      "description": "Wall 0/1 grid, flush with the outer boundary (with the optional gate opening).",
      "label": "围墙网格"
    },
    {
      "name": "corridor",
      "type": "grid",
      "access": "item",
      "description": "Corridor 0/1 grid, ringing each courtyard to connect the surrounding houses.",
      "label": "围廊网格"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "access": "item",
      "description": "Name list [{id,name,type}]; houses are type:'tile', plus corridor/wall entries.",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
