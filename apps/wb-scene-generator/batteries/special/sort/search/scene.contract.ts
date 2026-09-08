// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "search",
  "contractVersion": "1.0.0",
  "opId": "search",
  "description": "Searches a name list for entries whose name contains the specified keywords. The grid list and name list are paired by index; only matching pairs are kept in the output.",
  "inputs": [
    {
      "name": "gridList",
      "type": "any",
      "defaultValue": null,
      "description": "网格列表（number[][][]），每个网格与名称清单列表中同索引的条目一一对应",
      "label": "网格列表"
    },
    {
      "name": "nameListList",
      "type": "any",
      "defaultValue": null,
      "description": "名称清单（NameEntry[]），所有网格共用；也支持 NameEntry[][] 自动打平",
      "label": "名称清单"
    },
    {
      "name": "mode",
      "type": "string",
      "defaultValue": "包含",
      "description": "搜索模式，目前仅支持「包含」：name 字段包含任意关键词即匹配",
      "label": "模式",
      "options": [
        "包含"
      ],
      "mode": "parameter"
    },
    {
      "name": "searchContent",
      "type": "any",
      "defaultValue": "",
      "description": "搜索关键词，支持多种格式：字符串、字符串列表、名称清单（取 name 字段）、字符串化的 JSON 数组。多个关键词取「任意匹配」（OR）",
      "label": "搜索内容"
    }
  ],
  "outputs": [
    {
      "name": "outputGridList",
      "type": "array",
      "description": "过滤后只保留含匹配 id 的网格，顺序与输入一致",
      "label": "输出网格列表"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "description": "过滤后的名称清单，只保留匹配的条目（id/name/type 任意字段包含关键词即匹配）",
      "label": "输出名称清单"
    }
  ],
  "deterministic": true
})
