// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "seed",
  "contractVersion": "1.1.0",
  "opId": "seed_control",
  "description": "Unified random seed control. Passes a seed number through unchanged for driving multiple downstream random nodes.",
  "inputs": [
    {
      "name": "seed",
      "type": "number",
      "access": "item",
      "defaultValue": 0,
      "description": "Random seed value; 0 uses default seed.",
      "label": "种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "seed",
      "type": "number",
      "access": "item",
      "description": "Pass-through seed value, same as input.",
      "label": "种子"
    }
  ],
  "deterministic": true
})
