// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "ringZoneScatter",
  "contractVersion": "1.0.0",
  "opId": "ring_zone_scatter",
  "description": "Places N anchor points evenly along the four border edges, each growing inward via competitive BFS to form an organic blob. Produces border-hugging zones in one step without any rotation.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Base grid used only to determine map dimensions. Output starts from zero.",
      "label": "输入网格"
    },
    {
      "name": "zoneCount",
      "type": "number",
      "defaultValue": 4,
      "description": "Number of zones evenly distributed along the four border edges. Default 4.",
      "label": "区域数量",
      "mode": "parameter"
    },
    {
      "name": "maxDepth",
      "type": "number",
      "defaultValue": 0,
      "description": "Maximum inward growth depth in cells. 0 = auto (about 20% of min dimension).",
      "label": "最大向内深度",
      "mode": "parameter"
    },
    {
      "name": "subSeeds",
      "type": "number",
      "defaultValue": 3,
      "description": "Number of sub-seeds per zone. More = richer shape. Recommended 2-5.",
      "label": "每区域子种子数",
      "mode": "parameter"
    },
    {
      "name": "gapWidth",
      "type": "number",
      "defaultValue": 3,
      "description": "Minimum gap between different zones in cells. Recommended 2-6, default 3.",
      "label": "区域间隙",
      "mode": "parameter"
    },
    {
      "name": "growProb",
      "type": "number",
      "defaultValue": 0.88,
      "description": "Base growth probability per BFS step. Default 0.88.",
      "label": "生长概率",
      "mode": "parameter"
    },
    {
      "name": "noiseAmp",
      "type": "number",
      "defaultValue": 0.15,
      "description": "Noise modulation amplitude for organic edges. Default 0.15.",
      "label": "噪声强度",
      "mode": "parameter"
    },
    {
      "name": "angleOffset",
      "type": "number",
      "defaultValue": 45,
      "description": "Rotation offset in degrees for the first anchor. Default 45 (top-right corner).",
      "label": "起始角度偏移",
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
      "name": "baseGrid",
      "type": "grid",
      "description": "Merged platform mask: 1=any zone, 0=empty.",
      "label": "区域掩码网格"
    },
    {
      "name": "regionGrid",
      "type": "grid",
      "description": "Per-zone 1-based ID grid; 0=empty.",
      "label": "区域 ID 网格"
    },
    {
      "name": "zoneCenters",
      "type": "array",
      "description": "List of zone centroid coordinates [{x, y, id}] for road planning.",
      "label": "区域中心坐标"
    }
  ],
  "deterministic": true
})
