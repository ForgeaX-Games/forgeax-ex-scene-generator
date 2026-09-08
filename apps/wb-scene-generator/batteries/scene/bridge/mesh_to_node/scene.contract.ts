// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "meshSceneNode",
  "contractVersion": "1.0.0",
  "opId": "mesh_to_node",
  "description": "Hang a Mesh as a scene node. Required for terrain: heightfieldMesh.mesh → meshSceneNode. Voxels from gridSceneNode are not a mesh.",
  "inputs": [
    {
      "name": "name",
      "type": "string",
      "access": "item",
      "required": true,
      "description": "Name of the node (no '/').",
      "label": "节点名",
      "mode": "parameter"
    },
    {
      "name": "mesh",
      "type": "mesh",
      "access": "item",
      "required": true,
      "description": "Triangle mesh to hang on the node (from heightfield_mesh, etc.).",
      "label": "mesh"
    }
  ],
  "outputs": [
    {
      "name": "scene",
      "type": "scene",
      "access": "item",
      "description": "One-node scene with focus on the new node; feed into add_child.",
      "label": "scene"
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
