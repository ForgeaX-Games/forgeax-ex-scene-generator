// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "heightfieldMesh",
  "contractVersion": "1.0.0",
  "opId": "heightfield_mesh",
  "description": "Terrain surface: extrude a height Grid into a continuous mesh. Cell value is elevation. Wire to meshSceneNode. Do not substitute gridSceneNode voxels.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "Height field (grid[y][x] = elevation). Non-zero cells become terrain.",
      "label": "高度 grid"
    },
    {
      "name": "mask",
      "type": "grid",
      "access": "item",
      "description": "Optional occupancy mask. Non-zero keeps the cell; unwired uses non-zero heights.",
      "label": "掩码"
    },
    {
      "name": "cellSize",
      "type": "number",
      "access": "item",
      "defaultValue": 1,
      "description": "World size of one cell in metres. Default 1, matching Default voxels.",
      "label": "格尺寸",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "mesh",
      "type": "mesh",
      "access": "item",
      "description": "Continuous terrain triangles (positions/indices). Wire to mesh_to_node or Default Terrain.",
      "label": "mesh"
    },
    {
      "name": "triangleCount",
      "type": "number",
      "access": "item",
      "description": "Number of triangles in the mesh.",
      "label": "三角形数"
    }
  ],
  "deterministic": true
})
