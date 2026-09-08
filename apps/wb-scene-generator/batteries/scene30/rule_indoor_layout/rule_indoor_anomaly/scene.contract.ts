// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "ruleIndoorAnomaly",
  "contractVersion": "1.0.0",
  "opId": "rule_indoor_anomaly",
  "description": "Generates anomaly/rift zones in indoor layouts with natural, polygon, and crack shape modes.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "description": "Completed indoor layout grid.",
      "label": "输入网格"
    },
    {
      "name": "anomalyValue",
      "type": "number",
      "defaultValue": 5,
      "description": "Pixel value for anomaly zone.",
      "label": "异常区标识值",
      "mode": "parameter"
    },
    {
      "name": "sizeRatio",
      "type": "number",
      "defaultValue": 0.15,
      "description": "Anomaly area as ratio of interior (0.05-0.5).",
      "label": "异常区比例",
      "mode": "parameter"
    },
    {
      "name": "shape",
      "type": "string",
      "defaultValue": "natural",
      "description": "Shape mode: natural, polygon, or crack.",
      "label": "形态模式",
      "options": [
        "natural",
        "polygon",
        "crack"
      ],
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
      "name": "outputGrid",
      "type": "grid",
      "description": "Indoor layout grid with embedded anomaly zone.",
      "label": "输出网格"
    }
  ],
  "deterministic": true
})
