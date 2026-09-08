// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "awPerlinNoise",
  "contractVersion": "1.0.0",
  "opId": "aw_perlin_noise",
  "description": "Minimal Perlin noise generator for mountain scenes; only requires grid size and seed, all other parameters are fixed internally.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Reference grid used only to determine output dimensions; cell values are ignored.",
      "label": "参考网格"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 42,
      "description": "Random seed; different seeds produce different noise patterns.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Output noise grid with values in 0–1 (continuous floats).",
      "label": "噪声网格"
    }
  ],
  "deterministic": true
})
