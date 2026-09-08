// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "scenePruneToFocus",
  "contractVersion": "1.0.0",
  "opId": "scene_prune_to_focus",
  "description": "Physically prune the graph down to the current focus node plus its descendants — ancestors and siblings are dropped (no longer referenced, eligible for GC). After pruning, focus becomes the new graph's local root; the original absolute path is recorded as focusOrigin (display/audit only, not resolvable). Once pruned, focus can no longer move back to an ancestor/sibling from the original graph — branch before pruning if that's still needed downstream.",
  "inputs": [
    {
      "name": "scene",
      "type": "scene",
      "access": "item",
      "required": true,
      "description": "Input scene (graph will be pruned down to the focus subtree).",
      "label": "scene"
    }
  ],
  "outputs": [
    {
      "name": "scene",
      "type": "scene",
      "access": "item",
      "description": "Scene whose graph has been pruned to the focus subtree; focusOrigin records the pre-prune absolute path.",
      "label": "scene"
    }
  ],
  "deterministic": true
})
