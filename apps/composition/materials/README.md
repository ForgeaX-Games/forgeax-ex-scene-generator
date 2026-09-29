# Scene Generator 3D materials (plugin-local)

Plugin-builtin packs for **3DMesh** preview. These are **not** Asset Store (2D PNG) content.

| Kind | Directory | Scene layer | Match rule |
|------|-----------|-------------|------------|
| Object GLB props | [`models/`](./models/) | `asset_type: object` (or `asset`) | Exact pack `name`, or **family stem** → numbered variant |
| Terrain PBR | [`pbr/`](./pbr/) | tile layers | Exact: `asset_name` === `material.json` `"name"` |

## Quick start (reproduce / add packs)

1. Copy a pack folder under `models/<dir>/` or `pbr/<dir>/` (see READMEs for layout).
2. Keep `model.json` / `material.json` `"name"` stable — that string is what scenes reference.
3. Confirm the backend sees it:

```bash
curl http://localhost:9557/api/v1/models
curl http://localhost:9557/api/v1/materials
```

4. Set the layer `asset_name` (and `asset_type`) accordingly.
5. Preview in renderer mode **3DMesh** (Color / Asset for props; **Asset** for PBR terrain).

No upload UI, no POST import API, no DB rebuild — the backend rescans the filesystem on each list/get.

## Seed content (docs only in git)

Git tracks **READMEs + `.gitignore` only**. GLB / PNG pack binaries are **never committed** (see `.gitignore`). Keep packs locally under `models/` and `pbr/` using the name ↔ folder ↔ file tables in each subdirectory README — same layout the runtime scans.

Reference seed set (local / out-of-band):

- **45** object packs under `models/`
- **10** PBR packs under `pbr/`
