// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "roadConnectLink",
  "contractVersion": "2.0.0",
  "opId": "road_connect_link",
  "description": "Connects the points in a single POI grid into one road topology using link-game style paths (at most maxTurns turns: 0=straight, 1=L-shape, 2=Z/S-shape) under obstacle constraints, falling back to A* when no link route exists. Input/output are single grids (item); the engine fans out a DataTree of grids one-by-one. When coverPoi is false the POI cells are removed from the output.",
  "inputs": [
    {
      "name": "poiGrid",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "A single POI grid; cells with the maximum value are extracted as connection points (grid size preserved). The engine fans out a DataTree of grids one-by-one.",
      "label": "POI 网格"
    },
    {
      "name": "obstacle",
      "type": "grid",
      "access": "item",
      "description": "Obstacle grid; non-zero cells are impassable. If omitted, an empty obstacle of poiGrid size is used.",
      "label": "障碍场"
    },
    {
      "name": "roadWidth",
      "type": "number",
      "access": "item",
      "defaultValue": 1,
      "description": "Road width in cells via dilation. Default 1.",
      "label": "道路宽度",
      "mode": "parameter"
    },
    {
      "name": "roadValue",
      "type": "number",
      "access": "item",
      "defaultValue": 1,
      "description": "Value written to road cells. Default 1.",
      "label": "道路值",
      "mode": "parameter"
    },
    {
      "name": "maxTurns",
      "type": "number",
      "access": "item",
      "defaultValue": 2,
      "description": "Max turns for link-game routing. 0 = straight only; 1 = allow L-shape; 2 = allow Z/S-shape. Default 2.",
      "label": "最大转弯次数",
      "mode": "parameter"
    },
    {
      "name": "coverPoi",
      "type": "boolean",
      "access": "item",
      "defaultValue": false,
      "description": "Whether to keep POI cells in the output road. true: road includes POI cells; false: POI cells are removed from the output (set to 0). Default false.",
      "label": "覆盖格点",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "topology",
      "type": "grid",
      "access": "item",
      "description": "Road topology grid (0/roadValue); road cells = roadValue, others = 0.",
      "label": "道路拓扑"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "access": "item",
      "description": "Name list [{id, name, type}] with the road entry.",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
