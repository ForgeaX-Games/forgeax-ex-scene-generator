// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "algRegionBlockyCarve",
  "contractVersion": "1.0.0",
  "opId": "alg_region_blocky_carve",
  "description": "Carves a bounding-box-fitting blocky sub-region from the input region in two layers: layer 1 samples per-side setbacks to define an inner rectangle; layer 2 perturbs each side segment-by-segment with inward/outward offsets; the result is then proportionally rescaled to the original bbox. Useful for building footprints, block outlines, and any irregular shape with a blocky feel.",
  "inputs": [
    {
      "name": "region",
      "type": "grid",
      "required": true,
      "description": "0/1 grid; carving operates on its bounding box.",
      "label": "输入区域"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed; 0 uses current timestamp.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "region",
      "type": "grid",
      "description": "Carved 0/1 region grid; same shape as the input.",
      "label": "雕刻区域"
    }
  ],
  "deterministic": true
})
