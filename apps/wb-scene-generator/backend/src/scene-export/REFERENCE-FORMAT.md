# Scene Export — Reference Bundle Format (reverse-engineered)

Source of truth: the canonical bundle shipped at
`ai_grasshopper_scene_export_20260604_140256_extracted/ai_grasshopper/scene.zip`.

Our exporter MUST produce a bundle that the canonical `viewer.html` + `viewer.js`
(copied verbatim from the reference — see `assets/`) can render identically to the
editor Preview.

## Bundle file list (exact)

```
README.md
area-tag-query.ts
manifest.json
object-type-config.json
object_atlas.png
object_atlas.tsj
passability-config.json
serve.bat
serve.py
serve.sh
terrain-config.json
terrain.json
terrain_atlas.png
terrain_atlas.tsj
viewer.html
viewer.js
```

No `world-manifest.json`. The viewer/serve scripts + README + area-tag-query.ts are
the FIXED visualization payload — copied byte-for-byte from the reference.

## `manifest.json`

```jsonc
{
  "schemaVersion": "3.0",
  "bundleId": "<name>-YYYY-MM-DDTHH-MM-SS",
  "generatedAt": "2026-05-19 20:39:47 +0800",       // local, space-separated
  "generatedAtUtc": "2026-05-19T12:39:47.145Z",     // ISO
  "files": {
    "terrain": "terrain.json",
    "terrainConfig": "terrain-config.json",
    "objectTypeConfig": "object-type-config.json",
    "passabilityConfig": "passability-config.json",
    "terrainAtlas": { "tsj": "terrain_atlas.tsj", "image": "terrain_atlas.png" },
    "objectAtlas": { "tsj": "object_atlas.tsj", "image": "object_atlas.png" }
  }
}
```

## `terrain.json`

```jsonc
{
  "version": "2.0",
  "cols": <W>, "rows": <H>,
  "cells": {
    "<height int as string>": [ MapCell, ... ],   // grouped by height; (y,x) ascending
    "transition": [ SlopeCell, ... ]              // optional slope layer
  },
  "objects": [ ObjectInstance, ... ]              // draw order = array order
}
```

MapCell (LAYERED tiles — `template_id[i]`/`graphic_index[i]` are parallel, bottom→top):

```jsonc
{
  "x": 65, "y": 51,
  "height": 1,
  "template_id":   ["浅色草地", "墙体"],   // each painted layer at this cell, bottom→top
  "graphic_index": [0, 3],                  // index into terrainConfig.templates[tid].graphic_id
  "areaTags": { "area_L0": ["青岩山村"] }   // optional
}
```

Viewer composition (`viewer.js` `drawCellList`):
for `li` in `template_id`: `tileId = templates[template_id[li]].graphic_id[graphic_index[li]]`,
then draw `terrainTileById[tileId]` at the cell. So `graphic_index[i]` is an INDEX into the
template's `graphic_id` array, and that resolves to a tsj tile `id`.

ObjectInstance:

```jsonc
{ "instanceId": "hex", "typeId": "石头", "x": 3, "y": 1,
  "height": 0, "direction": 0, "interacted": false }
```

Viewer object draw: `tileId = objectConfig.types[typeId].graphic`; sprite drawn at anchor
cell `(x,y)` using the object tsj tile's `pivot`. PPU = 32 if `interaction === 'pickup'`, else 16.

## BILLBOARD projection (the export target is `topBillboard`, NOT `top`)

The editor feature this bundle mirrors renders in **`topBillboard`** mode, not the flat
`top` mode. In `topBillboard` every voxel `(x,y,z)` is drawn as TWO faces (see frontend
`modes/topBillboard/buildVoxelMaster/paintCell.ts` + `framework/geometry/topBillboard.ts`):

- a **top cap** at screen row `y - z - 1`, sprite = `pickFaceSprite(faces.top, …)`
- a **front wall** at screen row `y - z`, sprite = `pickFaceSprite(faces.front, …)`
  (only for rules that declare a `front` face)

with painter order **z ascending, top-before-front** so a higher voxel's front wall
occludes the top cap of the voxel below it.

The vendored `viewer.js` is a **flat `(x,y)` compositor** (it draws every `MapCell` at
`(x+0.5, y+0.5)*TILE`, grouping cells by the numeric `height` key ascending, then array
order — it does NOT itself do any `y-z` projection). It is therefore fully capable of
showing the billboard image **provided the cook bakes the billboard projection into the
exported cell coordinates**. So the cooker:

