// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "walkableGridBuilder",
  "contractVersion": "1.0.0",
  "opId": "walkable_grid_builder",
  "description": "Merges terrain grid and decoration list to produce a boolean walkability grid for collision detection (0=blocked, 1=walkable).",
  "inputs": [
    {
      "name": "terrainGrid",
      "type": "grid",
      "description": "Terrain grid: 1=water, 2=sand, 3=grass.",
      "label": "地形网格"
    },
    {
      "name": "decorationGrid",
      "type": "grid",
      "description": "Decoration grid: 0=empty, 1=tree (blocked), 2=bush (blocked), 3=rock (blocked), 4=flower (walkable).",
      "label": "装饰物网格"
    }
  ],
  "outputs": [
    {
      "name": "walkableGrid",
      "type": "grid",
      "description": "Boolean walkability grid: 0=blocked, 1=walkable.",
      "label": "可通行网格"
    }
  ],
  "deterministic": true
})
