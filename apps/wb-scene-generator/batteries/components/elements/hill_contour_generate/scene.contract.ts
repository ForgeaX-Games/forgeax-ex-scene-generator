// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "hillContourGenerate",
  "contractVersion": "2.0.0",
  "opId": "hill_contour_generate",
  "description": "Generates smooth rounded hill contours within a single input mask. Contour layers are strictly nested and merged into one multi-value grid, with built-in morphological post-processing. Grid lists are handled per-item by the DataTree engine.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "access": "item",
      "description": "Single input mask grid (number[][]); contours are generated only for non-zero cells. The engine fans out a grid list one-by-one.",
      "label": "输入网格"
    },
    {
      "name": "contourLevels",
      "type": "number",
      "access": "item",
      "defaultValue": 6,
      "description": "Number of contour levels; determines how many concentric rings are generated.",
      "label": "等高线层数",
      "mode": "parameter",
      "control": true
    },
    {
      "name": "hillCount",
      "type": "number",
      "access": "item",
      "defaultValue": 3,
      "description": "Number of hill peaks within the mask; each peak generates its own concentric contours.",
      "label": "山头数量",
      "mode": "parameter",
      "control": true
    },
    {
      "name": "roundness",
      "type": "number",
      "access": "item",
      "defaultValue": 0.85,
      "description": "Roundness of contour rings: 0=more angular, 1=near-circular. Range 0-1.",
      "label": "圆度",
      "mode": "parameter",
      "control": true
    },
    {
      "name": "peakRadius",
      "type": "number",
      "access": "item",
      "defaultValue": 0.35,
      "description": "Influence radius for each hill peak in normalized coords (0-1); larger = broader hill.",
      "label": "山包半径",
      "mode": "parameter",
      "control": true
    },
    {
      "name": "noiseAmount",
      "type": "number",
      "access": "item",
      "defaultValue": 0.12,
      "description": "Noise perturbation on contour edges: 0=perfect circle, 0.2=natural organic edges.",
      "label": "边缘扰动量",
      "mode": "parameter"
    },
    {
      "name": "minHoleSize",
      "type": "number",
      "access": "item",
      "defaultValue": 20,
      "description": "Post-process: zero-regions with area ≤ this value enclosed by a single color will be filled.",
      "label": "最大孔洞面积",
      "mode": "parameter"
    },
    {
      "name": "minIslandSize",
      "type": "number",
      "access": "item",
      "defaultValue": 8,
      "description": "Post-process: non-zero connected regions with area < this value will be removed.",
      "label": "最小岛屿面积",
      "mode": "parameter"
    },
    {
      "name": "peakPosition",
      "type": "number",
      "access": "item",
      "description": "Numpad position (1-9): 7=top-left 8=top-center 9=top-right 4=mid-left 5=center 6=mid-right 1=bot-left 2=bot-center 3=bot-right. If not connected, a random position is used each time.",
      "label": "山头位置",
      "mode": "parameter",
      "control": true
    },
    {
      "name": "seed",
      "type": "number",
      "access": "item",
      "defaultValue": 0,
      "description": "Random seed; 0 uses current time.",
      "label": "随机种子",
      "mode": "parameter",
      "control": true
    }
  ],
  "outputs": [
    {
      "name": "outputGrids",
      "type": "grid",
      "access": "list",
      "description": "One solid nested face per level: the i-th grid holds every cell whose elevation level is >= i (cell value = i). Each grid becomes its own child branch; wire straight into grid2node.grid (do not pass through grid_split_by_value). Because the faces are solid and stacked, hiding an upper layer reveals the face below instead of the ground.",
      "label": "实心层网格"
    },
    {
      "name": "outputLevels",
      "type": "number",
      "access": "list",
      "description": "Top height per level, aligned with outputGrids (lowest layer 0, +1 per level up). Must be wired to grid2node.z, otherwise every layer collapses onto the same plane.",
      "label": "层顶高度"
    },
    {
      "name": "outputGrid",
      "type": "grid",
      "access": "item",
      "description": "Single multi-value grid: each cell holds its elevation band index (1..contourLevels, outer to inner), others 0. Use it for preview and as the subtrahend of alg_region_subtract; build per-layer nodes from outputGrids instead.",
      "label": "等高线网格"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "access": "item",
      "description": "Name list [{id, name, type}] for the contour bands actually present in the grid.",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
