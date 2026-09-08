// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "multiSeed",
  "contractVersion": "1.0.0",
  "opId": "multi_seed",
  "description": "Borrow the input object's DataTree shape (branch topology / paths only, values ignored) and emit a same-shaped DataTree<number> where each branch gets a deterministic, distinct seed derived from hash(baseSeed, branchPath). Wire its output into a downstream object+seed battery's seed input to diversify random results per branch on DataTree fanout, with no change to the downstream battery.",
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
      "description": "Global base seed; 0 uses the current timestamp (different each run), any non-zero value yields a deterministic, reproducible seed tree.",
      "label": "基种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "seed",
      "type": "number",
      "access": "item",
      "description": "A seed tree with the same shape as the input, where each branch holds a distinct, deterministic number seed.",
      "label": "种子"
    }
  ],
  "deterministic": true
})
