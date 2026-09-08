// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "algRegionDilate",
  "contractVersion": "1.0.0",
  "opId": "alg_region_dilate",
  "description": "Morphological dilation of a region by N BFS steps: the foreground (non-zero cells) is expanded outward by steps rings, emitting a 0/1 region of the same shape. connectivity=4 uses orthogonal 4-neighbors (diamond growth), 8 includes diagonals (square growth). A generalization of lake_gen's spacing-buffer expansion; usable for forbidden zones, buffers, outline thickening, region fattening, etc.",
  "inputs": [
    {
      "name": "region",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "0/1 (or multi-valued) region grid; non-zero cells are foreground and get dilated outward.",
      "label": "输入区域"
    },
    {
      "name": "steps",
      "type": "number",
      "defaultValue": 1,
      "description": "Number of dilation steps / radius (BFS rings). 0 means no dilation (output normalized 0/1 as-is).",
      "label": "膨胀步数",
      "mode": "parameter"
    },
    {
      "name": "connectivity",
      "type": "number",
      "defaultValue": 4,
      "description": "4 = orthogonal (diamond growth), 8 = with diagonals (square growth). Default 4.",
      "label": "邻接方式",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "region",
      "type": "grid",
      "access": "item",
      "description": "Dilated 0/1 region grid; same shape as the input.",
      "label": "膨胀区域"
    }
  ],
  "deterministic": true
})
