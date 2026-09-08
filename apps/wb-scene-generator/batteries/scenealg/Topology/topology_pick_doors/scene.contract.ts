// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "algTopologyPickDoors",
  "contractVersion": "1.0.0",
  "opId": "alg_topology_pick_doors",
  "description": "Picks `count` doorway segments of `width` cells from an input topology (wall-like 0/1 grid). First seeks segment-center candidates within continuous wall runs (>=6 cells), requiring an empty neighbor on the perpendicular side; falls back to per-cell enumeration if needed. Output contains only the chosen door cells.",
  "inputs": [
    {
      "name": "topology",
      "type": "grid",
      "required": true,
      "description": "0/1 topology grid (typically a wall) where doors will be picked.",
      "label": "输入拓扑"
    },
    {
      "name": "count",
      "type": "number",
      "defaultValue": 1,
      "description": "Target number of doors; the actual count may be smaller if candidates are insufficient.",
      "label": "门数量",
      "mode": "parameter"
    },
    {
      "name": "width",
      "type": "number",
      "defaultValue": 2,
      "description": "Doorway width in cells.",
      "label": "门宽度",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed; 0 uses current timestamp.",
      "label": "随机种子",
      "mode": "parameter"
    },
    {
      "name": "bottomDoor",
      "type": "boolean",
      "defaultValue": false,
      "description": "Default off. When on, doors are only placed on downward-facing horizontal walls that face the building exterior, preferring the lowest wall — matching top-down 2D games where the exterior door opens at the bottom. Wire the `region` input for reliable inside/outside detection (important when walls have gaps); without it, a border flood-fill heuristic is used. When off, any side is allowed.",
      "label": "外门朝下",
      "mode": "parameter"
    },
    {
      "name": "region",
      "type": "grid",
      "required": false,
      "description": "Optional. 0/1 grid of the whole building footprint including walls: 1 = belongs to this building, 0 = outside; must match the topology shape. When provided it is used to decide inside/outside (downward-exterior = the region cell directly below is 0), robust to gaps in walls; only takes effect when bottomDoor is on.",
      "label": "建筑区域"
    }
  ],
  "outputs": [
    {
      "name": "topology",
      "type": "grid",
      "description": "0/1 topology of chosen door cells, same shape as input.",
      "label": "门拓扑"
    },
    {
      "name": "placed",
      "type": "number",
      "description": "Number of doors actually placed (may be less than count).",
      "label": "实际数量"
    }
  ],
  "deterministic": true
})
