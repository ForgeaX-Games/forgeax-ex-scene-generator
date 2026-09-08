// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gtaHarborArea",
  "contractVersion": "1.0.0",
  "opId": "gta_harbor_area",
  "description": "Finds a bay-like coastline and generates a harbor basin, piers, and dock yard without creating roads.",
  "inputs": [
    {
      "name": "landGrid",
      "type": "grid",
      "label": "陆地掩码"
    },
    {
      "name": "heightMap",
      "type": "grid",
      "label": "高度图"
    },
    {
      "name": "cityRoadGrid",
      "type": "grid",
      "label": "城市道路网格"
    },
    {
      "name": "buildingGrid",
      "type": "grid",
      "label": "建筑网格"
    },
    {
      "name": "avoidMask",
      "type": "grid",
      "label": "避让掩码"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 20260608,
      "label": "随机种子",
      "mode": "parameter"
    },
    {
      "name": "pierCount",
      "type": "number",
      "defaultValue": 5,
      "label": "栈桥数量",
      "mode": "parameter"
    },
    {
      "name": "pierLength",
      "type": "number",
      "defaultValue": 74,
      "label": "栈桥长度",
      "mode": "parameter"
    },
    {
      "name": "harborWidth",
      "type": "number",
      "defaultValue": 126,
      "label": "码头宽度",
      "mode": "parameter"
    },
    {
      "name": "yardDepth",
      "type": "number",
      "defaultValue": 36,
      "label": "陆地区深度",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "harborGrid",
      "type": "grid",
      "label": "码头区域"
    },
    {
      "name": "pierGrid",
      "type": "grid",
      "label": "栈桥网格"
    },
    {
      "name": "basinGrid",
      "type": "grid",
      "label": "港池网格"
    },
    {
      "name": "yardGrid",
      "type": "grid",
      "label": "码头陆地区"
    },
    {
      "name": "harborSite",
      "type": "object",
      "label": "码头站点参数"
    },
    {
      "name": "outputGrid",
      "type": "grid",
      "label": "码头区域预览"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
