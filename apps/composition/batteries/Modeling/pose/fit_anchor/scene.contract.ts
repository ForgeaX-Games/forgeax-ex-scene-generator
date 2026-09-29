import { defineAtomic } from '@forgeax/scene-authoring'
export default defineAtomic({
  "functionName": "fitAnchor",
  "contractVersion": "1.0.0",
  "opId": "fit_anchor",
  "label": "锚点对齐",
  "nameEn": "Fit anchor",
  "description": "Position a rotated local anchor at a target point.",
  "inputs": [
    {
      "name": "local",
      "type": "json",
      "access": "item",
      "mode": "value",
      "defaultValue": [
        0,
        0,
        0
      ]
    },
    {
      "name": "target",
      "type": "json",
      "access": "item",
      "mode": "value",
      "defaultValue": [
        0,
        0,
        0
      ]
    },
    {
      "name": "quat",
      "type": "json",
      "access": "item",
      "mode": "value",
      "defaultValue": [
        0,
        0,
        0,
        1
      ]
    }
  ],
  "outputs": [
    {
      "name": "result",
      "type": "json",
      "access": "item",
      "label": "结果"
    }
  ],
  "deterministic": true
})
