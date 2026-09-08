// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "algFieldNoise",
  "contractVersion": "1.0.0",
  "opId": "alg_field_noise",
  "description": "Generates a [0,1] scalar noise field (a field/scalar field, as opposed to a 0/1 mask region) on the valid (non-zero) cells of the input region: each valid cell (r,c) outputs the continuous noise value hashNoise(floor(r*scale), floor(c*scale), seed); cells outside the region output 0. Reuses the same coordinate-hash noise as region_noise_fill but without threshold binarization, writing the raw noise value into the grid to yield a spatially-correlated continuous field. scale rescales coordinates before sampling — larger means higher spatial frequency (busier). Same coordinate + same seed is deterministic; usable as a downstream density/weight/perturbation field.",
  "inputs": [
    {
      "name": "region",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "0/1 (or multi-valued) constraint region grid; noise is sampled only on non-zero valid cells, invalid cells output 0.",
      "label": "输入区域"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Noise field seed; 0 uses current timestamp. Same coordinate + same seed is deterministic.",
      "label": "噪声种子",
      "mode": "parameter"
    },
    {
      "name": "scale",
      "type": "number",
      "defaultValue": 1,
      "description": "Coordinate scale factor applied before hashNoise, controlling spatial frequency. >1 is busier, <1 is smoother. Default 1.",
      "label": "坐标缩放",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "field",
      "type": "grid",
      "access": "item",
      "description": "A scalar field (number[][]) matching the input shape: valid cells hold a [0,1] noise scalar, invalid cells are 0. Note this is a continuous scalar field, not a 0/1 mask.",
      "label": "噪声场"
    }
  ],
  "deterministic": true
})
