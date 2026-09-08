// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "stringConcat",
  "contractVersion": "1.0.0",
  "opId": "string_concat",
  "description": "Concatenate two strings into one, optionally joined by a separator. Supports DataTree batching (per-branch pairing via lacing).",
  "inputs": [
    {
      "name": "a",
      "type": "string",
      "access": "item",
      "defaultValue": "",
      "description": "First string.",
      "label": "字符串 A",
      "mode": "parameter"
    },
    {
      "name": "b",
      "type": "string",
      "access": "item",
      "defaultValue": "",
      "description": "Second string.",
      "label": "字符串 B",
      "mode": "parameter"
    },
    {
      "name": "separator",
      "type": "string",
      "access": "tree",
      "defaultValue": "",
      "description": "Separator inserted between A and B; empty by default for plain concatenation.",
      "label": "分隔符",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "result",
      "type": "string",
      "access": "item",
      "description": "Concatenation result.",
      "label": "结果"
    }
  ],
  "deterministic": true
})
