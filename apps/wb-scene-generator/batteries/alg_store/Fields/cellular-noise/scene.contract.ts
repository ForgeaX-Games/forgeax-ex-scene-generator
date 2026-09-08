// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "cellularNoise",
  "contractVersion": "1.0.0",
  "opId": "cellular_noise",
  "description": "Cellular (Voronoi/Worley) noise generator based on FastNoiseLite, supporting multiple distance functions and return types for cell, mosaic, or crack textures, with fractal support.",
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
      "description": "Noise sampling frequency; higher values produce denser cells.",
      "label": "频率",
      "mode": "parameter"
    },
    {
      "name": "fractalType",
      "type": "string",
      "defaultValue": "None",
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
      "name": "distanceFunction",
      "type": "string",
      "defaultValue": "EuclideanSq",
      "description": "Distance function: Euclidean, EuclideanSq (default, fast), Manhattan, or Hybrid.",
      "label": "距离函数",
      "options": [
        "Euclidean",
        "EuclideanSq",
        "Manhattan",
        "Hybrid"
      ],
      "mode": "parameter"
    },
    {
      "name": "returnType",
      "type": "string",
      "defaultValue": "Distance",
      "description": "Return type: CellValue, Distance, Distance2, Distance2Add, Distance2Sub, Distance2Mul, or Distance2Div.",
      "label": "返回类型",
      "options": [
        "CellValue",
        "Distance",
        "Distance2",
        "Distance2Add",
        "Distance2Sub",
        "Distance2Mul",
        "Distance2Div"
      ],
      "mode": "parameter"
    },
    {
      "name": "jitter",
      "type": "number",
      "defaultValue": 1,
      "description": "Jitter modifier for cell feature points (0~1); 0=regular grid, 1=maximum randomization.",
      "label": "抖动",
      "mode": "parameter"
    },
    {
      "name": "offsetX",
      "type": "number",
      "defaultValue": 0,
      "description": "X offset for noise sampling.",
      "label": "X偏移",
      "mode": "parameter"
    },
    {
      "name": "offsetY",
      "type": "number",
      "defaultValue": 0,
      "description": "Y offset for noise sampling.",
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
      "description": "Output grid with values in 0~1 (continuous floats).",
      "label": "噪声网格"
    }
  ],
  "deterministic": true
})
