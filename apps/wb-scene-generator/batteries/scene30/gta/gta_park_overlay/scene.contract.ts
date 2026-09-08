// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gtaParkOverlay",
  "contractVersion": "1.0.0",
  "opId": "gta_park_overlay",
  "description": "Extracts park zones (value 413) from the zone grid and outputs a parkGrid for render-layer overlay.",
  "inputs": [
    {
      "name": "zoneGrid",
      "type": "grid",
      "label": "功能区网格 (来自 gta_zones)"
    }
  ],
  "outputs": [
    {
      "name": "parkGrid",
      "type": "grid",
      "label": "公园绿地网格 (值413)"
    },
    {
      "name": "outputGrid",
      "type": "grid",
      "label": "公园预览"
    },
    {
      "name": "cellCount",
      "type": "number",
      "label": "公园格子数"
    }
  ],
  "deterministic": true
})
