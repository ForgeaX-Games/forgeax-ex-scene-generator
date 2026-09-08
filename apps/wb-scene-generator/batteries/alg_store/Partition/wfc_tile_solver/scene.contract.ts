// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "wfcTileSolver",
  "contractVersion": "1.0.0",
  "opId": "wfc_tile_solver",
  "description": "Wave Function Collapse tile map assembler. Given tile templates and adjacency rules, generates valid tiled layouts.",
  "inputs": [
    {
      "name": "templates",
      "type": "grid",
      "description": "Array of tile templates, each an NxN 2D number grid. All templates must be the same size. If empty, uses built-in 16 dungeon tile demo (7×7, all NSEW opening combinations) (rank=1: K grids).",
      "label": "模版列表"
    },
    {
      "name": "adjacency",
      "type": "dict",
      "description": "Array of adjacency dicts (same length as templates). Each dict maps N/S/E/W to arrays of compatible template indices. If empty, uses built-in demo adjacency rules (rank=1: K dicts).",
      "label": "邻接规则"
    },
    {
      "name": "rows",
      "type": "number",
      "defaultValue": 8,
      "description": "Number of rows in the WFC grid (1~64). Output height = rows × template height.",
      "label": "行数",
      "mode": "parameter"
    },
    {
      "name": "cols",
      "type": "number",
      "defaultValue": 8,
      "description": "Number of columns in the WFC grid (1~64). Output width = cols × template width.",
      "label": "列数",
      "mode": "parameter"
    },
    {
      "name": "weights",
      "type": "number",
      "description": "Weight array (same length as templates). Higher weight = higher selection probability. If empty, all weights are equal (rank=1).",
      "label": "权重列表",
      "mode": "parameter"
    },
    {
      "name": "maxRetries",
      "type": "number",
      "defaultValue": 50,
      "description": "Maximum retry attempts when WFC hits a contradiction (1~200).",
      "label": "最大重试次数",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed; 0 uses default. Different seeds produce different layouts.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Stitched output grid, size = (rows × tileH) × (cols × tileW).",
      "label": "输出网格"
    }
  ],
  "deterministic": true
})
