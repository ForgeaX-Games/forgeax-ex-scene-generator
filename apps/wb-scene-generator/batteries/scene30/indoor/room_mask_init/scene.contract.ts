// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "roomMaskInit",
  "contractVersion": "1.0.0",
  "opId": "room_mask_init",
  "description": "Initializes maskA (furniture body occupancy) and maskB (door aisle reservation) from a room interior grid and a door position grid.",
  "inputs": [
    {
      "name": "roomGrid",
      "type": "grid",
      "description": "Room interior grid: 1 = walkable cell, 0 = wall or outside.",
      "label": "室内空间网格"
    },
    {
      "name": "doorGrid",
      "type": "grid",
      "description": "Door position grid: 1 = door cell, 0 = other; must have the same size as roomGrid.",
      "label": "门位置网格"
    }
  ],
  "outputs": [
    {
      "name": "maskA",
      "type": "grid",
      "description": "Furniture body occupancy mask, initially all zeros; populated by the placement algorithm with non-zero rank values.",
      "label": "家具实体掩码 (maskA)"
    },
    {
      "name": "maskB",
      "type": "grid",
      "description": "Aisle reservation mask; the four neighbors of each door cell are set to 1 to keep doorways clear. Always a binary 0/1 grid.",
      "label": "过道预留掩码 (maskB)"
    }
  ],
  "deterministic": true
})
