# Plugin 3D object models (`materials/models`)

Built-in GLB props for **3DMesh** preview. **Not** part of the Asset Store.

## Pack layout (copy this to add a new model)

```text
materials/models/<Folder>/
  model.json    # required
  model.glb     # or whatever basename "file" points at
```

Minimal `model.json` (example = seed pack `firtree1`):

```json
{
  "name": "firtree1",
  "file": "model.glb",
  "targetHeightCells": 4,
  "category": "tree",
  "tags": ["mountain", "conifer", "fir"]
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `name` | yes* | Lookup key used as scene `asset_name`. *If omitted, folder name is used. |
| `file` | no | Basename only (default `model.glb`). Must exist next to the JSON. |
| `targetHeightCells` | no | World height in voxel cells (default `4`). |
| `category` / `tags` | no | Metadata only today — **not** used by the matcher. |

Name ↔ folder need not match, but seed packs keep them identical for clarity.

## How matching works

Shared by **3DMesh preview** and **mesh3d export** (`modelVariants.ts`):

1. **Exact**: scene `asset_name` equals a pack `name` → that GLB.
2. **Numbered / segmented family**: e.g. `firtree` → `firtree1`…`6`; `shrub` → `shrub_01_*` / `shrub_02_*` / `shrub_04_*` (stable hash per instance).
3. **Hard family extras**: `rock` → `rock1`/`rock2`/`moss_rock1`.
4. **Derived stem** (unified short ↔ long names): strip decorative prefixes (`realistic_hd_`, `realistic_high_poly_`, `realistic_`) and trailing `_N` / digits from the pack `name`, then match.  
   Examples: `northern_red_oak` → `realistic_hd_northern_red_oak_1`; `black_poplar` → `realistic_hd_black_poplar_1`; `high_poly_tree` → `realistic_high_poly_tree_1`; `real_tree` → `real_tree1`.

| Scene `assetName` (family) | Expands to pack `name`s | Typical layer |
|----------------------------|-------------------------|---------------|
| **`firtree`** | `firtree1`…`firtree6` | canopy |
| **`bushtree`** | `bushtree1`…`bushtree4` | midstory |
| **`shrub`** | `shrub_01_*`, `shrub_02_*`, `shrub_04_*` | understory |
| **`shrub_sorrel`** | `shrub_sorrel_01_*` | low understory |
| **`rock`** | `rock1`, `rock2`, `moss_rock1` | ground |
| **`northern_red_oak`** | `realistic_hd_northern_red_oak_1` | canopy |
| **`black_poplar`** | `realistic_hd_black_poplar_1` | canopy |
| **`high_poly_tree`** | `realistic_high_poly_tree_1` | canopy |
| **`real_tree`** | `real_tree1` | canopy |

Pin a single look with the full pack name, e.g. `shrub_01_3` or `moss_rock1`.

New long-named packs automatically get a short stem — no hand-maintained alias table required (except `rock` ↔ `moss_rock`).

## How to preview

Use **`3DMesh`** (Color or Asset; not Wire).  
Family names are **not** Asset Store cutouts — Billboard / Top / Iso Asset mode will miss them.

## API

- `GET /api/v1/models`
- `GET /api/v1/models/:name`
- `GET /api/v1/models/:name/file`

## Seed inventory (name ↔ folder ↔ file)

Every seed pack is `{folder}/model.json` + `{folder}/model.glb`.  
`name` always equals the folder name in this seed set.

| `name` (= scene `asset_name` when pinned) | folder | `file` | `targetHeightCells` | `category` |
|-------------------------------------------|--------|--------|---------------------|------------|
| `bushtree1` | `bushtree1/` | `model.glb` | 2.5 | midtree |
| `bushtree2` | `bushtree2/` | `model.glb` | 2.5 | midtree |
| `bushtree3` | `bushtree3/` | `model.glb` | 2.5 | midtree |
| `bushtree4` | `bushtree4/` | `model.glb` | 2.5 | midtree |
| `firtree1` | `firtree1/` | `model.glb` | 4 | tree |
| `firtree2` | `firtree2/` | `model.glb` | 4 | tree |
| `firtree3` | `firtree3/` | `model.glb` | 4 | tree |
| `firtree4` | `firtree4/` | `model.glb` | 4 | tree |
| `firtree5` | `firtree5/` | `model.glb` | 4 | tree |
| `firtree6` | `firtree6/` | `model.glb` | 4 | tree |
| `moss_rock1` | `moss_rock1/` | `model.glb` | 1 | rock |
| `real_tree1` | `real_tree1/` | `model.glb` | 5 | tree |
| `realistic_hd_black_poplar_1` | `realistic_hd_black_poplar_1/` | `model.glb` | 5 | tree |
| `realistic_hd_northern_red_oak_1` | `realistic_hd_northern_red_oak_1/` | `model.glb` | 5 | tree |
| `realistic_high_poly_tree_1` | `realistic_high_poly_tree_1/` | `model.glb` | 5 | tree |
| `rock1` | `rock1/` | `model.glb` | 1 | rock |
| `rock2` | `rock2/` | `model.glb` | 1 | rock |
| `shrub_01_1` … `shrub_01_9` | `shrub_01_N/` | `model.glb` | 1.2 | shrub |
| `shrub_02_1` … `shrub_02_4` | `shrub_02_N/` | `model.glb` | 1.2 | shrub |
| `shrub_04_1` … `shrub_04_4` | `shrub_04_N/` | `model.glb` | 1.2 | shrub |
| `shrub_sorrel_01_1` … `shrub_sorrel_01_11` | `shrub_sorrel_01_N/` | `model.glb` | 0.8 | shrub |

**Total: 45 packs.** After `git pull`, `GET /api/v1/models` should list these same `name` values.
