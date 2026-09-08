// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "algRegionStripeSplit",
  "contractVersion": "1.0.0",
  "opId": "alg_region_stripe_split",
  "description": "Splits the valid cells inside a region's bounding box into equal-width strips along one axis (by rows or by columns), leaving a gapWidth separator between adjacent strips and an optional border ring around the outside. Each strip is emitted as its own 0/1 grid (ordered along the split axis); all gaps and the border are merged into one gap grid. direction=-1 lets the seed pick horizontal/vertical. Any non-divisible remainder is folded into one random strip.",
  "inputs": [
    {
      "name": "region",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "0/1 (or multi-valued) constraint region grid; strips fall only on non-zero valid cells.",
      "label": "输入区域"
    },
    {
      "name": "direction",
      "type": "number",
      "defaultValue": -1,
      "description": "0 = split by rows (horizontal strips), 1 = split by columns (vertical strips), -1 = seed picks the direction.",
      "label": "切分方向",
      "mode": "parameter"
    },
    {
      "name": "bandWidth",
      "type": "number",
      "defaultValue": 4,
      "description": "Thickness of each strip along the split axis (row height or column width), minimum 1.",
      "label": "条带厚度",
      "mode": "parameter"
    },
    {
      "name": "gapWidth",
      "type": "number",
      "defaultValue": 1,
      "description": "Gap thickness (in cells) between adjacent strips, minimum 0. Gap cells go to the gap output and belong to no strip.",
      "label": "间隙厚度",
      "mode": "parameter"
    },
    {
      "name": "border",
      "type": "number",
      "defaultValue": 0,
      "description": "Border ring thickness around the outside (also counted as gap), minimum 0.",
      "label": "边带圈数",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed (used only for direction=-1 and remainder assignment); 0 uses current timestamp.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "partition",
      "type": "grid",
      "access": "list",
      "description": "One 0/1 grid per strip, ordered along the split axis; empty strips (clipped away by the mask) are dropped.",
      "label": "条带列表"
    },
    {
      "name": "gap",
      "type": "grid",
      "access": "item",
      "description": "A single 0/1 grid merging all inter-strip gaps and the border ring; same shape as the input.",
      "label": "间隙网格"
    },
    {
      "name": "count",
      "type": "number",
      "access": "item",
      "description": "Number of non-empty strips produced.",
      "label": "条带数"
    }
  ],
  "deterministic": true
})
