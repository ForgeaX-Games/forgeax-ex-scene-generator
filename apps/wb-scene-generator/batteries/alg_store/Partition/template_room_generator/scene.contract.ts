// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "templateRoomGenerator",
  "contractVersion": "1.0.0",
  "opId": "template_room_generator",
  "description": "Places predefined room templates on a grid, connects adjacent rooms with corridors, and ensures full connectivity via flood-fill and L-shaped corridor carving.",
  "inputs": [
    {
      "name": "width",
      "type": "number",
      "defaultValue": 100,
      "description": "Output grid width. Room columns are derived from width and cell size.",
      "label": "网格宽度",
      "mode": "parameter"
    },
    {
      "name": "height",
      "type": "number",
      "defaultValue": 100,
      "description": "Output grid height. Room rows are derived from height and cell size.",
      "label": "网格高度",
      "mode": "parameter"
    },
    {
      "name": "cellSize",
      "type": "number",
      "defaultValue": 12,
      "description": "Tile side length per room slot; controls room spacing and grid density.",
      "label": "槽位尺寸",
      "mode": "parameter"
    },
    {
      "name": "emptyChance",
      "type": "number",
      "defaultValue": 0.1,
      "description": "Probability of leaving a room slot empty (0~0.5); higher values create more open areas.",
      "label": "空槽概率",
      "mode": "parameter"
    },
    {
      "name": "corridorWidth",
      "type": "number",
      "defaultValue": 3,
      "description": "Width of corridors connecting adjacent rooms in tiles.",
      "label": "走廊宽度",
      "mode": "parameter"
    },
    {
      "name": "minRegionSize",
      "type": "number",
      "defaultValue": 10,
      "description": "Isolated regions smaller than this are not connected (ignores tiny fragments).",
      "label": "最小连通区域",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed; 0 uses default seed. Different seeds produce different maps.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Output grid: 0=floor (passable), 1=wall (structural boundary), 2=pillar (interior obstacle).",
      "label": "地图网格"
    },
    {
      "name": "gridWidth",
      "type": "number",
      "description": "Actual output grid width.",
      "label": "网格宽度"
    },
    {
      "name": "gridHeight",
      "type": "number",
      "description": "Actual output grid height.",
      "label": "网格高度"
    }
  ],
  "deterministic": true
})
