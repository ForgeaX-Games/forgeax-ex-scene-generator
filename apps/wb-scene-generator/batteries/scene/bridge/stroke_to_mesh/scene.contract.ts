// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "strokeToMesh",
  "contractVersion": "1.0.0",
  "opId": "stroke_to_mesh",
  "description": "Extrude a road mask into a light ground-hugging strip mesh. Optional height field makes the strip follow the hillside. Wire polyline_road_spline.outputGrid.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "Road occupancy grid. Non-zero cells become the strip.",
      "label": "道路掩码"
    },
    {
      "name": "heightGrid",
      "type": "grid",
      "access": "item",
      "description": "Optional elevation grid. The strip follows these heights; unwired uses the mask values.",
      "label": "高度场"
    },
    {
      "name": "cellSize",
      "type": "number",
      "access": "item",
      "defaultValue": 1,
      "description": "World size of one cell in metres. Default 1.",
      "label": "格尺寸",
      "mode": "parameter"
    },
    {
      "name": "lift",
      "type": "number",
      "access": "item",
      "defaultValue": 0.08,
      "description": "Small Z lift so the strip sits on the terrain. Default 0.08.",
      "label": "抬升",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "mesh",
      "type": "mesh",
      "access": "item",
      "description": "Light road-strip triangles (role=road). Wire to mesh_to_node or Default Road.",
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
