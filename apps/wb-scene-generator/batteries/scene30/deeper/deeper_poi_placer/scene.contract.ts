// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "deeperPoiPlacer",
  "contractVersion": "1.0.0",
  "opId": "deeper_poi_placer",
  "description": "Density-weighted placement of 100+ POI types on flat terrain using a density field; high-density areas create maze-like corridors, low-density areas feel open. Outputs per-type mask grids and a road grid.",
  "inputs": [
    {
      "name": "groundGrid",
      "type": "grid",
      "description": "All-1 ground grid from deeper_density_field's groundGrid output.",
      "label": "地面底图"
    },
    {
      "name": "densityGrid",
      "type": "grid",
      "description": "Density weight grid (0–100) from deeper_density_field's densityGrid output.",
      "label": "密度权重图"
    },
    {
      "name": "poiList",
      "type": "array",
      "description": "POI rules array: [{name, count, minDist}] or simplified [{name: count}] or [{name: 'count:minDist'}].",
      "label": "POI清单"
    },
    {
      "name": "globalMinDist",
      "type": "number",
      "defaultValue": 2,
      "description": "Global minimum cell distance between any two POIs across all types; smaller = denser.",
      "label": "全局最小间距",
      "mode": "parameter"
    },
    {
      "name": "densityInfluence",
      "type": "number",
      "defaultValue": 1,
      "description": "How much density field influences placement probability: 0 = uniform random, 1 = fully density-driven.",
      "label": "密度影响权重",
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
      "name": "outputGridList",
      "type": "array",
      "description": "List of single-value mask grids per POI type (number[][][]); aligned 1:1 with outputNameList.",
      "label": "POI网格列表"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "description": "Name list aligned 1:1 with outputGridList: [{id, name}].",
      "label": "POI名称清单"
    },
    {
      "name": "roadGrid",
      "type": "grid",
      "description": "Areas not covered by any POI (value=1), covered areas=0; roads emerge naturally from POI compression.",
      "label": "道路网格"
    },
    {
      "name": "mergedGrid",
      "type": "grid",
      "description": "All POIs merged into a single grid with unique ids per type; road cells retain value 1.",
      "label": "合并网格"
    },
    {
      "name": "placedCount",
      "type": "number",
      "description": "Total number of POI cells successfully placed across all types.",
      "label": "放置总数"
    }
  ],
  "deterministic": true
})
