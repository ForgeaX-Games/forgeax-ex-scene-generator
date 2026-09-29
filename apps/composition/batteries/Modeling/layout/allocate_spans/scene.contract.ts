import { defineAtomic } from '@forgeax/scene-authoring'
export default defineAtomic({
  "functionName": "allocateSpans",
  "contractVersion": "1.0.0",
  "opId": "allocate_spans",
  "label": "分配跨度",
  "nameEn": "Allocate spans",
  "description": "Fit constrained spans without shrinking fixed members.",
  "inputs": [
    {
      "name": "length",
      "type": "number",
      "access": "item",
      "mode": "value",
      "defaultValue": 10
    },
    {
      "name": "spans",
      "type": "json",
      "access": "item",
      "mode": "value",
      "required": true
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
