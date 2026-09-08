// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "algPartitionAbsorbTopology",
  "contractVersion": "1.0.0",
  "opId": "alg_partition_absorb_topology",
  "description": "Absorbs each non-zero topology cell into the first 4-adjacent partition (extending partitions to cover gap cells). Commonly used to re-absorb door cells into the rooms they connect. Returns a new partition list without mutating inputs.",
  "inputs": [
    {
      "name": "partition",
      "type": "grid",
      "access": "list",
      "required": true,
      "description": "List of same-shape 0/1 grids, one per partition cell.",
      "label": "分块列表"
    },
    {
      "name": "topology",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "0/1 topology (e.g. doors, corridor cells); same shape as partition cells. Non-zero cells will be absorbed into adjacent partitions.",
      "label": "待吸收拓扑"
    }
  ],
  "outputs": [
    {
      "name": "partition",
      "type": "grid",
      "access": "list",
      "description": "New partition list after absorption (count unchanged).",
      "label": "扩张后分块"
    },
    {
      "name": "count",
      "type": "number",
      "description": "Number of partitions (same as input).",
      "label": "分块数"
    }
  ],
  "deterministic": true
})
