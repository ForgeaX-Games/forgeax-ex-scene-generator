// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "cellularAutomata",
  "contractVersion": "2.0.0",
  "opId": "cellular_automata",
  "description": "Batch-runs cellular automaton rules within a list of mask grids to evolve random noise into organic cave terrain.",
  "inputs": [
    {
      "name": "maskList",
      "type": "array",
      "description": "List of mask grids (number[][][]); each grid evolves independently. A single grid (number[][]) is also accepted and auto-wrapped.",
      "label": "蒙版列表"
    },
    {
      "name": "fillProbability",
      "type": "number",
      "defaultValue": 0.45,
      "description": "Initial probability of a cell being a wall (0–1); higher values produce more walls.",
      "label": "初始填充概率",
      "mode": "parameter"
    },
    {
      "name": "birthLimit",
      "type": "number",
      "defaultValue": 4,
      "description": "A floor cell becomes a wall when its wall neighbor count reaches this threshold.",
      "label": "出生阈值",
      "mode": "parameter"
    },
    {
      "name": "deathLimit",
      "type": "number",
      "defaultValue": 3,
      "description": "A wall cell dies (becomes floor) when its wall neighbor count falls below this threshold.",
      "label": "死亡阈值",
      "mode": "parameter"
    },
    {
      "name": "iterations",
      "type": "number",
      "defaultValue": 5,
      "description": "Number of CA simulation steps; more iterations produce smoother edges.",
      "label": "迭代次数",
      "mode": "parameter"
    },
    {
      "name": "borderWall",
      "type": "number",
      "defaultValue": 1,
      "description": "1 = force mask boundary cells to be walls (closed cave); 0 = open boundary.",
      "label": "边界为墙",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Base random seed; 0 uses built-in default. Each mask offsets by i×1000 for independent but reproducible results.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "caveGrids",
      "type": "array",
      "description": "List of cave grids (number[][][]): 0 = outside mask, 1 = cave wall, 2 = cave interior (passable). Values match nameList ids.",
      "label": "洞穴网格列表"
    },
    {
      "name": "nameList",
      "type": "array",
      "description": "Fixed name list: [{id:1, name:'洞穴墙'(cave wall)}, {id:2, name:'洞穴空间'(cave interior)}].",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
