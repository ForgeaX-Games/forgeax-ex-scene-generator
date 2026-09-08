// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "algPartitionBoundaries",
  "contractVersion": "1.0.0",
  "opId": "alg_partition_boundaries",
  "description": "Extracts inter-partition boundary cells from a list of partition grids. A cell is marked as boundary iff itself or any of its 8-neighbors are covered by ≥2 different partitions. Useful for recovering BSP split lines (including cross-intersection corners) or visualizing topology-split borders.",
  "inputs": [
    {
      "name": "partition",
      "type": "grid",
      "access": "list",
      "required": true,
      "description": "List of same-shape 0/1 grids, one per partition cell.",
      "label": "分块列表"
    }
  ],
  "outputs": [
    {
      "name": "topology",
      "type": "grid",
      "description": "0/1 boundary topology grid, same shape as input partition cells.",
      "label": "边界拓扑"
    }
  ],
  "deterministic": true
})