- emits the top-cap sprite at `(x, y - z - 1)` and the front-wall sprite at `(x, y - z)`,
- keeps the `cells` group key = the voxel elevation `z` (drives the viewer's E0/E1 buttons),
- within a merged screen cell records layers by `orderKey = [faceOrder (0=front,1=top), layerSeq]`
  so front walls paint before top caps (matching the billboard painter sort),
- projects objects to `(x, y - z)` (front-face anchoring),
- applies the global offset to the PROJECTED rows (projected `y` can be negative).

`graphic_index` semantics are unchanged (index into `templates[tid].graphic_id`), but the
sprite is now resolved with the billboard `pickFaceSprite` faces (top + front), not a flat
top-down pick. `tileRules.ts` mirrors both face paths bit-for-bit; parity is locked by
`tests/scene-export-renderer-parity.test.ts`.

## `terrain-config.json` (schemaVersion 3.0)

```jsonc
{
  "schemaVersion": "3.0",
  "templates": {
    "<template_id>": {
      "terrain_type": "base",
      "region": "village_idyll",
      "water_body_id": null,
      "passability": { "category": "passable", "moveCost": 1, "exploreSpeedMod": 1,
                       "requiredTags": [], "failMoveCost": null, "maxClimbDelta": 1,
                       "blocksLineOfSight": false },
      "navTerrain": "normal",
      "ramp": null,
      "graphic": { "ids": [1,2,...], "basePieces": 11, "variantProb": 0, "placement": "random" },
      "base_pieces": 11, "variant_prob": 0,
      "graphic_id": [1,2,...],            // tsj tile ids; graphic_index indexes THIS array
      "explore_speed_mod": 1, "battle_move_cost": 1
    }
  }
}
```

## `object-type-config.json` (schemaVersion 3.0)

```jsonc
{
  "schemaVersion": "3.0",
  "types": {
    "<typeId>": {
      "name": "路灯",
      "category": "decoration",
      "graphic": 0,                       // object tsj tile id
      "graphicSize": { "cols": 2, "rows": 8 },
      "graphicOffset": { "x": 0, "y": 0 },
      "objectHeight": 0,
      "collisionMask": [],
      "passability": { "blocksMovement": false, "blocksLineOfSight": false, "provideCover": null },
      "interaction": { "type": "none", "range": 1 },
      "interactionLegacy": "none",
      "variants": {}
    }
  }
}
```

NOTE: viewer reads `typeDef.interaction` and also handles it being an object via
`getInteractionType` (`{type}` or string). `graphic` is a top-level tile id (number).

## `passability-config.json` (schemaVersion 3.0) — GLOBAL config, not per-template

```jsonc
{
  "schemaVersion": "3.0",
  "heightThresholds": { "normalMaxDelta": 0, "slopeMaxDelta": 1, "bridgeIgnored": true },
  "sentinelHeights": { "cliff": 99, "abyss": -99, "validRange": { "min": -4, "max": 8 } },
  "movementTags": { "fly": { "label": "飞行", "ignoresHeightDelta": true }, ... },
  "cellMobilityArbitration": { "blockedRule": "anyLayerImpassable", "moveCostRule": "max",
                               "navTerrainRule": "max", "conditionalUnsatisfied": "blockedUnlessFailMoveCost" },
  "objectFootprintRule": { "source": "collisionMaskUnion", "respectsBlocksMovement": true,
                           "ignoresObjectHeight": true },
  "lineOfSight": { "enabled": false }
}
```

## `*_atlas.tsj` (Tiled tileset JSON 1.10)

```jsonc
{
  "type": "tileset", "version": "1.10", "tiledversion": "1.10.2",
  "name": "terrain", "image": "terrain_atlas.png",
  "imagewidth": 2277, "imageheight": 16,
  "columns": 0, "margin": 0, "spacing": 0,
  "tilewidth": 16, "tileheight": 16, "tilecount": 134,
  "tiles": [
    { "id": 0, "x": 0,  "y": 0, "width": 16, "height": 16,
      "pivot": { "x": 0.5, "y": 0.5 }, "collider": { "type": "none" } },
    { "id": 1, "x": 17, "y": 0, "width": 16, "height": 16, ... }
    // x advances by width + 1 (1px spacing); single row, y always 0
  ]
}
```

Atlas packing rules (observed):
- Single horizontal row. Tile `i` placed at `x = sum(prevWidths) + i*1` (1px gap), `y = 0`.
- `imagewidth = sum(widths) + (count-1)`, `imageheight = max(height)`.
- terrain tiles are 16×16; object tiles keep their native size (e.g. 26×128).
- `pivot` normalized [0,1], origin bottom-left, y-up. terrain default (0.5,0.5);
  objects default (0.5,0.2) in the reference (bottom-ish anchor).
- `collider` defaults to `{ "type": "none" }`.

## Coordinate / PPU conventions (from README)

- pivot/collider normalized [0,1], origin image bottom-left, y-up.
- terrain & scene objects PPU=16; pickup PPU=32; CELL_SIZE=64; asset scale = CELL_SIZE/PPU.
