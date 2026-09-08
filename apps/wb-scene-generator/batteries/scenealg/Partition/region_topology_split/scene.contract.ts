// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "algRegionTopologySplit",
  "contractVersion": "1.0.0",
  "opId": "alg_region_topology_split",
  "description": "Splits a region into 4-connected components by subtracting the topology cuts, then optionally re-absorbs topology cells into neighboring components. With absorb=true, each topology cell adjacent (4-neighbors) to a partition cell is added back to that partition cell — useful for door cuts that should still belong visually to the rooms they connect.",
  "inputs": [
    {
      "name": "region",
      "type": "grid",
      "required": true,
      "description": "0/1 region to be split.",
      "label": "输入区域"
    },
    {
      "name": "topology",
      "type": "grid",
      "required": true,
      "description": "0/1 topology used as cuts (walls, tracks, rivers); same shape as region.",
      "label": "切割拓扑"
    },
    {
      "name": "absorb",
      "type": "boolean",
      "defaultValue": false,
      "description": "true: each topology cell is absorbed into the first 4-adjacent component, so partitions cover the cut cells. false: clean split, topology cells belong to no partition.",
      "label": "反吸收拓扑",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "partition",
      "type": "grid",
      "access": "list",
      "description": "One 0/1 grid per connected component.",
      "label": "分块列表"
    },
    {
      "name": "count",
      "type": "number",
      "description": "Number of components.",
      "label": "分块数"
    }
  ],
  "deterministic": true
})
