// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "algTopologyPickWindows",
  "contractVersion": "1.0.0",
  "opId": "alg_topology_pick_windows",
  "description": "Picks `count` outward-facing window segments of `width` cells from an input topology (wall-like 0/1 grid). A candidate must remain wall on both ends (one cell extension) and have empty cells on both perpendicular sides along its full length (i.e. an exterior wall face). With random=true, candidates are shuffled by seed; otherwise sorted by dir+coord and uniformly sampled. Output is the chosen window cells.",
  "inputs": [
    {
      "name": "topology",
      "type": "grid",
      "required": true,
      "description": "0/1 topology grid (typically a wall) where windows will be picked.",
      "label": "输入拓扑"
    },
    {
      "name": "count",
      "type": "number",
      "defaultValue": 4,
      "description": "Target number of windows; the actual count may be smaller if candidates are insufficient.",
      "label": "窗数量",
      "mode": "parameter"
    },
    {
      "name": "width",
      "type": "number",
      "defaultValue": 2,
      "description": "Window segment width in cells.",
      "label": "窗宽度",
      "mode": "parameter"
    },
    {
      "name": "random",
      "type": "boolean",
      "defaultValue": true,
      "description": "true: shuffle candidates with seed; false: uniformly sample after sorting by dir+coord.",
      "label": "随机分布",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed (0 uses current timestamp); only used when random=true.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "topology",
      "type": "grid",
      "description": "0/1 topology of chosen window cells, same shape as input.",
      "label": "窗拓扑"
    }
  ],
  "deterministic": true
})
