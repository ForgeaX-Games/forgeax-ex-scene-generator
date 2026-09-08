// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "nodeExplode",
  "contractVersion": "1.0.0",
  "opId": "node_explode",
  "description": "Expose all attributes of the focused scene node: metadata (schema/version/voxelCount/childCount) plus the node's own voxel lists (voxels:point3d, tokens:string) and the absolute paths of direct children (childPaths:string). Under the unified node model, cells and children may coexist on the same node.",
  "inputs": [
    {
      "name": "scene",
      "type": "scene",
      "access": "item",
      "required": true,
      "description": "Scene port of the target node (focus points at the node to explode).",
      "label": "scene"
    }
  ],
  "outputs": [
    {
      "name": "exists",
      "type": "bool",
      "access": "item",
      "description": "Whether the node exists.",
      "label": "exists"
    },
    {
      "name": "schema",
      "type": "string",
      "access": "item",
      "description": "Node schema tag (empty string when absent).",
      "label": "schema"
    },
    {
      "name": "version",
      "type": "number",
      "access": "item",
      "description": "Node version (monotonically increasing per write).",
      "label": "version"
    },
    {
      "name": "voxelCount",
      "type": "number",
      "access": "item",
      "description": "Number of voxels carried by this node itself.",
      "label": "体素数"
    },
    {
      "name": "childCount",
      "type": "number",
      "access": "item",
      "description": "Number of direct children of this node.",
      "label": "子节点数"
    },
    {
      "name": "width",
      "type": "number",
      "access": "item",
      "description": "Local-frame width (grid columns); 0 if no bounds.",
      "label": "宽度"
    },
    {
      "name": "height",
      "type": "number",
      "access": "item",
      "description": "Local-frame height (grid rows); 0 if no bounds.",
      "label": "高度"
    },
    {
      "name": "voxels",
      "type": "point3d",
      "access": "list",
      "description": "List of (x,y,z) positions of this node's voxels.",
      "label": "体素位置"
    },
    {
      "name": "2dPoints",
      "type": "point2d",
      "access": "list",
      "description": "List of 2D-projected (x,y) points of this node's voxels; z is dropped and points are de-duplicated by (x,y) — the planar footprint.",
      "label": "2D 投影点"
    },
    {
      "name": "tokens",
      "type": "string",
      "access": "list",
      "description": "Token list aligned with voxels.",
      "label": "体素 token"
    },
    {
      "name": "childPaths",
      "type": "string",
      "access": "list",
      "description": "Absolute paths of direct children.",
      "label": "子节点路径"
    }
  ],
  "deterministic": true
})
