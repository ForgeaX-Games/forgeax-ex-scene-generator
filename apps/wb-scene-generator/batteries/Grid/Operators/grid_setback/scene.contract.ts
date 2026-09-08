// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gridSetback",
  "contractVersion": "2.1.1",
  "opId": "grid_setback",
  "description": "Randomly selects 0–4 edges on the input grid and applies a random setback, outputting the processed grid.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "access": "item",
      "description": "Grid to apply setback to; multi-grid batching is handled by the dispatcher fanout.",
      "label": "输入网格"
    },
    {
      "name": "variation",
      "type": "number",
      "access": "item",
      "required": false,
      "defaultValue": 0,
      "description": "Optional per-grid variation, added to seed; wire in seed_control or a list of numbers so each grid in a batch gets a different setback. Defaults to 0.",
      "label": "逐网格变化量",
      "mode": "parameter"
    },
    {
      "name": "intensity",
      "type": "number",
      "defaultValue": 0.5,
      "description": "Setback intensity (0–1); 0 keeps original probabilities, 1 heavily skews toward more edges and larger setback amounts.",
      "label": "退线强度",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed (integer); 0 uses the current timestamp for a different result each run; any non-zero value produces a fixed output.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "access": "item",
      "description": "Grid after setback processing.",
      "label": "退线网格"
    }
  ],
  "deterministic": true
})
