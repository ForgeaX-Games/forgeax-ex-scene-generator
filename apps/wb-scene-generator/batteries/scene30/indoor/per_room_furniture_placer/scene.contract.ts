// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "perRoomFurniturePlacer",
  "contractVersion": "1.0.0",
  "opId": "per_room_furniture_placer",
  "description": "Runs furniture placement (main + filler) independently for each connected room in the layout, ensuring every room receives furniture.",
  "inputs": [
    {
      "name": "layoutGrid",
      "type": "grid",
      "description": "Layout grid from complex_indoor_gen (0=wall, 1=room, 2=corridor, 3=door).",
      "label": "室内布局网格"
    },
    {
      "name": "mainList",
      "type": "array",
      "description": "Main furniture list (from furniture_rank_split main_list), placed once per room.",
      "label": "主家具清单"
    },
    {
      "name": "fillList",
      "type": "array",
      "description": "Filler furniture list (from furniture_rank_split fill_list), placed repeatedly until occupancy limit.",
      "label": "填充家具清单"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 42,
      "description": "Random seed; 0 uses current timestamp.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "newMaskA",
      "type": "grid",
      "description": "Merged furniture mask grid for all rooms, ready for visualization.",
      "label": "家具实体网格"
    },
    {
      "name": "furnitureIndex",
      "type": "array",
      "description": "Index of all placed furniture items [{rank, name, isGroup}].",
      "label": "家具编号列表"
    }
  ],
  "deterministic": true
})
