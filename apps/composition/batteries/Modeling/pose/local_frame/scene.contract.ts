import { defineAtomic } from '@forgeax/scene-authoring'
export default defineAtomic({
  "functionName": "localFrame",
  "contractVersion": "1.0.0",
  "opId": "local_frame",
  "label": "局部面框",
  "nameEn": "Local frame",
  "description": "Local X tangent, Y inward, Z up. Returns parent-local TRS.",
  "inputs": [
    {
      "name": "origin",
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
      "name": "normal",
      "type": "json",
      "access": "item",
      "mode": "value",
      "defaultValue": [
        0,
        1,
        0
      ]
    },
    {
      "name": "up",
      "type": "json",
      "access": "item",
      "mode": "value",
      "defaultValue": [
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
