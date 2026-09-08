// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "wfcTileset",
  "contractVersion": "2.1.0",
  "opId": "wfc_tileset",
  "description": "Generates multi-value WFC tile templates (0=bg 1=wall 2=floor 3=resource 4=pillar). Outputs templates, adjacency rules, and weights ready for wfc_tile_solver.",
  "inputs": [
    {
      "name": "tileSize",
      "type": "number",
      "defaultValue": 11,
      "description": "Side length of each tile (odd, even values rounded up). Larger = bigger rooms.",
      "label": "瓦片尺寸",
      "mode": "parameter"
    },
    {
      "name": "corridorWidth",
      "type": "number",
      "defaultValue": 3,
      "description": "Width of corridor/door openings (odd). Controls passage width between rooms.",
      "label": "走廊宽度",
      "mode": "parameter"
    },
    {
      "name": "wallThickness",
      "type": "number",
      "defaultValue": 1,
      "description": "Outer wall thickness in cells. Larger = smaller rooms, thicker walls.",
      "label": "墙壁厚度",
      "mode": "parameter"
    },
    {
      "name": "pillarSize",
      "type": "number",
      "defaultValue": 2,
      "description": "Side length of pillar obstacles inside rooms.",
      "label": "柱子尺寸",
      "mode": "parameter"
    },
    {
      "name": "backgroundWeight",
      "type": "number",
      "defaultValue": 3,
      "description": "Controls map openness. 0=dense, 3=moderate, 10=very sparse. BG tile weight=bgW², room scale=1/(1+bgW×0.4).",
      "label": "背景权重",
      "mode": "parameter"
    },
    {
      "name": "irregularRatio",
      "type": "number",
      "defaultValue": 0.3,
      "description": "Proportion of irregular room variants. 0=none, 0.3=moderate (default), 1=many. Irregular variants cut rectangles from closed edges to form L-shapes.",
      "label": "不规则比例",
      "mode": "parameter"
    },
    {
      "name": "largeRoomWeight",
      "type": "number",
      "defaultValue": 2,
      "description": "Controls large room (wide-opening tiles) probability. 0=almost none, 2=moderate (default), 10=many. Large rooms form when adjacent wide-opening tiles merge floors.",
      "label": "大房间权重",
      "mode": "parameter"
    },
    {
      "name": "densityBias",
      "type": "number",
      "defaultValue": 0.5,
      "description": "0 = sparse maps (more walls/dead ends), 1 = dense maps (more corridors/crossroads).",
      "label": "密度偏好",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed; 0 uses current timestamp. Fixed seed reproduces identical layouts.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "templates",
      "type": "grid",
      "description": "Array of tile templates, each a tileSize×tileSize 2D grid (0=bg 1=wall 2=floor 3=resource 4=pillar) (rank=1: K grids).",
      "label": "模板列表"
    },
    {
      "name": "adjacency",
      "type": "dict",
      "description": "Adjacency rules array (same length as templates). Each element is {N,E,S,W} dict with arrays of compatible template indices (rank=1).",
      "label": "邻接规则"
    },
    {
      "name": "weights",
      "type": "number",
      "description": "Weight array (same length as templates). Higher weight = higher selection probability (rank=1).",
      "label": "权重列表"
    }
  ],
  "deterministic": true
})
