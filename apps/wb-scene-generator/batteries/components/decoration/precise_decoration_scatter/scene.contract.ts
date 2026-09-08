// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "preciseDecorationScatter",
  "contractVersion": "2.0.0",
  "opId": "precise_decoration_scatter",
  "description": "Scatters natural decorations around a given center coordinate within the target area. If the center is outside the target area, it snaps to the nearest target cell via BFS.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "access": "item",
      "description": "Single input grid (number[][]); grid lists are handled per-item by the DataTree engine.",
      "label": "输入网格"
    },
    {
      "name": "decorations",
      "type": "array",
      "description": "Decoration list: simplified [{name: count}, ...] e.g. [{\"tree\": 5}]; legacy [{decoration, count}] also accepted.",
      "label": "装饰物清单"
    },
    {
      "name": "center",
      "type": "array",
      "description": "Scatter center [x, y] (column, row). If omitted, a random non-zero cell is used as center. Auto-snaps to nearest target cell via BFS if outside target area.",
      "label": "中心坐标"
    },
    {
      "name": "algorithm",
      "type": "string",
      "access": "item",
      "defaultValue": "random",
      "description": "Scatter algorithm: random, cluster (dense near center), ring, poisson (even spacing), noise.",
      "label": "播撒算法",
      "options": [
        "random",
        "cluster",
        "ring",
        "poisson",
        "noise"
      ],
      "mode": "parameter"
    },
    {
      "name": "scatterRadius",
      "type": "number",
      "access": "item",
      "defaultValue": 12,
      "description": "Scatter radius in cells around the center. Only target cells within this radius are candidates.",
      "label": "播撒半径",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "access": "item",
      "defaultValue": 0,
      "description": "Random seed; 0 produces a different result each run.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "access": "item",
      "description": "Single multi-value grid: each decoration entry gets an increasing id, 0 elsewhere; pipe to grid_split_by_value to separate.",
      "label": "输出网格"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "access": "item",
      "description": "Name list for decoration ids actually present in the grid: [{id, name, type}], type is always \"asset\".",
      "label": "名称清单"
    },
    {
      "name": "placedCount",
      "type": "number",
      "access": "item",
      "description": "Total number of decoration cells successfully placed.",
      "label": "放置数量"
    }
  ],
  "deterministic": true
})
