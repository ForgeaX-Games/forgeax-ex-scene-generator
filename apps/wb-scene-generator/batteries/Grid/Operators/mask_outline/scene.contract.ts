// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "maskOutline",
  "contractVersion": "2.0.0",
  "opId": "mask_outline",
  "description": "True morphological contour extraction based on the 8-neighborhood boundary. thickness>0: an inward outline of width `thickness` along the boundary inside the mask; thickness<0: an outward band of width `|thickness|` outside the mask (does NOT include the original mask interior); thickness=0: returns an all-zero grid. Output is binary (1/0) and the original mask values are dropped. Unlike the axis-extremal edge of Edge (mask_edge), this operator correctly outlines concave regions and interior holes.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "access": "item",
      "description": "Source grid; all non-zero values are treated as the mask region.",
      "label": "输入网格"
    },
    {
      "name": "thickness",
      "type": "number",
      "defaultValue": 1,
      "description": "Positive = an inward outline of that width inside the mask; negative = an outward band of width equal to its absolute value outside the mask (excluding the original mask interior); 0 = an all-zero grid. Output is binary (1/0).",
      "label": "轮廓厚度",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "access": "item",
      "description": "Same size as input; outline area=1, elsewhere=0.",
      "label": "轮廓网格"
    }
  ],
  "deterministic": true
})
