// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "dlaAggregation",
  "contractVersion": "1.0.0",
  "opId": "dla_aggregation",
  "description": "Simulates Diffusion-Limited Aggregation: particles random-walk and stick on contact with existing structure, producing fractal branching patterns like coral, lightning, mineral veins, and frost crystals.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Input mask grid; non-zero cells define the simulation domain where particles walk and aggregate.",
      "label": "输入网格"
    },
    {
      "name": "particleCount",
      "type": "number",
      "defaultValue": 300,
      "description": "Total number of particles to aggregate; controls final structure size and complexity.",
      "label": "粒子数量",
      "mode": "parameter"
    },
    {
      "name": "seedMode",
      "type": "string",
      "defaultValue": "center",
      "description": "Seed placement: center=mask center, random=random positions, bottom=bottom edge, edges=mask boundary, scatter=evenly spread (farthest-point sampling).",
      "label": "种子模式",
      "options": [
        "center",
        "random",
        "bottom",
        "edges",
        "scatter"
      ],
      "mode": "parameter"
    },
    {
      "name": "seedCount",
      "type": "number",
      "defaultValue": 1,
      "description": "Number of initial seed cells. 1=classic single-point DLA; multiple seeds create multiple growth centers that eventually merge.",
      "label": "种子数量",
      "mode": "parameter"
    },
    {
      "name": "stickiness",
      "type": "number",
      "defaultValue": 1,
      "description": "Probability of sticking on contact. 1.0=instant stick (sparse dendrites), 0.3-0.5=moderate density, 0.01-0.1=very dense/compact. Low values let particles bounce and explore the surface before sticking.",
      "label": "粘附概率",
      "mode": "parameter"
    },
    {
      "name": "neighborMode",
      "type": "string",
      "defaultValue": "8",
      "description": "Adjacency mode: 4=cardinal only (sharper branches), 8=includes diagonals (thicker, rounder branches).",
      "label": "邻接模式",
      "options": [
        "4",
        "8"
      ],
      "mode": "parameter"
    },
    {
      "name": "biasAngle",
      "type": "number",
      "defaultValue": 0,
      "description": "Preferred growth direction (degrees): 0=grow upward, 90=grow rightward, 180=grow downward, 270=grow leftward. Only effective when biasStrength > 0.",
      "label": "偏向角度",
      "mode": "parameter"
    },
    {
      "name": "biasStrength",
      "type": "number",
      "defaultValue": 0,
      "description": "Growth bias strength (0-0.5). 0=isotropic growth, >0=preferential growth toward biasAngle. 0.1=slight, 0.3=noticeable, 0.5=strong.",
      "label": "偏向强度",
      "mode": "parameter"
    },
    {
      "name": "maxStepsPerParticle",
      "type": "number",
      "defaultValue": 5000,
      "description": "Max random-walk steps per particle before abandonment. Usually no need to adjust; increase only for very large grids.",
      "label": "最大步数",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed; 0 uses the current timestamp. Different seeds produce different branching patterns.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Output grid: aggregated cluster cells = 1, all others = 0.",
      "label": "聚集网格"
    }
  ],
  "deterministic": true
})
