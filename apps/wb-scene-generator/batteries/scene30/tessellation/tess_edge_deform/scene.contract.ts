// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "tessEdgeDeform",
  "contractVersion": "1.0.0",
  "opId": "tess_edge_deform",
  "description": "Applies an FBM displacement field to any tessellation region grid, warping straight cell boundaries into organic curves without breaking the tessellation topology.",
  "inputs": [
    {
      "name": "regionGrid",
      "type": "grid",
      "description": "Region ID grid from tess_hex_grid, tess_tri_grid, or any other source.",
      "label": "镶嵌格 ID 网格"
    },
    {
      "name": "warpScale",
      "type": "number",
      "defaultValue": 3,
      "description": "Max pixel displacement. Larger = more deformation. Recommended 1-10. Default 3.",
      "label": "变形幅度",
      "mode": "parameter"
    },
    {
      "name": "warpFreq",
      "type": "number",
      "defaultValue": 0.1,
      "description": "Spatial frequency of the displacement field. Larger = denser ripples. Recommended 0.05-0.3. Default 0.1.",
      "label": "变形频率",
      "mode": "parameter"
    },
    {
      "name": "octaves",
      "type": "number",
      "defaultValue": 3,
      "description": "Number of FBM octaves (1-6). More = richer detail. Default 3.",
      "label": "FBM 层数",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed; 0 = random each time. Default 0.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "warpedGrid",
      "type": "grid",
      "description": "Tessellation region grid with organically warped boundaries. Cell IDs are preserved from input.",
      "label": "变形后 ID 网格"
    }
  ],
  "deterministic": true
})
