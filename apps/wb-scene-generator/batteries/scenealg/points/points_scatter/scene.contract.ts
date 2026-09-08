// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "algPointsScatter",
  "contractVersion": "1.0.0",
  "opId": "alg_points_scatter",
  "description": "Scatters seed points within the input region, emitted as a 0/1 point mask matching the input shape. Two modes: mode=spacing (default) randomly picks points and builds a minSpacing-step 4-connected BFS forbidden zone per point so later points keep distance, up to count points; mode=poisson uses Poisson circle distance — countMode=density places every non-conflicting cell with minDist=max(1.5, 8-density*6) (no count limit), countMode=count uses minDist=sqrt(area/(count*pi)) greedily and randomly tops up to exactly count. targetValue=0 treats any non-zero cell as valid; a non-zero value requires exact mask-ID match. Points only, no growth.",
  "inputs": [
    {
      "name": "region",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "Input 2D region grid; points are placed only on valid cells.",
      "label": "输入区域"
    },
    {
      "name": "mode",
      "type": "string",
      "defaultValue": "spacing",
      "description": "spacing = random pick + BFS forbidden zone (default, backward compatible); poisson = Poisson circle-distance scatter (replicates legacy fillPoisson).",
      "label": "撒点模式",
      "mode": "parameter"
    },
    {
      "name": "countMode",
      "type": "string",
      "defaultValue": "density",
      "description": "Only affects poisson mode: density = fill all non-conflicting cells by density (no count limit); count = place and top up to exactly count points.",
      "label": "数量模式",
      "mode": "parameter"
    },
    {
      "name": "density",
      "type": "number",
      "defaultValue": 0.3,
      "description": "Only affects poisson + density mode: 0..1, derives minDist=max(1.5, 8-density*6); higher is denser. Ignored in spacing mode.",
      "label": "泊松密度",
      "mode": "parameter"
    },
    {
      "name": "count",
      "type": "number",
      "defaultValue": 5,
      "description": "spacing mode: target number of points (fewer if constrained). poisson+count mode: exact point count (topped up to this). Ignored in poisson+density mode.",
      "label": "点数量",
      "mode": "parameter"
    },
    {
      "name": "minSpacing",
      "type": "number",
      "defaultValue": 4,
      "description": "Minimum spacing between any two points (4-connected BFS steps). 0 means non-overlap only (no duplicate cell).",
      "label": "最小间距",
      "mode": "parameter"
    },
    {
      "name": "targetValue",
      "type": "number",
      "defaultValue": 0,
      "description": "Points are placed only on cells equal to this value. 0 treats any non-zero cell as valid; a non-zero value requires exact mask-ID match.",
      "label": "目标区域值",
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
      "name": "points",
      "type": "grid",
      "access": "item",
      "description": "A 0/1 point mask matching the input shape; chosen seed cells = 1, others = 0.",
      "label": "点掩码"
    },
    {
      "name": "count",
      "type": "number",
      "access": "item",
      "description": "Number of points actually placed (may be less than count).",
      "label": "实际点数"
    }
  ],
  "deterministic": true
})
