import { defineAtomic } from '@forgeax/scene-authoring'
export default defineAtomic({
  "functionName": "boundsRelation",
  "contractVersion": "1.0.0",
  "opId": "bounds_relation",
  "label": "包围范围关系",
  "nameEn": "Bounds relation",
  "description": "AABB broad-phase relation. Not an exact mesh collision test.",
  "inputs": [
    {
      "name": "a",
      "type": "json",
      "access": "item",
      "mode": "value",
      "required": true
    },
    {
      "name": "b",
      "type": "json",
      "access": "item",
      "mode": "value",
      "required": true
    },
    {
      "name": "tolerance",
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
