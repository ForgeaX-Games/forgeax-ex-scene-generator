// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "randomNumber",
  "contractVersion": "1.0.0",
  "opId": "random_number",
  "description": "Generate a single random integer within a specified range; result differs on each run.",
  "inputs": [
    {
      "name": "min",
      "type": "number",
      "access": "item",
      "defaultValue": 0,
      "description": "Minimum value of the random integer (inclusive).",
      "label": "最小值",
      "mode": "parameter"
    },
    {
      "name": "max",
      "type": "number",
      "access": "item",
      "defaultValue": 100,
      "description": "Maximum value of the random integer (inclusive).",
      "label": "最大值",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "access": "item",
      "defaultValue": 0,
      "description": "Random seed (integer); 0 uses the current timestamp for a different result each run; any non-zero value produces a fixed output.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "number",
      "type": "number",
      "access": "item",
      "description": "The generated random integer.",
      "label": "随机数"
    }
  ],
  "deterministic": true
})
