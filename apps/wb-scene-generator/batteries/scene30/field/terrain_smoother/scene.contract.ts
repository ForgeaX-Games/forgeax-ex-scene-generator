// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "terrainSmoother",
  "contractVersion": "1.0.0",
  "opId": "terrain_smoother",
  "description": "Smooths a terrain grid using cellular automaton majority voting (Moore neighborhood), eliminating isolated terrain patches.",
  "inputs": [
    {
      "name": "terrainGrid",
      "type": "grid",
      "description": "Input terrain grid to smooth: 1=water, 2=sand, 3=grass.",
      "label": "地形网格"
    },
    {
      "name": "iterations",
      "type": "number",
      "defaultValue": 2,
      "description": "Number of smoothing iterations; more iterations produce smoother but less detailed terrain.",
      "label": "平滑迭代次数",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "smoothedGrid",
      "type": "grid",
      "description": "Smoothed terrain grid; same value encoding as input.",
      "label": "平滑地形网格"
    }
  ],
  "deterministic": true
})
