// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "reactionDiffusion",
  "contractVersion": "1.0.0",
  "opId": "reaction_diffusion",
  "description": "Gray-Scott reaction-diffusion simulation. Two chemicals A and B react and diffuse on a grid; depending on F/K parameters it produces spots, stripes, mazes, coral, mitosis, and other organic textures.",
  "inputs": [
    {
      "name": "width",
      "type": "number",
      "defaultValue": 128,
      "description": "Output grid width.",
      "label": "宽度",
      "mode": "parameter"
    },
    {
      "name": "height",
      "type": "number",
      "defaultValue": 128,
      "description": "Output grid height.",
      "label": "高度",
      "mode": "parameter"
    },
    {
      "name": "iterations",
      "type": "number",
      "defaultValue": 5000,
      "description": "Simulation time-steps; more = more developed pattern.",
      "label": "迭代步数",
      "mode": "parameter"
    },
    {
      "name": "preset",
      "type": "string",
      "defaultValue": "spots",
      "description": "Preset auto-overrides feedRate/killRate; choose custom to use manual values.",
      "label": "预设",
      "options": [
        "custom",
        "spots",
        "stripes",
        "maze",
        "coral",
        "mitosis",
        "worms"
      ],
      "mode": "parameter"
    },
    {
      "name": "feedRate",
      "type": "number",
      "defaultValue": 0.055,
      "description": "Feed rate of chemical A (only when preset=custom).",
      "label": "投入速率 F",
      "mode": "parameter"
    },
    {
      "name": "killRate",
      "type": "number",
      "defaultValue": 0.062,
      "description": "Kill rate of chemical B (only when preset=custom).",
      "label": "消耗速率 K",
      "mode": "parameter"
    },
    {
      "name": "diffuseA",
      "type": "number",
      "defaultValue": 1,
      "description": "Diffusion coefficient of A.",
      "label": "A 扩散",
      "mode": "parameter"
    },
    {
      "name": "diffuseB",
      "type": "number",
      "defaultValue": 0.5,
      "description": "Diffusion coefficient of B.",
      "label": "B 扩散",
      "mode": "parameter"
    },
    {
      "name": "dt",
      "type": "number",
      "defaultValue": 1,
      "description": "Integration time step; too large causes blow-up.",
      "label": "时间步长",
      "mode": "parameter"
    },
    {
      "name": "seedDensity",
      "type": "number",
      "defaultValue": 0.05,
      "description": "Density 0~1 of initial random B perturbation seeds.",
      "label": "初始扰动密度",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed; 0 uses current timestamp.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "gridB",
      "type": "grid",
      "description": "Concentration of B (0~1 continuous). Patterns usually appear here.",
      "label": "B 浓度"
    },
    {
      "name": "gridA",
      "type": "grid",
      "description": "Concentration of A (0~1 continuous).",
      "label": "A 浓度"
    },
    {
      "name": "maskGrid",
      "type": "grid",
      "description": "Binary mask thresholded at B>0.3 (1=B present, 0=otherwise).",
      "label": "二值掩码"
    }
  ],
  "deterministic": true
})
