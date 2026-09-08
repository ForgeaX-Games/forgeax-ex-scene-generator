// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gridConvolve",
  "contractVersion": "1.0.0",
  "opId": "grid_convolve",
  "description": "Apply a preset or custom convolution kernel to a 2D grid with configurable padding modes.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Input 2D grid to convolve.",
      "label": "输入网格"
    },
    {
      "name": "preset",
      "type": "string",
      "defaultValue": "blur3x3",
      "description": "Preset kernel: blur, gaussian, sharpen, edge detection (laplacian/sobel), emboss; select custom to use a user-defined kernel.",
      "label": "预设核",
      "options": [
        "custom",
        "blur3x3",
        "blur5x5",
        "gaussian3x3",
        "gaussian5x5",
        "sharpen",
        "edge_laplacian",
        "edge_sobel_x",
        "edge_sobel_y",
        "emboss"
      ],
      "mode": "parameter"
    },
    {
      "name": "kernel",
      "type": "grid",
      "defaultValue": [],
      "description": "Custom convolution kernel (2D array, treated as a grid atom); only used when preset is custom. Rows and cols must be odd.",
      "label": "自定义核"
    },
    {
      "name": "padding",
      "type": "string",
      "defaultValue": "clamp",
      "description": "Padding mode: zero, clamp (replicate edge), wrap (periodic), reflect (mirror).",
      "label": "边界填充",
      "options": [
        "zero",
        "clamp",
        "wrap",
        "reflect"
      ],
      "mode": "parameter"
    },
    {
      "name": "normalize",
      "type": "string",
      "defaultValue": "auto",
      "description": "Normalize kernel weights: auto = normalize when positive weight sum > 0, yes = always, no = never.",
      "label": "归一化",
      "options": [
        "auto",
        "yes",
        "no"
      ],
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Convolved 2D grid.",
      "label": "卷积结果"
    }
  ],
  "deterministic": true
})
