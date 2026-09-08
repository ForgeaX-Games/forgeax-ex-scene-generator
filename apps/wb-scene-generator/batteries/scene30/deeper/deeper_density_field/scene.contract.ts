// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "deeperDensityField",
  "contractVersion": "1.0.0",
  "opId": "deeper_density_field",
  "description": "Generates a density weight map for deep-space scenes using fractal noise with power-curve polarization, creating highly uneven spatial distribution to guide POI placement.",
  "inputs": [
    {
      "name": "width",
      "type": "number",
      "defaultValue": 64,
      "description": "Number of columns in the output grid.",
      "label": "网格宽度",
      "mode": "parameter"
    },
    {
      "name": "height",
      "type": "number",
      "defaultValue": 64,
      "description": "Number of rows in the output grid.",
      "label": "网格高度",
      "mode": "parameter"
    },
    {
      "name": "scale",
      "type": "number",
      "defaultValue": 7,
      "description": "Base noise frequency (recommended 4–16): smaller = larger blobs, larger = finer detail.",
      "label": "噪声频率",
      "mode": "parameter"
    },
    {
      "name": "octaves",
      "type": "number",
      "defaultValue": 4,
      "description": "Number of fractal octaves (recommended 3–5); more = richer detail.",
      "label": "叠加层数",
      "mode": "parameter"
    },
    {
      "name": "persistence",
      "type": "number",
      "defaultValue": 0.11,
      "description": "Amplitude decay per octave (0.1–1.0); smaller = weaker high-frequency detail.",
      "label": "高频衰减",
      "mode": "parameter"
    },
    {
      "name": "polarize",
      "type": "number",
      "defaultValue": 4,
      "description": "Power-curve polarization exponent (recommended 4–10): higher = denser peaks and emptier valleys.",
      "label": "极化指数",
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
      "name": "densityGrid",
      "type": "grid",
      "description": "Density weight grid with values 0–100; higher values mean higher POI placement probability.",
      "label": "密度权重图"
    },
    {
      "name": "groundGrid",
      "type": "grid",
      "description": "All-1 ground grid representing flat terrain available for POI placement.",
      "label": "地面底图"
    }
  ],
  "deterministic": true
})
