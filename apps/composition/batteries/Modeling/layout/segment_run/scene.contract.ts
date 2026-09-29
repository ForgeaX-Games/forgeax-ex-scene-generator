import { defineAtomic } from '@forgeax/scene-authoring'
export default defineAtomic({
  "functionName": "segmentRun",
  "contractVersion": "1.0.0",
  "opId": "segment_run",
  "label": "分段排布",
  "nameEn": "Segment run",
  "description": "Divide a run into evenly sized bounded segments.",
  "inputs": [
    {
      "name": "length",
      "type": "number",
      "access": "item",
      "mode": "value",
      "defaultValue": 10
    },
    {
      "name": "maximum",
      "type": "number",
      "access": "item",
      "mode": "value",
      "defaultValue": 3
    },
    {
      "name": "minimum",
      "type": "number",
      "access": "item",
      "mode": "value",
      "defaultValue": 0
    },
    {
      "name": "gap",
      "type": "number",
      "access": "item",
      "mode": "value",
      "defaultValue": 0
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
