import { defineAtomic } from '@forgeax/scene-authoring'
export default defineAtomic({
  "functionName": "deriveSeed",
  "contractVersion": "1.0.0",
  "opId": "derive_seed",
  "label": "语义种子",
  "nameEn": "Derive seed",
  "description": "Stable random seed from a parent seed and semantic path.",
  "inputs": [
    {
      "name": "seed",
      "type": "number",
      "access": "item",
      "mode": "value",
      "defaultValue": 1
    },
    {
      "name": "path",
      "type": "string",
      "access": "item",
      "mode": "value",
      "defaultValue": "module"
    }
  ],
  "outputs": [
    {
      "name": "result",
      "type": "number",
      "access": "item",
      "label": "结果"
    }
  ],
  "deterministic": true
})
