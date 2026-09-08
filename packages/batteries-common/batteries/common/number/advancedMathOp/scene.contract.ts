// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "advancedMathOp",
  "contractVersion": "1.0.0",
  "opId": "advanced_math_op",
  "description": "Perform advanced math operations: sqrt, cbrt, floor, ceil, round, min, max, log.",
  "inputs": [
    {
      "name": "a",
      "type": "number",
      "access": "item",
      "defaultValue": 0,
      "description": "First operand; unary operations (sqrt/cbrt/floor/ceil/round) use only this value.",
      "label": "数字 A",
      "mode": "parameter"
    },
    {
      "name": "b",
      "type": "number",
      "access": "item",
      "defaultValue": 1,
      "description": "Second operand; ignored for unary operations; used as base for log.",
      "label": "数字 B",
      "mode": "parameter"
    },
    {
      "name": "op",
      "type": "string",
      "access": "tree",
      "defaultValue": "sqrt",
      "description": "Select the operation to perform.",
      "label": "运算",
      "options": [
        "sqrt",
        "cbrt",
        "floor",
        "ceil",
        "round",
        "min",
        "max",
        "log"
      ],
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "result",
      "type": "number",
      "access": "item",
      "description": "Computation result.",
      "label": "结果"
    }
  ],
  "deterministic": true
})
