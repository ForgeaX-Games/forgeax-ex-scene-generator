// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "algPartitionFieldQuantize",
  "contractVersion": "1.0.0",
  "opId": "alg_partition_field_quantize",
  "description": "Quantizes a [0,1] height scalar field into mutually exclusive elevation-tier partitions by maxElevationLayers: 0=all flat (single layer-0 partition), N=integer tiers 0..N (N+1 exclusive 0/1 masks covering all valid region cells). Also emits a multi-value levelGrid and default name list.",
  "inputs": [
    {
      "name": "region",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "Parent region mask bounding valid cells.",
      "label": "父区域"
    },
    {
      "name": "field",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "[0,1] height scalar field, typically from alg_field_mountain_contour.field.",
      "label": "高度场"
    },
    {
      "name": "maxElevationLayers",
      "type": "number",
      "defaultValue": 0,
      "description": "Integer. 0=flat only (tier 0); 1=max one elevation unit (tiers 0 and 1); N=tiers 0..N.",
      "label": "最高抬升层数",
      "mode": "parameter"
    },
    {
      "name": "namePrefix",
      "type": "string",
      "defaultValue": "等高线",
      "description": "Default partition name prefix; outputs namePrefix+tier index (e.g. Contour0, Contour1).",
      "label": "名称前缀",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "partition",
      "type": "grid",
      "access": "list",
      "description": "One 0/1 mask per elevation tier, index=tier 0..maxElevationLayers; mutually exclusive and covering all valid cells.",
      "label": "高度层分区"
    },
    {
      "name": "count",
      "type": "number",
      "access": "item",
      "description": "Partition list length = maxElevationLayers + 1.",
      "label": "层数"
    },
    {
      "name": "levelGrid",
      "type": "grid",
      "access": "item",
      "description": "Valid cells hold tier+1 (1..count), invalid=0; usable for subtract or grid_split_by_value.",
      "label": "多值高度网格"
    },
    {
      "name": "nameList",
      "type": "array",
      "access": "item",
      "description": "{ id, name } per tier, aligned with partition indices.",
      "label": "名称清单"
    }
  ],
  "deterministic": true
})
