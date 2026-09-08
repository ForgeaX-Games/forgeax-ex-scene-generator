// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "rtsQuadSymmetry",
  "contractVersion": "2.0.0",
  "opId": "rts_quad_symmetry",
  "description": "Takes the original full grid (for dimensions/base layer) and the top-left base shape, rotates it 0/90/180/270 degrees and stamps into all four corners, producing a fully symmetric RTS map.",
  "inputs": [
    {
      "name": "originalGrid",
      "type": "grid",
      "description": "Full map original grid, used only to determine map dimensions. The output fullGrid starts from zero and contains only the four corner base shapes.",
      "label": "原始完整网格"
    },
    {
      "name": "quadGrid",
      "type": "grid",
      "description": "Top-left corner base shape mask (from rts_base_shape_gen); 1=platform, 0=empty.",
      "label": "角落网格"
    },
    {
      "name": "mode",
      "type": "string",
      "defaultValue": "4way",
      "description": "Symmetry mode: 4way = four corners (recommended), 2way = diagonal two bases.",
      "label": "对称模式",
      "options": [
        "4way",
        "2way"
      ],
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "fullGrid",
      "type": "grid",
      "description": "Full map mask with base platforms in all four corners; 1=platform, 0=empty.",
      "label": "完整对称地图"
    },
    {
      "name": "baseCenters",
      "type": "array",
      "description": "List of base centroid coordinates [{x,y}] for corridor and resource planning.",
      "label": "基地中心坐标"
    }
  ],
  "deterministic": true
})
