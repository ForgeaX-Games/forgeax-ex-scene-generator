// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "algRegionBsp",
  "contractVersion": "1.0.0",
  "opId": "alg_region_bsp",
  "description": "Recursively partitions a region using BSP (Binary Space Partition); each BSP leaf is emitted as its own 0/1 grid. density controls recursion depth (0 = no split, 1 = max depth 6). A 1-cell separator row/column between leaves does not belong to any sub-region.",
  "inputs": [
    {
      "name": "region",
      "type": "grid",
      "required": true,
      "description": "0/1 region grid.",
      "label": "输入区域"
    },
    {
      "name": "density",
      "type": "number",
      "defaultValue": 0.25,
      "description": "0-1, controls BSP recursion depth (0 = no split, 1 = max depth 6).",
      "label": "切分密度",
      "mode": "parameter"
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
      "name": "partition",
      "type": "grid",
      "access": "list",
      "description": "One 0/1 grid per BSP leaf.",
      "label": "分块列表"
    },
    {
      "name": "count",
      "type": "number",
      "description": "Number of BSP leaves.",
      "label": "分块数"
    }
  ],
  "deterministic": true
})
