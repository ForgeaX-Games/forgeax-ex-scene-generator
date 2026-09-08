// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "nameEntryGen",
  "contractVersion": "1.0.0",
  "opId": "name_entry_gen",
  "description": "Generates a single-entry name list [{id, name, type}] from an integer ID, a name string, and a layer type string.",
  "inputs": [
    {
      "name": "id",
      "type": "number",
      "defaultValue": 1,
      "description": "Numeric ID for the name list entry; should match the corresponding value in the grid.",
      "label": "ID",
      "mode": "parameter"
    },
    {
      "name": "name",
      "type": "string",
      "defaultValue": "未命名",
      "description": "Display name for this entry.",
      "label": "名称",
      "mode": "parameter"
    },
    {
      "name": "layerType",
      "type": "string",
      "defaultValue": "",
      "description": "Layer type for this entry (optional; omitted from output if empty).",
      "label": "图层类型",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "nameList",
      "type": "array",
      "description": "Single-entry name list [{id, name, type}]; can be connected directly to fill_sort or similar nodes.",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
