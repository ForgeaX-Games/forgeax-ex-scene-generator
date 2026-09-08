// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "buildingGenerator",
  "contractVersion": "2.0.0",
  "opId": "building_generator",
  "description": "Full building generation pipeline on a single mask: carving, wall outline, BSP inner walls, outer/inner doors, windows, and indoor floor splitting by room. Outputs one multi-value grid (roof-top/outer-body/inner-body/window/per-room floors), a name list, and a door grid. Grid lists are handled per-item by the DataTree engine.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "access": "item",
      "description": "Single building plot mask grid (non-zero cells treated as valid building area). The engine fans out a grid list one-by-one.",
      "label": "建筑区域"
    },
    {
      "name": "wallThickness",
      "type": "number",
      "access": "item",
      "defaultValue": 1,
      "description": "Inward thickness of the outer wall outline in cells (minimum 1).",
      "label": "外墙厚度",
      "mode": "parameter"
    },
    {
      "name": "innerWallDensity",
      "type": "number",
      "access": "item",
      "defaultValue": 0.25,
      "description": "BSP inner wall density: 0 = no inner walls, 1 = maximum split depth (6 levels). Range [0, 1].",
      "label": "内墙密度",
      "mode": "parameter"
    },
    {
      "name": "doorCount",
      "type": "number",
      "access": "item",
      "defaultValue": 1,
      "description": "Number of outer doors (main entrances) per building. 0 = no outer doors.",
      "label": "外门数量",
      "mode": "parameter"
    },
    {
      "name": "doorWidth",
      "type": "number",
      "access": "item",
      "defaultValue": 2,
      "description": "Width of outer doors in cells (minimum 1).",
      "label": "外门宽度",
      "mode": "parameter"
    },
    {
      "name": "windowCount",
      "type": "number",
      "access": "item",
      "defaultValue": 4,
      "description": "Number of windows per building (only outer wall cells with empty neighbors on both sides qualify). 0 = no windows.",
      "label": "窗户数量",
      "mode": "parameter"
    },
    {
      "name": "windowWidth",
      "type": "number",
      "access": "item",
      "defaultValue": 2,
      "description": "Width of windows in cells (minimum 1).",
      "label": "窗户宽度",
      "mode": "parameter"
    },
    {
      "name": "buildingHeight",
      "type": "number",
      "access": "item",
      "defaultValue": 1,
      "description": "Building height in cells (H). When > 0, the combined outer-wall + window mask is shifted upward by H rows and output as a \"墙顶\" (wall-top) layer. 0 = no wall-top output.",
      "label": "建筑高度",
      "mode": "parameter"
    },
    {
      "name": "windowRandom",
      "type": "boolean",
      "access": "item",
      "defaultValue": true,
      "description": "When enabled, windows are placed randomly. When disabled, they are distributed evenly along the wall.",
      "label": "窗户随机布局",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "access": "item",
      "defaultValue": 0,
      "description": "Random seed; 0 uses current timestamp.",
      "label": "随机种子",
      "mode": "parameter"
    },
    {
      "name": "mergeOutput",
      "type": "boolean",
      "access": "item",
      "defaultValue": true,
      "description": "When enabled, all rooms of this building share one floor layer (id=5). When disabled, each room gets its own ascending id (5,6,7…).",
      "label": "地板合并",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "access": "item",
      "description": "Single multi-value grid: roof-top=1, outer-body=2, inner-body=3, window=4, floors from 5. Overlaps written floor→inner-body→outer-body→window→roof-top (later wins); pipe to grid_split_by_value to separate layers.",
      "label": "建筑网格"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "access": "item",
      "description": "Name list with only ids actually present, format [{id, name, type}]; floor entries per room, wall pack entry id=[3,2,4,1] named \"墙体\".",
      "label": "建筑名称清单"
    },
    {
      "name": "doorGrid",
      "type": "grid",
      "access": "item",
      "description": "Single grid of this building's outer doors; door cells = 1, everything else = 0.",
      "label": "大门"
    }
  ],
  "deterministic": true
})
