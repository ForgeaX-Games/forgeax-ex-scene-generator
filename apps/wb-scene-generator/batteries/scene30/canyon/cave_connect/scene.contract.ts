// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "caveConnect",
  "contractVersion": "1.0.0",
  "opId": "cave_connect",
  "description": "Repairs connectivity of cellular automata cave grids: BFS from the largest cave region carves tunnels through walls to connect all isolated spaces until the entire cave is fully connected.",
  "inputs": [
    {
      "name": "caveGrids",
      "type": "array",
      "description": "List of cave grids (number[][][]) from cellular_automata.caveGrids, or a single grid (number[][]). Also accepts input named caveGrid. 0=outside, 1=wall, 2=interior.",
      "label": "洞穴网格（列表或单张）"
    },
    {
      "name": "tunnelRadius",
      "type": "number",
      "defaultValue": 1,
      "description": "Radius of circular dilation when carving tunnels: 0=1 cell wide, 1=~3 cells wide. Default 1.",
      "label": "隧道半径",
      "mode": "parameter"
    },
    {
      "name": "minRegionSize",
      "type": "number",
      "defaultValue": 0,
      "description": "Isolated regions smaller than this area (in cells) are filled with walls instead of connected. 0=connect all. Default 0.",
      "label": "最小区域面积",
      "mode": "parameter"
    },
    {
      "name": "jitterAmount",
      "type": "number",
      "defaultValue": 1.5,
      "description": "Max perpendicular jitter offset when carving tunnels (in cells): 0=no jitter, 1.5=default. Higher values produce more jagged edges.",
      "label": "边界抖动幅度",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Seed for jitter randomness; 0 uses current timestamp for unique results each run.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "connectedGrids",
      "type": "array",
      "description": "List of repaired cave grids (when input is a list); all cave spaces fully connected, same value encoding as input.",
      "label": "联通洞穴网格列表"
    },
    {
      "name": "connectedGrid",
      "type": "grid",
      "description": "Single repaired cave grid (when input is a single grid).",
      "label": "联通洞穴网格（单张）"
    }
  ],
  "deterministic": true
})
