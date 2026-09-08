// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "islandsBaseNoise",
  "contractVersion": "1.0.0",
  "opId": "islands_base_noise",
  "description": "Accepts an input mask grid and generates island height and moisture maps plus an early coastline preview grid only for non-zero cells; zero cells remain 0 in all outputs.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Input mask grid; height and moisture are generated only for non-zero cells, zero cells remain 0 in all outputs.",
      "label": "输入网格"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed; 0 uses current time.",
      "label": "随机种子",
      "mode": "parameter"
    },
    {
      "name": "heightOctaves",
      "type": "number",
      "defaultValue": 5,
      "description": "Octave count for the height map.",
      "label": "高度八度",
      "mode": "parameter"
    },
    {
      "name": "heightPersistence",
      "type": "number",
      "defaultValue": 0.55,
      "description": "Amplitude persistence for the height map.",
      "label": "高度衰减",
      "mode": "parameter"
    },
    {
      "name": "moistureOctaves",
      "type": "number",
      "defaultValue": 4,
      "description": "Octave count for the moisture map.",
      "label": "湿度八度",
      "mode": "parameter"
    },
    {
      "name": "moisturePersistence",
      "type": "number",
      "defaultValue": 0.5,
      "description": "Amplitude persistence for the moisture map.",
      "label": "湿度衰减",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "description": "Early preview grid quantized by coastline thresholds.",
      "label": "预览地形"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "description": "Name list for the preview grid.",
      "label": "名称清单"
    },
    {
      "name": "heightMap",
      "type": "grid",
      "description": "Floating-point height map in the 0-1 range.",
      "label": "高度图"
    },
    {
      "name": "moistureMap",
      "type": "grid",
      "description": "Floating-point moisture map in the 0-1 range.",
      "label": "湿度图"
    }
  ],
  "deterministic": true
})
