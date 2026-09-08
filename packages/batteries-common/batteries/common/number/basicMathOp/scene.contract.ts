// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "basicMathOp",
  "contractVersion": "1.0.0",
  "opId": "basic_math_op",
  "description": "Perform basic math operations on two numbers: add, subtract, multiply, divide, power, modulo, absolute value.",
  "inputs": [
    {
      "name": "a",
      "type": "number",
      "access": "item",
      "defaultValue": 0,
      "description": "First operand (abs operation uses only this value).",
      "label": "数字 A",
      "mode": "parameter"
    },
    {
      "name": "b",
      "type": "number",
      "access": "item",
      "defaultValue": 1,
      "description": "Second operand (ignored for abs operation).",
      "label": "数字 B",
      "mode": "parameter"
    },
    {
      "name": "op",
      "type": "string",
      "access": "tree",
      "defaultValue": "+",
      "description": "Select the operation to perform.",
      "label": "运算",
      "options": [
        "+",
        "-",
        "*",
        "/",
        "^",
        "%",
        "abs"
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
