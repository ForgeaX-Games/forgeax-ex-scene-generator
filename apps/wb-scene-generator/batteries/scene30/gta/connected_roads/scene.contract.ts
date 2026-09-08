// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "connectedRoads",
  "contractVersion": "1.0.0",
  "opId": "connected_roads",
  "description": "Divides land into zones via Voronoi growth (Dijkstra), extracts internal zone borders (excluding coastlines) as road skeletons, then dilates them to the specified width.",
  "inputs": [
    {
      "name": "landGrid",
      "type": "grid",
      "label": "陆地掩码"
    },
    {
      "name": "heightMap",
      "type": "grid",
      "description": "接入后道路沿低地生长，山地阻力大。",
      "label": "高度图（可选）"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 42,
      "label": "随机种子",
      "mode": "parameter"
    },
    {
      "name": "countryCount",
      "type": "number",
      "defaultValue": 20,
      "description": "区域越多，道路网越密集。与 worldmap_countries 参数相同。",
      "label": "区域数量",
      "mode": "parameter"
    },
    {
      "name": "roadWidth",
      "type": "number",
      "defaultValue": 1,
      "label": "道路宽度(px)",
      "mode": "parameter"
    },
    {
      "name": "warp",
      "type": "number",
      "defaultValue": 0.06,
      "label": "边界扰动",
      "mode": "parameter"
    },
    {
      "name": "relax",
      "type": "number",
      "defaultValue": 2,
      "label": "平滑次数",
      "mode": "parameter"
    },
    {
      "name": "minPatchArea",
      "type": "number",
      "defaultValue": 48,
      "label": "最小区块面积",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "roadGrid",
      "type": "grid",
      "label": "道路掩码"
    },
    {
      "name": "zoneGrid",
      "type": "grid",
      "label": "区域划分"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
