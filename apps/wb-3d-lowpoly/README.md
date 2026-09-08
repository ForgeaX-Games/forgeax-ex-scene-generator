# 3D Lowpoly Generator

ForgeaX node-programming plugin: **3D Lowpoly Generator** (3D 低多边形生成器).
Parametric low-poly geometry via a node graph, with OCCT/replicad mesh baking
and a live three.js viewer. Built on the
[`@forgeax/node-runtime`](../../packages/node-runtime) kernel.

The geometry DSL compiler **auto-routes each model to one of three terminal
pipelines by content**:

| Pipeline | Trigger (DSL content) | Terminal chain | Export |
|---|---|---|---|
| **Static** | no `joint`, no `skin`/`skeleton` | `g_geometry_qc → [g_bake_object] → g_to_scene → scene_preview` | single merged multi-material `.glb` (`mode="static"`) |
| **URDF** | has `joint` | `g_geometry_qc → g_to_urdf` | URDF / animated `.glb` |
| **Character** | has `bone`/`skeleton`/`skin` | `g_skin_qc → g_bake_object → g_to_rig → rig_preview` | skinned `.glb` (`mode="character"`) |

`lowpoly:model.apply` also accepts an optional `pipeline` override
(`static` / `mechanical` / `urdf` / `character`) to force a route.

This app lives at `apps/wb-3d-lowpoly` inside the
[`forgeax-ex-scene-generator`](../../) monorepo.

## Quick start

```bash
# From the monorepo root — builds kernel + both apps:
bun install
bun run build

# Serve the 3D Lowpoly Generator (frontend on :9565, backend on :9567):
cd apps/wb-3d-lowpoly
bun run serve
```

`bun run serve` runs `scripts/serve-dist.mjs`: serves `frontend/dist`, spawns
`backend/dist/main.js`, and self-proxies `/api` and `/ws` at the same origin.

> **Note:** `forgeax-plugin.json` lists `"start":"bun run dev"` in the standalone
> entry for legacy compatibility. The real production run path is `bun run serve`
> (serve-dist). Use `bun run dev` only for per-subpackage development (hot-reload
> of frontend or backend individually).

## Ports

| Service | Port |
|---|---|
| Frontend (Vite / serve-dist) | 9565 |
| Backend (Fastify) | 9567 |

## Layout

```
backend/                         # Fastify backend
  src/
    main.ts                      # boot: Fastify app + 10 route groups + baker warmup
    runtime.ts                   # kernel Runtime + ProjectRegistry + battery scan
    routes/                      # REST + WS routes
    services/baker/              # OCCT/replicad WASM mesh baker
    agent/                       # agent screenshot / GLB export routes + services
    tool-handlers.ts             # Studio tool proxy (resolves backend URL)
frontend/                        # Vite + React UI
  src/
    App.tsx                      # pane router (viewer3d / left / center)
    workbench/WorkbenchHost.tsx  # mounts kernel <Editor> + 3D viewer iframe (?pane=viewer3d)
    surfaces/Viewer3DSurface.tsx # 3D viewer surface entry (static / URDF / character)
    surfaces/viewer3d/           # viewer hooks + store; three/ = three.js layer (scene-builder, rig, urdf-parser, live-sync, GLB)
    api/HttpApiClient.ts         # ApiClient over REST + WS (with backoff reconnect)
    theme.ts                     # plugin colour / icon overrides
batteries/                       # ~99 geometry domain ops
  Generate/                      # create geometry
    Primitive/    (8 ops)
    Profile/      (5 ops)
    Architecture/ (9 ops)
  Modify/                        # modify / transform
    CSG/          (12 ops)
    Transform/    (6 ops)
    Material/     (3 ops)
    Placement/    (3 ops)
  Assemble/                      # assemble / joints / collision / rig
    Assembly/     (9 ops)
    Collision/    (4 ops)
    Rig/          (3 ops)        # g_bone / g_skeleton / g_skin (character)
  Output/                        # bake / QC / export
    Bake/         (2 ops)
    QC/           (4 ops)        # incl. g_skin_qc
    Export/       (7 ops)        # three-pipeline terminals: g_to_urdf/g_to_scene/g_to_rig + *_preview + g_preview
# Counts above are a snapshot; the runtime source of truth is the
# `lowpoly:batteries.list` tool. Folder names are the palette categories
# (no numeric prefix); rail order is the explicit stage order
# Generate → Modify → Assemble → Output from batteryGrouping.ts.
vendor/                          # vendored geometry DSL types → vendor/dist (gitignored)
schemas/                         # .gitkeep stubs (schema files land here as batteries mature)
scripts/
  build-vendor.mjs               # compiles vendor/shared/types → vendor/dist (run before backend)
  serve-dist.mjs                 # `bun run serve` entry
  headless-renderer.mjs          # Playwright headless 3D renderer (?pane=viewer3d) for agent screenshots
forgeax-plugin.json              # plugin manifest (id @forgeax-plugin/wb-3d-lowpoly, 17 tools; 16 AI-exposed, screenshot.store internal)
SKILL.md                         # AI-readable op + workflow guide
```

## Status

Fully implemented. ~80 active domain batteries organised by pipeline stage
(Generate / Modify / Assemble / Output) + shared batteries from
`@forgeax/batteries-common`. The mechanical Parts family (gears, hinges,
knobs, panels, wheels/tires — ~20 ops) was removed; the DSL no longer exposes
`spur_gear`/`wheel`/`knob`/etc. — route mechanical-looking forms through
Profile/CSG instead. The baker still carries the underlying gear shape
builders (`backend/src/services/baker/ops/gears.ts`) for internal reuse
(smoke tests), but they are not DSL-reachable. OCCT/replicad WASM baker
(flat/faceted low-poly tessellation), content-addressed OBJ/GLB blob library,
and a three.js viewer with live-sync across **three terminal pipelines**
(static merged GLB / URDF articulated / character skeleton-skinning), per-agent
project lock, agent screenshot and GLB export tools, headless renderer daemon.

## License

Apache-2.0. See [`LICENSE`](./LICENSE).
