// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "algPartitionConnect",
  "contractVersion": "1.0.0",
  "opId": "alg_partition_connect",
  "description": "Picks a minimal set of door cuts from a topology that separates a partition list, so all partitions become mutually reachable. Algorithm: collect inner-wall segments (topology cells whose 4-neighbors lie in two different partition labels), then run a randomized UnionFind over those segments until all partitions are connected, opening a 2-4 cell wide hole at each chosen segment's center. Output is the door-cell topology only.",
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
      "required": true,
      "description": "0/1 topology separating the partitions (walls, tracks, etc.); same shape as partition cells.",
      "label": "隔断拓扑"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed; 0 uses current timestamp.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "topology",
      "type": "grid",
      "description": "0/1 door-cell topology, same shape as input topology.",
      "label": "门拓扑"
    }
  ],
  "deterministic": true
})
