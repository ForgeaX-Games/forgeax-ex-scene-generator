// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "complexIndoorCleanup",
  "contractVersion": "1.0.0",
  "opId": "complex_indoor_cleanup",
  "description": "Post-process: remove stray walls, fix oversized doors, clean floating wall chains.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "description": "Final grid with doors",
      "label": "输入网格"
    },
    {
      "name": "nameList",
      "type": "array",
      "description": "Grid value to name mapping",
      "label": "名称清单"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "description": "Cleaned final grid",
      "label": "输出网格"
    },
    {
      "name": "nameList",
      "type": "array",
      "description": "Updated name list",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
