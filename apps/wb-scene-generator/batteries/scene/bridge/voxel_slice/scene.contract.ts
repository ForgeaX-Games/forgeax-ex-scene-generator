// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "voxelSlice",
  "contractVersion": "1.0.0",
  "opId": "voxel_slice",
  "description": "Slice a voxel list at the given z height into a 0/1 grid matching the base grid's shape: each (x,y) is 1 if any voxel has voxel.z === z, else 0. When z is not provided, the maximum z among all voxels is auto-selected as the slice height; the actual slice height is echoed via the z output. voxels is consumed atomically (rank=1); z under autoIterate may be a list of heights to produce a per-layer list of slice grids.",
  "inputs": [
    {
      "name": "voxels",
      "type": "point3d",
      "access": "list",
      "required": true,
      "description": "Voxel position list (typically from node_explode.voxels).",
      "label": "voxels"
    },
    {
      "name": "grid",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "Determines the shape of the output grid; its values are ignored.",
      "label": "基准 grid"
    },
    {
      "name": "z",
      "type": "number",
      "access": "item",
      "required": false,
      "description": "Slice height; an (x,y) cell is set to 1 iff some voxel has voxel.z strictly equal to z. Leave empty to auto-select the maximum z among all voxels.",
      "label": "z",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "slice",
      "type": "grid",
      "access": "item",
      "description": "0/1 2D grid with the same shape as the input grid; hit cells are 1.",
      "label": "切片 grid"
    },
    {
      "name": "z",
      "type": "number",
      "access": "item",
      "description": "The z height actually used for this slice; echoes the external z if provided, otherwise the auto-selected maximum z.",
      "label": "切片 z"
    },
    {
      "name": "hitCount",
      "type": "number",
      "access": "item",
      "description": "Number of cells set to 1 (voxels outside the grid bounds are not counted).",
      "label": "命中数"
    }
  ],
  "deterministic": true
})
