// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "tessSymDeform",
  "contractVersion": "1.0.0",
  "opId": "tess_sym_deform",
  "description": "Applies mathematically correct symmetric edge substitution to any tessellation region grid. Each shared edge is replaced by the same sin(2πt) curve from both sides, guaranteeing exact interlocking and preserved congruence across all tiles.",
  "inputs": [
    {
      "name": "regionGrid",
      "type": "grid",
      "description": "Region ID grid from any tessellation generator (hex, tri, rhombus, herringbone, or cairo).",
      "label": "镶嵌格 ID 网格"
    },
    {
      "name": "amplitude",
      "type": "number",
      "defaultValue": 3,
      "description": "Maximum pixel offset of the edge curve. Recommended < 30% of edgeLen to avoid excessive distortion. Default 3.",
      "label": "变形幅度",
      "mode": "parameter"
    },
    {
      "name": "edgeLen",
      "type": "number",
      "defaultValue": 0,
      "description": "Pixel edge length estimate for t normalization. 0=auto-detect from regionGrid (recommended). Default 0.",
      "label": "边长（0=自动）",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "warpedGrid",
      "type": "grid",
      "description": "Region ID grid with symmetrically deformed tile boundaries. All tiles remain congruent and edges interlock exactly.",
      "label": "对称变形 ID 网格"
    }
  ],
  "deterministic": true
})
