// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "rangeList",
  "contractVersion": "1.1.0",
  "opId": "range_list",
  "description": "Generate an evenly-spaced numeric sequence from start to end. Optionally prepend a prefix to produce a string sequence.",
  "inputs": [
    {
      "name": "start",
      "type": "number",
      "access": "item",
      "defaultValue": 1,
      "description": "Start value of the range.",
      "label": "起点",
      "mode": "parameter"
    },
    {
      "name": "end",
      "type": "number",
      "access": "item",
      "defaultValue": 10,
      "description": "End value of the range (inclusive).",
      "label": "终点",
      "mode": "parameter"
    },
    {
      "name": "step",
      "type": "number",
      "access": "item",
      "defaultValue": 1,
      "description": "Spacing between consecutive elements; must be > 0.",
      "label": "步长",
      "mode": "parameter"
    },
    {
      "name": "prefix",
      "type": "string",
      "access": "item",
      "defaultValue": "",
      "description": "String prefix. When non-empty, stringList output is generated with the prefix.",
      "label": "前缀",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "list",
      "type": "number",
      "access": "list",
      "description": "Generated rank-1 numeric sequence.",
      "label": "数列"
    },
    {
      "name": "stringList",
      "type": "string",
      "access": "list",
      "description": "Generated rank-1 string sequence with prefix.",
      "label": "文本列"
    },
    {
      "name": "count",
      "type": "number",
      "access": "item",
      "description": "Total number of elements in the sequence.",
      "label": "数量"
    }
  ],
  "deterministic": true
})
