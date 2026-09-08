// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "roadConnectRandomWalk",
  "contractVersion": "2.0.0",
  "opId": "road_connect_random_walk",
  "description": "Extracts cells with a specified value from a POI grid as connection points, connects them with orthogonal A* random-walk roads while avoiding obstacles.",
  "inputs": [
    {
      "name": "poiGrid",
      "type": "array",
      "description": "POI grid or list of grids; cells with the maximum value are extracted as connection points.",
      "label": "POI 网格"
    },
    {
      "name": "obstacleGrid",
      "type": "grid",
      "description": "Obstacle grid; non-zero cells are impassable. If omitted, map size matches poiGrid.",
      "label": "障碍物网格"
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
      "description": "Whether to include POI cells in the output road. true: road includes POI cells; false: POI cells are excluded from road output (set to 0). Default false.",
      "label": "覆盖格点",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGridList",
      "type": "array",
      "description": "Road grid list; one per input POI grid. Road cells = roadValue, others = 0.",
      "label": "道路网格列表"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "description": "Name list [{id, name, type}]: background and road entries.",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
