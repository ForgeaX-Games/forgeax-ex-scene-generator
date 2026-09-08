// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "randomNumbers",
  "contractVersion": "1.0.0",
  "opId": "random_numbers",
  "description": "Generate a rank-1 sequence of random numbers with configurable range, count, and seed; supports toggling between float and integer mode.",
  "inputs": [
    {
      "name": "count",
      "type": "number",
      "access": "item",
      "defaultValue": 1,
      "description": "Number of random values to generate (auto-floored, >=0).",
      "label": "数量",
      "mode": "parameter"
    },
    {
      "name": "min",
      "type": "number",
      "access": "item",
      "defaultValue": 0,
      "description": "Minimum value of the random numbers.",
      "label": "最小值",
      "mode": "parameter"
    },
    {
      "name": "max",
      "type": "number",
      "access": "item",
      "defaultValue": 1,
      "description": "Maximum value of the random numbers.",
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
    },
    {
      "name": "integerOnly",
      "type": "boolean",
      "access": "item",
      "defaultValue": true,
      "description": "When enabled, applies Math.floor to each value so only integers are output; disable to get floating-point numbers.",
      "label": "仅输出整数",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "numbers",
      "type": "number",
      "access": "list",
      "description": "Generated rank-1 sequence of random numbers.",
      "label": "随机数列"
    }
  ],
  "deterministic": true
})
