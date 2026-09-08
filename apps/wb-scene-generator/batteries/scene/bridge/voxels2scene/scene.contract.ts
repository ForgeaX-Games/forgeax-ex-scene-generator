// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "voxels2scene",
  "contractVersion": "1.0.0",
  "opId": "voxels2scene",
  "description": "Build a scene tree from point3d voxels. Supports a flat single node, groupBy=z|token auto layering, or hierarchical nodes[] from json2voxels.",
  "inputs": [
    {
      "name": "voxels",
      "type": "point3d",
      "access": "list",
      "description": "Voxel positions (typically from json2voxels.voxels).",
      "label": "voxels"
    },
    {
      "name": "tokens",
      "type": "string",
      "access": "list",
      "description": "Optional tokens aligned with voxels.",
      "label": "tokens",
      "mode": "parameter"
    },
    {
      "name": "nodes",
      "type": "array",
      "access": "item",
      "description": "Hierarchical nodes from json2voxels.nodes; takes precedence over voxels+groupBy.",
      "label": "nodes"
    },
    {
      "name": "name",
      "type": "string",
      "access": "item",
      "defaultValue": "Voxels",
      "description": "Root or single node name (no '/').",
      "label": "根节点名",
      "mode": "parameter"
    },
    {
      "name": "root",
      "type": "string",
      "access": "item",
      "description": "Alias of name; wire from json2voxels.root.",
      "label": "root（别名）",
      "mode": "parameter"
    },
    {
      "name": "schema",
      "type": "string",
      "access": "item",
      "defaultValue": "voxel-mass",
      "description": "Node geometry schema tag.",
      "label": "schema",
      "mode": "parameter"
    },
    {
      "name": "token",
      "type": "string",
      "access": "item",
      "defaultValue": "cell",
      "description": "Default token when tokens list is omitted.",
      "label": "默认 token",
      "mode": "parameter"
    },
    {
      "name": "groupBy",
      "type": "string",
      "access": "item",
      "defaultValue": "none",
      "description": "none | z | token — auto split into child nodes.",
      "label": "分组",
      "options": [
        "none",
        "z",
        "token"
      ],
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "scene",
      "type": "scene",
      "access": "item",
      "description": "Constructed scene with focus on the root node.",
      "label": "scene"
    },
    {
      "name": "voxelCount",
      "type": "number",
      "access": "item",
      "description": "Total voxels written.",
      "label": "体素数"
    },
    {
      "name": "nodeCount",
      "type": "number",
      "access": "item",
      "description": "Number of scene nodes written.",
      "label": "节点数"
    },
    {
      "name": "error",
      "type": "string",
      "access": "item",
      "description": "Error message on failure.",
      "label": "error"
    }
  ],
  "deterministic": true
})
