# Plugin PBR materials (`materials/pbr`)

Built-in terrain materials for **3DMesh → Asset** mode. **Not** part of the Asset Store (no 13-field aliases).

## Pack layout (copy this to add a new material)

### Textured pack

```text
materials/pbr/<Folder>/
  material.json
  *.png / *.jpg   # basenames referenced by maps.*
```

Example = seed pack `Grass`:

```json
{
  "name": "Grass",
  "maps": {
    "color": "Ground037_1K-PNG_Color.png",
    "normal": "Ground037_1K-PNG_NormalGL.png",
    "roughness": "Ground037_1K-PNG_Roughness.png",
    "ao": "Ground037_1K-PNG_AmbientOcclusion.png"
  },
  "normalSpace": "GL",
  "tiling": 0.25
}
```

| Field | Notes |
|-------|--------|
| `name` | **Exact** scene tile `asset_name` (case-sensitive). |
| `maps` | Slots: `color` \| `normal` \| `roughness` \| `ao` \| `displacement`. Values are **basenames only**. |
| `color` | Required for textured packs — missing/unloadable color → pack skipped. |
| `normalSpace` | `"GL"` (default) or `"DX"`. |
| `tiling` | UV scale (default `1`). |
| `shading` | omit / `"textured"`, or special modes below. |

### Procedural packs (no PNG maps)

- **`Water2`** — `"shading": "physicalWater"` + optional `water` params.
- **`Mount1`** — `"shading": "terrainBiome"`; blends named packs in `biome.layers` (seed: `Grass` / `Moss` / `Rock`).

Matching is **exact**: tile layer `assetName` === `material.json` `"name"`. No family stems, no aliases.

**Anti-tiling** is built into the 3DMesh splat shader (mild dual-scale UV + value noise).

## How to preview

Set mountain / ground / water tile `asset_name` to a pack name (e.g. `Mount1`, `Grass`, `Water2`), then open **3DMesh → Asset**.

## API

- `GET /api/v1/materials`
- `GET /api/v1/materials/:name`
- `GET /api/v1/materials/:name/maps/:slot` (`color` \| `normal` \| `roughness` \| `ao` \| …)

## Seed inventory (name ↔ folder ↔ files)

| `name` | folder | `shading` | `normalSpace` | `tiling` | map files (slot → basename) |
|--------|--------|-----------|---------------|----------|-----------------------------|
| `Grass` | `Grass/` | textured | GL | 0.25 | color=`Ground037_1K-PNG_Color.png`, normal=`Ground037_1K-PNG_NormalGL.png`, roughness=`Ground037_1K-PNG_Roughness.png`, ao=`Ground037_1K-PNG_AmbientOcclusion.png` |
| `Grass2` | `Grass2/` | textured | GL | 0.25 | color=`Grass007_1K-PNG_Color.png`, normal=`Grass007_1K-PNG_NormalGL.png`, roughness=`Grass007_1K-PNG_Roughness.png`, ao=`Grass007_1K-PNG_AmbientOcclusion.png` |
| `Ground` | `Ground/` | textured | GL | 0.25 | color=`Ground048_1K-PNG_Color.png`, normal=`Ground048_1K-PNG_NormalGL.png`, roughness=`Ground048_1K-PNG_Roughness.png`, ao=`Ground048_1K-PNG_AmbientOcclusion.png` |
| `Ground2` | `Ground2/` | textured | GL | 0.25 | color=`Ground067_1K-PNG_Color.png`, normal=`Ground067_1K-PNG_NormalGL.png`, roughness=`Ground067_1K-PNG_Roughness.png`, ao=`Ground067_1K-PNG_AmbientOcclusion.png` |
| `Moss` | `Moss/` | textured | GL | 0.25 | color=`Moss002_1K-PNG_Color.png`, normal=`Moss002_1K-PNG_NormalGL.png`, roughness=`Moss002_1K-PNG_Roughness.png`, ao=`Moss002_1K-PNG_AmbientOcclusion.png` |
| `Rock` | `Rock/` | textured | GL | 0.25 | color=`Rock030_1K-PNG_Color.png`, normal=`Rock030_1K-PNG_NormalGL.png`, roughness=`Rock030_1K-PNG_Roughness.png`, ao=`Rock030_1K-PNG_AmbientOcclusion.png` |
| `Sand` | `Sand/` | textured | GL | 1 | color=`sand_basecolor.png`, normal=`sand_normal.png`, roughness=`sand_roughness.png` |
| `Water` | `Water/` | textured | DX | 0.25 | color=`seamless_clear_water_surface_pbr_texture_with_light_reflections__BaseColor.png`, normal=`…__Normal_DX.png` |
| `Water2` | `Water2/` | physicalWater | — | 1 | *(no maps — see `material.json` `water` block)* |
| `Mount1` | `Mount1/` | terrainBiome | — | 1 | *(no maps — blends `Grass` / `Moss` / `Rock` by slope/height)* |

**Total: 10 packs.** After `git pull`, `GET /api/v1/materials` should list these same `name` values.

### `Mount1` biome (seed defaults)

Gentle slopes → **Grass**; cliffs → **Rock**; **Moss** = sparse noise. Set mountain tile `assetName` to `Mount1` (exact). See `Mount1/material.json` for `biome.*` knobs.
