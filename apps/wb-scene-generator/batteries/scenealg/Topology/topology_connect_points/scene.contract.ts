// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "algTopologyConnectPoints",
  "contractVersion": "1.0.0",
  "opId": "alg_topology_connect_points",
  "description": "Connects a set of POI points into a road topology network under obstacle constraints. Extracts max-value cells from the POI grid as connection points, builds a Prim minimum spanning tree (Manhattan weight) to decide edges, routes each edge with orthogonal A* around obstacles, then dilates by roadWidth. When coverPoi is false the POI cells are removed from the output.",
  "inputs": [
    {
      "name": "poiGrid",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "POI grid; cells with the maximum value are extracted as connection points (grid size preserved).",
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
      "defaultValue": 2,
      "description": "Road width in cells via dilation. Default 2.",
      "label": "道路宽度",
      "mode": "parameter"
    },
    {
      "name": "roadValue",
      "type": "number",
      "defaultValue": 1,
      "description": "Value written to road cells. Default 1.",
      "label": "道路值",
      "mode": "parameter"
    },
    {
      "name": "coverPoi",
      "type": "boolean",
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
