// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "regionBoundarySmooth",
  "contractVersion": "1.0.0",
  "opId": "region_boundary_smooth",
  "description": "Three-phase boundary smoother for multi-region ID grids: BFS gap fill → iterative Gaussian-weighted majority vote smoothing → uniform gap re-carving. Turns jagged pixelated borders into smooth continuous curves.",
  "inputs": [
    {
      "name": "regionGrid",
      "type": "grid",
      "description": "Multi-region ID grid with 1-based region IDs; 0=gap/empty. Typically the regionGrid output of rts_base_shape_gen or rts_base_shape_poisson.",
      "label": "区域 ID 网格"
    },
    {
      "name": "iterations",
      "type": "number",
      "defaultValue": 3,
      "description": "Number of Gaussian vote smoothing iterations. More = smoother but slower. Recommended 2-5, default 3.",
      "label": "平滑迭代次数",
      "mode": "parameter"
    },
    {
      "name": "kernelRadius",
      "type": "number",
      "defaultValue": 2,
      "description": "Radius of the Gaussian kernel in cells. Larger = smoother but slower. Recommended 1-4, default 2.",
      "label": "平滑核半径",
      "mode": "parameter"
    },
    {
      "name": "gapWidth",
      "type": "number",
      "defaultValue": 1,
      "description": "Width of re-carved boundary gap in cells. 0=no gap (seamless output). Recommended 1-3, default 1.",
      "label": "间隙宽度",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "smoothGrid",
      "type": "grid",
      "description": "Smoothed multi-region ID grid with re-carved gap cells (0).",
      "label": "平滑区域网格"
    },
    {
      "name": "baseGrid",
      "type": "grid",
      "description": "Binary mask: 1=region, 0=gap.",
      "label": "平台二值掩码"
    }
  ],
  "deterministic": true
})
