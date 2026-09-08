// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "valueNoise",
  "contractVersion": "1.0.0",
  "opId": "value_noise",
  "description": "Value noise generator based on FastNoiseLite, using Hermite-interpolated lattice random values with fractal support.",
  "inputs": [
    {
      "name": "width",
      "type": "number",
      "defaultValue": 128,
      "description": "Output grid width in pixels.",
      "label": "宽度",
      "mode": "parameter"
    },
    {
      "name": "height",
      "type": "number",
      "defaultValue": 128,
      "description": "Output grid height in pixels.",
      "label": "高度",
      "mode": "parameter"
    },
    {
      "name": "frequency",
      "type": "number",
      "defaultValue": 0.02,
      "description": "Noise sampling frequency; higher values produce denser detail.",
      "label": "频率",
      "mode": "parameter"
    },
    {
      "name": "fractalType",
      "type": "string",
      "defaultValue": "FBm",
      "description": "Fractal type: None, FBm, Ridged, or PingPong.",
      "label": "分形类型",
      "options": [
        "None",
        "FBm",
        "Ridged",
        "PingPong"
      ],
      "mode": "parameter"
    },
    {
      "name": "octaves",
      "type": "number",
      "defaultValue": 4,
      "description": "Number of fractal octaves; more octaves add finer detail.",
      "label": "八度数",
      "mode": "parameter"
    },
    {
      "name": "lacunarity",
      "type": "number",
      "defaultValue": 2,
      "description": "Frequency multiplier per octave.",
      "label": "间隙度",
      "mode": "parameter"
    },
    {
      "name": "gain",
      "type": "number",
      "defaultValue": 0.5,
      "description": "Amplitude multiplier per octave.",
      "label": "增益",
      "mode": "parameter"
    },
    {
      "name": "offsetX",
      "type": "number",
      "defaultValue": 0,
      "description": "X offset for noise sampling, used to pan the noise pattern.",
      "label": "X偏移",
      "mode": "parameter"
    },
    {
      "name": "offsetY",
      "type": "number",
      "defaultValue": 0,
      "description": "Y offset for noise sampling, used to pan the noise pattern.",
      "label": "Y偏移",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 1337,
      "description": "Random seed; different seeds produce different noise patterns.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Output grid; single-octave values are in ~[0,1] (continuous floats). Fractal modes (FBm/Ridged/PingPong) may slightly exceed this range. Renderer auto-detects as continuous grid.",
      "label": "噪声网格"
    }
  ],
  "deterministic": true
})
