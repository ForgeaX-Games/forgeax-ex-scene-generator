// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "algRegionUniformBsp",
  "contractVersion": "1.0.0",
  "opId": "alg_region_uniform_bsp",
  "description": "Recursively partitions a region's bounding box via BSP (Binary Space Partition), cutting at a uniformly-sampled position across the whole splittable range (the cut lands in [base+minSize, end-minSize-pathWidth]) and leaving a pathWidth-wide channel between the two halves. Each BSP leaf rectangle is emitted as its own 0/1 grid (in generation order: depth-first, a-before-b); the inter-leaf channels and clipped corners are merged into one gap grid. Horizontal cut requires h≥minSize*2+pathWidth, vertical cut requires w≥minSize*2+pathWidth; a rectangle becomes a leaf when neither cut is possible or maxDepth is reached.",
  "inputs": [
    {
      "name": "region",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "0/1 (or multi-valued) constraint region grid; leaves fall only on non-zero valid cells.",
      "label": "输入区域"
    },
    {
      "name": "minSize",
      "type": "number",
      "defaultValue": 4,
      "description": "Minimum leaf edge length along either axis (in cells), minimum 1. Sets the split threshold: an axis is splittable only when its size ≥ minSize*2+pathWidth.",
      "label": "最小边长",
      "mode": "parameter"
    },
    {
      "name": "pathWidth",
      "type": "number",
      "defaultValue": 1,
      "description": "Channel width (in cells) left between the two halves of each split, minimum 0. Channel cells go to the gap output and belong to no leaf.",
      "label": "通道宽度",
      "mode": "parameter"
    },
    {
      "name": "maxDepth",
      "type": "number",
      "defaultValue": 6,
      "description": "Maximum BSP recursion depth; a rectangle reaching this depth becomes a leaf and is not split further.",
      "label": "最大深度",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed (drives each cut's direction and position); 0 uses the current timestamp.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "partition",
      "type": "grid",
      "access": "list",
      "description": "One 0/1 grid per BSP leaf rectangle, in generation order (depth-first, a-before-b); empty leaves clipped away by the mask are dropped.",
      "label": "叶子列表"
    },
    {
      "name": "gap",
      "type": "grid",
      "access": "item",
      "description": "A single 0/1 grid merging all inter-leaf pathWidth channels (and clipped corners); same shape as the input.",
      "label": "通道网格"
    },
    {
      "name": "count",
      "type": "number",
      "access": "item",
      "description": "Number of non-empty leaves produced.",
      "label": "叶子数"
    }
  ],
  "deterministic": true
})
