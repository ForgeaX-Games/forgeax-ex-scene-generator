// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "hydraulicErosion",
  "contractVersion": "1.0.0",
  "opId": "hydraulic_erosion",
  "description": "Droplet-based hydraulic erosion (Sebastian Lague's algorithm). Each droplet rolls along the terrain, picks up sediment on slopes and deposits on flats. After many iterations the heightmap develops natural valleys and alluvial plains.",
  "inputs": [
    {
      "name": "heightGrid",
      "type": "grid",
      "description": "Input continuous heightmap (recommended 0~1 normalized) to be eroded.",
      "label": "高度图"
    },
    {
      "name": "iterations",
      "type": "number",
      "defaultValue": 50000,
      "description": "Number of droplets simulated; more droplets = deeper, finer erosion.",
      "label": "雨滴数",
      "mode": "parameter"
    },
    {
      "name": "inertia",
      "type": "number",
      "defaultValue": 0.05,
      "description": "Droplet directional inertia 0~1; higher = straighter paths.",
      "label": "惯性",
      "mode": "parameter"
    },
    {
      "name": "sedimentCapacity",
      "type": "number",
      "defaultValue": 4,
      "description": "Sediment capacity coefficient; higher = carries more sediment.",
      "label": "携沙系数",
      "mode": "parameter"
    },
    {
      "name": "erodeSpeed",
      "type": "number",
      "defaultValue": 0.3,
      "description": "Erosion rate per step 0~1.",
      "label": "侵蚀速率",
      "mode": "parameter"
    },
    {
      "name": "depositSpeed",
      "type": "number",
      "defaultValue": 0.3,
      "description": "Deposition rate per step 0~1.",
      "label": "沉积速率",
      "mode": "parameter"
    },
    {
      "name": "evaporateSpeed",
      "type": "number",
      "defaultValue": 0.01,
      "description": "Water evaporation rate per step.",
      "label": "蒸发速率",
      "mode": "parameter"
    },
    {
      "name": "gravity",
      "type": "number",
      "defaultValue": 4,
      "description": "Downhill acceleration coefficient.",
      "label": "重力",
      "mode": "parameter"
    },
    {
      "name": "maxLifetime",
      "type": "number",
      "defaultValue": 30,
      "description": "Maximum simulation steps per droplet.",
      "label": "雨滴寿命",
      "mode": "parameter"
    },
    {
      "name": "radius",
      "type": "number",
      "defaultValue": 3,
      "description": "Erosion brush radius (how many surrounding cells are affected).",
      "label": "侵蚀半径",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed; 0 uses the current timestamp.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "heightGrid",
      "type": "grid",
      "description": "Eroded continuous heightmap.",
      "label": "侵蚀后高度图"
    }
  ],
  "deterministic": true
})
