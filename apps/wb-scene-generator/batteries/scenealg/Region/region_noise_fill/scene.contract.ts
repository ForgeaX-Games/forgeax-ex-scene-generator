// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "algRegionNoiseFill",
  "contractVersion": "1.0.0",
  "opId": "alg_region_noise_fill",
  "description": "Noise fill in density or count mode. mode=density (default) keeps each valid cell as 1 when noise(r,c,seed) > (1-density) from a coordinate-hash noise field, yielding a textured spatially-correlated mask; mode=count fills an exact number: take the top count valid cells by noise value descending (fillNoiseCount). Same coordinate + seed is deterministic. Usable for patchy vegetation/ore, exact or density-based.",
  "inputs": [
    {
      "name": "region",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "0/1 (or multi-valued) constraint region grid; the noise field is sampled only on non-zero valid cells.",
      "label": "输入区域"
    },
    {
      "name": "density",
      "type": "number",
      "defaultValue": 0.3,
      "description": "Target fraction of cells kept as 1 (threshold = 1 - density), 0..1. 1 = keep all, 0 = empty.",
      "label": "保留比例",
      "mode": "parameter"
    },
    {
      "name": "mode",
      "type": "string",
      "defaultValue": "density",
      "description": "density = threshold binarization (default, backward compatible); count = exact-count by noise value descending.",
      "label": "填充模式",
      "mode": "parameter"
    },
    {
      "name": "count",
      "type": "number",
      "defaultValue": 0,
      "description": "count mode: exact number of cells kept (clamped to valid cells).",
      "label": "目标格数",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Noise field seed; 0 uses current timestamp. Same coordinate + same seed is deterministic.",
      "label": "噪声种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "region",
      "type": "grid",
      "access": "item",
      "description": "A 0/1 point mask matching the input shape; kept cells = 1, others = 0.",
      "label": "填充网格"
    },
    {
      "name": "count",
      "type": "number",
      "access": "item",
      "description": "Number of cells actually kept as 1.",
      "label": "保留格数"
    }
  ],
  "deterministic": true
})
