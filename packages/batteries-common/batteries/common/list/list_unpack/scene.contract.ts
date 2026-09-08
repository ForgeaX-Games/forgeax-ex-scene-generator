// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "listUnpack",
  "contractVersion": "1.1.0",
  "opId": "list_unpack",
  "description": "Loop entry for iterating a outer list; use with Collect to gather results.",
  "inputs": [
    {
      "name": "dataList",
      "type": "any",
      "access": "list",
      "description": "Rank-1 outer list to iterate.",
      "label": "列表"
    },
    {
      "name": "trigger",
      "type": "boolean",
      "access": "item",
      "defaultValue": false,
      "description": "Start loop when true.",
      "label": "启动",
      "mode": "parameter"
    },
    {
      "name": "collectorId",
      "type": "string",
      "access": "item",
      "defaultValue": "default",
      "description": "Matches Collect collectorId.",
      "label": "收集ID",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "item",
      "type": "any",
      "access": "item",
      "description": "Current item.",
      "label": "元素"
    },
    {
      "name": "total",
      "type": "number",
      "access": "item",
      "description": "Total item count.",
      "label": "总数"
    },
    {
      "name": "index",
      "type": "number",
      "access": "item",
      "description": "Current index.",
      "label": "下标"
    }
  ],
  "deterministic": true
})
