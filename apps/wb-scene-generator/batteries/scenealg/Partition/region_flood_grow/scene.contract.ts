// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "algRegionFloodGrow",
  "contractVersion": "1.0.0",
  "opId": "alg_region_flood_grow",
  "description": "Grows a set of organic blobs by randomized frontier flood-fill from seed points within a region constraint. For each seed, cells are pulled randomly from the growth frontier and expanded over 4-connected neighbors until the target cell count is reached, producing irregular lake-like shapes; later blobs avoid earlier ones (non-overlapping). size sets each blob's target cell count, sizeVariance adds ± jitter. Each blob is emitted as its own 0/1 grid, ordered by growth order.",
  "inputs": [
    {
      "name": "region",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "0/1 (or multi-valued) constraint region grid; blobs grow only on non-zero valid cells.",
      "label": "约束区域"
    },
    {
      "name": "points",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "Seed point mask grid; each non-zero cell is a growth seed (typically the points output of alg_points_scatter).",
      "label": "种子点掩码"
    },
    {
      "name": "size",
      "type": "number",
      "defaultValue": 40,
      "description": "Target cell count for each blob (growth stops at this size).",
      "label": "斑块大小",
      "mode": "parameter"
    },
    {
      "name": "sizeVariance",
      "type": "number",
      "defaultValue": 0.3,
      "description": "Random ± jitter ratio for the target size (0..1). 0 = uniform size; 0.3 = each blob randomized within ±30%.",
      "label": "大小抖动",
      "mode": "parameter"
    },
    {
      "name": "spacingDilate",
      "type": "number",
      "defaultValue": 0,
      "description": "Minimum ring gap between blobs. 0 = blobs only avoid overlap (identical to old behavior); >0 = after each blob is grown, its cells are dilated by this many 4-connected BFS steps and merged into the forbidden zone so later blobs cannot grow within it, keeping at least this many empty rings between blobs. Dilated cells are forbidden-zone only and are not part of any blob output. Replicates the minSpacing of the legacy lake_gen battery.",
      "label": "间距禁区",
      "mode": "parameter"
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
      "name": "partition",
      "type": "grid",
      "access": "list",
      "description": "One 0/1 grid per grown blob; list ordered by growth (seed) order.",
      "label": "斑块列表"
    },
    {
      "name": "count",
      "type": "number",
      "access": "item",
      "description": "Number of blobs actually grown.",
      "label": "斑块数"
    }
  ],
  "deterministic": true
})
