// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "islandsPoiLayout",
  "contractVersion": "1.0.0",
  "opId": "islands_poi_layout",
  "description": "Places points of interest such as caves, ruins, and campfires, then writes their footprints back to terrain.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Island terrain with paths.",
      "label": "输入地形"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed controlling POI placement.",
      "label": "随机种子",
      "mode": "parameter"
    },
    {
      "name": "poiDensityScale",
      "type": "number",
      "defaultValue": 1,
      "description": "Multiplier for POI count.",
      "label": "POI 密度倍率",
      "mode": "parameter"
    },
    {
      "name": "minDistance",
      "type": "number",
      "defaultValue": 12,
      "description": "Minimum cell distance between POIs.",
      "label": "最小间距",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "description": "Island terrain after POI footprints are applied.",
      "label": "POI 地形"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "description": "Name list for the POI terrain.",
      "label": "名称清单"
    },
    {
      "name": "poiGrid",
      "type": "grid",
      "description": "POI grid that marks only the center point of each placed landmark.",
      "label": "POI 网格"
    },
    {
      "name": "poiNameList",
      "type": "array",
      "description": "Name list corresponding to the POI grid.",
      "label": "POI 名称清单"
    }
  ],
  "deterministic": true
})
