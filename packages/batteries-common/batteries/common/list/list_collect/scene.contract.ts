// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "listCollect",
  "contractVersion": "1.1.0",
  "opId": "list_collect",
  "description": "Collect loop results across iterations and output a result list.",
  "inputs": [
    {
      "name": "item",
      "type": "any",
      "access": "item",
      "description": "Current iteration result.",
      "label": "元素"
    },
    {
      "name": "index",
      "type": "number",
      "access": "item",
      "defaultValue": 0,
      "description": "Current index.",
      "label": "下标",
      "mode": "parameter"
    },
    {
      "name": "total",
      "type": "number",
      "access": "item",
      "defaultValue": 0,
      "description": "Total item count.",
      "label": "总数",
      "mode": "parameter"
    },
    {
      "name": "collectorId",
      "type": "string",
      "access": "item",
      "defaultValue": "default",
      "description": "Collector identifier.",
      "label": "收集ID",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "resultList",
      "type": "any",
      "access": "list",
      "description": "Rank-1 result list when complete; null otherwise.",
      "label": "结果"
    },
    {
      "name": "collectedCount",
      "type": "number",
      "access": "item",
      "description": "Collected count.",
      "label": "已收集"
    },
    {
      "name": "isDone",
      "type": "boolean",
      "access": "item",
      "description": "Whether collection is complete.",
      "label": "完成"
    }
  ],
  "deterministic": true
})
