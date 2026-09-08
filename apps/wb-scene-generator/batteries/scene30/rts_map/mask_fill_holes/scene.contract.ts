// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "maskFillHoles",
  "contractVersion": "1.0.0",
  "opId": "mask_fill_holes",
  "description": "BFS from map borders marks all exterior empty cells; any interior zero-cell enclosed by platform is filled to 1, eliminating scattered holes inside base shapes.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Binary mask grid to fill (1=platform, 0=empty). Typically from rts_base_shape_gen.baseGrid or rts_quad_symmetry.fullGrid.",
      "label": "二值掩码网格"
    }
  ],
  "outputs": [
    {
      "name": "filledGrid",
      "type": "grid",
      "description": "Binary mask with all interior holes filled; exterior empty cells unchanged, interior zeros set to 1.",
      "label": "填充后掩码"
    }
  ],
  "deterministic": true
})
