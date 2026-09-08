// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "voxelRange",
  "contractVersion": "1.0.0",
  "opId": "voxel_range",
  "description": "Collect the coordinate values that appear across the voxel list on the x, y and z axes, emitting a sorted, de-duplicated number list per axis (the range of each axis). voxels is consumed atomically (rank=1); an empty list yields three empty ranges.",
  "inputs": [
    {
      "name": "voxels",
      "type": "point3d",
      "access": "list",
      "required": true,
      "description": "Voxel position list (typically from node_explode.voxels).",
      "label": "voxels"
    }
  ],
  "outputs": [
    {
      "name": "xRange",
      "type": "number",
      "access": "list",
      "description": "All distinct x values present in voxels, sorted ascending.",
      "label": "x 范围"
    },
    {
      "name": "yRange",
      "type": "number",
      "access": "list",
      "description": "All distinct y values present in voxels, sorted ascending.",
      "label": "y 范围"
    },
    {
      "name": "zRange",
      "type": "number",
      "access": "list",
      "description": "All distinct z values present in voxels, sorted ascending.",
      "label": "z 范围"
    }
  ],
  "deterministic": true
})
