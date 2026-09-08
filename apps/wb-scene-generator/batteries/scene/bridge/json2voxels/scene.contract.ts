// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "json2voxels",
  "contractVersion": "1.0.0",
  "opId": "json2voxels",
  "description": "Parse a JSON voxel coordinate list into point3d voxels and parallel tokens. Supports flat arrays, `{ voxels: [...] }`, or hierarchical `{ root, nodes:[{ name, cells }] }`.",
  "inputs": [
    {
      "name": "json",
      "type": "string",
      "access": "item",
      "required": true,
      "description": "Voxel JSON string (see supported formats in description).",
      "label": "JSON",
      "mode": "parameter"
    },
    {
      "name": "str",
      "type": "string",
      "access": "item",
      "description": "Alias of json; useful when wired from text_panel.output.",
      "label": "str（兼容）",
      "mode": "parameter"
    },
    {
      "name": "defaultToken",
      "type": "string",
      "access": "item",
      "defaultValue": "cell",
      "description": "Default token when a cell omits token.",
      "label": "默认 token",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "voxels",
      "type": "point3d",
      "access": "list",
      "description": "Voxel positions { x, y, z }.",
      "label": "voxels"
    },
    {
      "name": "tokens",
      "type": "string",
      "access": "list",
      "description": "Semantic token per voxel.",
      "label": "tokens"
    },
    {
      "name": "nodes",
      "type": "array",
      "access": "item",
      "description": "Hierarchical node specs when JSON includes nodes[].",
      "label": "nodes"
    },
    {
      "name": "root",
      "type": "string",
      "access": "item",
      "description": "Root node name from JSON when provided.",
      "label": "root"
    },
    {
      "name": "schema",
      "type": "string",
      "access": "item",
      "description": "Schema tag from JSON when provided.",
      "label": "schema"
    },
    {
      "name": "voxelCount",
      "type": "number",
      "access": "item",
      "description": "Number of parsed voxels.",
      "label": "体素数"
    },
    {
      "name": "error",
      "type": "string",
      "access": "item",
      "description": "Error message when parsing fails.",
      "label": "error"
    }
  ],
  "deterministic": true
})
