// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "algRegionClusterScatter",
  "contractVersion": "1.0.0",
  "opId": "alg_region_cluster_scatter",
  "description": "Cluster scatter fill in density or count mode. mode=density (default) picks ~targetCount/6 centers and scatters within radius with distance-decaying probability (1-dist/(R+1))*density*2, stopping at density×validCells; mode=count fills an exact number: score each covered valid cell as (1-dist/(R+1))+rng()*0.2 and take the top count in descending order (fillClusterCount). clusterRadius controls spread radius. Usable for patchy vegetation, ore veins, rubble piles.",
  "inputs": [
    {
      "name": "region",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "0/1 (or multi-valued) constraint region grid; points only land on non-zero valid cells.",
      "label": "输入区域"
    },
    {
      "name": "density",
      "type": "number",
      "defaultValue": 0.3,
      "description": "Target fill density (fraction of valid cells), 0..1. Also drives the number of centers (~targetCount/6) and spread strength.",
      "label": "目标密度",
      "mode": "parameter"
    },
    {
      "name": "mode",
      "type": "string",
      "defaultValue": "density",
      "description": "density = probabilistic scatter by density (default, backward compatible); count = exact-count by cluster score ranking.",
      "label": "填充模式",
      "mode": "parameter"
    },
    {
      "name": "count",
      "type": "number",
      "defaultValue": 0,
      "description": "count mode: exact number of cells selected (clamped to valid cells).",
      "label": "目标格数",
      "mode": "parameter"
    },
    {
      "name": "clusterRadius",
      "type": "number",
      "defaultValue": 4,
      "description": "Spread radius (cells) of each cluster center. Larger radius makes looser, larger clumps.",
      "label": "簇半径",
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
      "name": "region",
      "type": "grid",
      "access": "item",
      "description": "A 0/1 point mask matching the input shape; chosen cells = 1, others = 0.",
      "label": "散布网格"
    },
    {
      "name": "count",
      "type": "number",
      "access": "item",
      "description": "Number of cells actually selected as 1.",
      "label": "选中格数"
    }
  ],
  "deterministic": true
})
