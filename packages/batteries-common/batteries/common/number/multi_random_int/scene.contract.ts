// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "multiRandomInt",
  "contractVersion": "1.0.0",
  "opId": "multi_random_int",
  "description": "Borrow the input object's DataTree shape (branch topology / paths only, values ignored) and emit a same-shaped DataTree<number> where each branch gets an integer in [0, count) derived deterministically from hash(baseSeed, branchPath). Typical use: pick a per-branch index in [0,count) on DataTree fanout (e.g. choose one crop per land parcel), distinct per branch and reproducible, with no change to downstream batteries.",
  "inputs": [
    {
      "name": "shape",
      "type": "any",
      "access": "tree",
      "required": true,
      "description": "Any object's DataTree; only its shape (branch topology / paths) is used to determine the output structure. Values are ignored.",
      "label": "形状"
    },
    {
      "name": "seed",
      "type": "number",
      "access": "tree",
      "defaultValue": 0,
      "description": "Global base seed; 0 uses the current timestamp (different each run), any non-zero value yields a deterministic, reproducible integer tree.",
      "label": "基种子",
      "mode": "parameter"
    },
    {
      "name": "count",
      "type": "number",
      "access": "tree",
      "defaultValue": 4,
      "description": "Exclusive upper bound; each branch outputs an integer in [0, count). Falls back to 0 when count <= 0.",
      "label": "上界",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "value",
      "type": "number",
      "access": "item",
      "description": "An integer tree with the same shape as the input, where each branch holds a distinct, deterministic integer in [0, count).",
      "label": "随机整数"
    }
  ],
  "deterministic": true
})
