// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "cellularAutomaton",
  "contractVersion": "1.2.0",
  "opId": "cellular_automaton",
  "description": "Cellular Automaton that evolves a grid by birth/survival thresholds, useful for generating caves, islands, and other terrain shapes.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Input grid; random mode uses dimensions only, threshold mode binarizes values, binary mode uses 0/1 values directly.",
      "label": "输入网格"
    },
    {
      "name": "initMode",
      "type": "string",
      "defaultValue": "random",
      "description": "Init mode: random = use grid size only with random init; threshold = binarize grid values; binary = use 0/1 grid directly (falls back to threshold if not binary).",
      "label": "初始化模式",
      "options": [
        "random",
        "threshold",
        "binary"
      ],
      "mode": "parameter"
    },
    {
      "name": "initProb",
      "type": "number",
      "defaultValue": 0.45,
      "description": "Random mode: alive probability; Threshold/binary fallback: binarization cutoff = 1-initProb (0~1).",
      "label": "初始存活率",
      "mode": "parameter"
    },
    {
      "name": "birthThreshold",
      "type": "number",
      "defaultValue": 5,
      "description": "A dead cell becomes alive when its alive neighbor count >= this value (0~8).",
      "label": "诞生阈值",
      "mode": "parameter"
    },
    {
      "name": "survivalThreshold",
      "type": "number",
      "defaultValue": 4,
      "description": "An alive cell stays alive when its alive neighbor count >= this value; otherwise it dies (0~8).",
      "label": "存活阈值",
      "mode": "parameter"
    },
    {
      "name": "iterations",
      "type": "number",
      "defaultValue": 5,
      "description": "Number of CA iterations; more iterations produce smoother structures.",
      "label": "迭代次数",
      "mode": "parameter"
    },
    {
      "name": "edgeAlive",
      "type": "boolean",
      "defaultValue": true,
      "description": "Treat out-of-bounds cells as alive; true for enclosed caves, false for open islands.",
      "label": "边界视为存活",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed; 0 uses default seed. Different seeds produce different results.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Output grid after all iterations; alive cells = 1, dead cells = 0.",
      "label": "输出网格"
    }
  ],
  "deterministic": true
})
