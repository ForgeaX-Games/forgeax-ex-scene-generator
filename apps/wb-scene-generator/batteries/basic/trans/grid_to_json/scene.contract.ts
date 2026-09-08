// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gridToJson",
  "contractVersion": "1.0.0",
  "opId": "grid_to_json",
  "description": "Serialize a 2D integer grid to JSON. For the whole-building texture pipeline only: building_footprint_mask → this → house_template.spec (not used in normal structured scene composition).",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "2D integer grid (e.g. 0/1/2 mask from building_footprint_mask).",
      "label": "输入网格"
    }
  ],
  "outputs": [
    {
      "name": "json",
      "type": "string",
      "access": "item",
      "description": "JSON.stringify(grid); connect to house_template.spec or grid_json_to_size.json.",
      "label": "JSON 字符串"
    },
    {
      "name": "error",
      "type": "string",
      "access": "item",
      "description": "Error when input is invalid; empty string on success.",
      "label": "错误信息"
    }
  ],
  "deterministic": true
})
