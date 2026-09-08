// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "renderPreprocess",
  "contractVersion": "1.0.0",
  "opId": "render_preprocess",
  "description": "Reorders and merges grid list and name list according to render order: tile types are accumulated (each tile includes all previous tiles' areas), asset types are placed at the end, outputs reordered grid list and name list.",
  "inputs": [
    {
      "name": "inputGridList",
      "type": "array",
      "description": "Input binary grid list, one-to-one correspondence with name list.",
      "label": "网格列表"
    },
    {
      "name": "nameList",
      "type": "array",
      "description": "Name list with entries {id, name, type}, type is 'tile' or 'asset'.",
      "label": "名称清单"
    },
    {
      "name": "renderOrder",
      "type": "string",
      "defaultValue": "[]",
      "description": "JSON string, e.g. [\"water\",\"deep_water\",[\"grass\",\"thick_grass\"],\"mountain\"], [] means same level.",
      "label": "渲染顺序",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGridList",
      "type": "array",
      "description": "Grid list reordered and accumulated by render order, assets placed at end.",
      "label": "网格列表"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "description": "Name list reordered by render order, format [{id, name, type}].",
      "label": "名称清单"
    },
    {
      "name": "detail",
      "type": "string",
      "description": "Processing report.",
      "label": "详细信息"
    }
  ],
  "deterministic": true
})
