// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "multiLayerGround",
  "contractVersion": "2.0.0",
  "opId": "multi_layer_ground",
  "description": "Generates multi-layer Perlin noise terrain within the target region of a single base grid, merged into one multi-value grid (each layer an ascending id; overlaps take the higher layer), with small-fragment filtering. The engine fans out a DataTree of grids one-by-one.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "A single base map grid (grid[y][x]); the region with the max value is filled with terrain layers. The engine fans out a DataTree of grids one-by-one.",
      "label": "基准网格"
    },
    {
      "name": "layerCount",
      "type": "number",
      "access": "item",
      "defaultValue": 4,
      "description": "Number of terrain layers; each gets an ascending id within the multi-value output grid.",
      "label": "地面层数",
      "mode": "parameter"
    },
    {
      "name": "threshold",
      "type": "number",
      "access": "item",
      "defaultValue": 0.6,
      "description": "Binarization threshold (0~1); noise values above this mark terrain for that layer.",
      "label": "二值化过滤值",
      "mode": "parameter"
    },
    {
      "name": "frequency",
      "type": "number",
      "access": "item",
      "defaultValue": 0.02,
      "description": "Perlin noise sampling frequency; lower values produce larger, smoother patches.",
      "label": "噪声频率",
      "mode": "parameter"
    },
    {
      "name": "octaves",
      "type": "number",
      "access": "item",
      "defaultValue": 3,
      "description": "Number of Perlin noise octaves; more octaves add detail.",
      "label": "噪声倍频",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "access": "item",
      "defaultValue": 0,
      "description": "Random seed; 0 uses current timestamp. Each layer gets a unique offset.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "access": "item",
      "description": "A single multi-value ground grid; each layer is an ascending id (from max(grid)+1), overlaps take the higher layer, others are 0. With a grid-list input the engine emits one per branch as a DataTree.",
      "label": "地面网格"
    },
    {
      "name": "nameList",
      "type": "array",
      "access": "item",
      "description": "Name list mapping each present layer id to a name, format [{id, name, type}], type is always 'tile'.",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
