# Changelog

> **Maintenance convention.** Add an entry under `## Unreleased` for every
> substantive change, grouped by `Added` / `Changed` / `Fixed` / `Removed`, and
> state the *why*. The kernel is the in-repo `workspace:*` packages under
> `packages/*` — there is no `external/` submodule pin to cite. Every commit that
> touches `apps/wb-3d-lowpoly/*` source updates this file. History is
> **append-only** — never rewrite past entries; corrections append a new entry
> stating the reason. See [`AGENTS.md`](./AGENTS.md).

## Unreleased

### Changed
- **Release identity now belongs to the Scene Generator package.** This app is published inside `@forgeax-extension/scene-generator` as the `3d-model` module; it is no longer an independently published npm package. *为什么：* the three workbenches share one product lifecycle.

- **Aligned architecture maps with 82 domain ops after dropping Generate/Parts.** `ARCHITECTURE.md` now lists Primitive(9)/Architecture(12)/Animation Clip(2)/QC(3) and no Parts; `docs/architecture/backend.md` says 82 domain + 45 common = 127. *为什么：* Generate/Parts was dropped; leftover 101 / Parts(20) / Primitive(8) contradicted `meta.json`.
- **Aligned architecture maps with 45 common ops, 101 domain ops, and project-scoped batch.** `docs/architecture/backend.md` / `ARCHITECTURE.md` / `AGENTS.md` now describe `POST /api/v1/projects/:projectId/batch` via `registerProjectPipelineRoutes` and mark `mutations.ts` as an empty stub. *为什么：* maps still said 32 shared ops and unscoped `/api/v1/batch`.

### Fixed

- **Slug-root `package.json` no longer declares `workspace:*`, so Studio `bun install` can install this directory.** `@forgeax/node-runtime` stays `workspace:*` on `backend`/`frontend` only. Tests: `scripts/standalone-plugin-dependencies.test.mjs`, `scripts/serve-dist.test.mjs`. Cold start: `scripts/dev.mjs` / `serve-dist.mjs` call `ensureWorkspacePackages`. SSOT: [`docs/development-and-release.md`](../../docs/development-and-release.md). *为什么：* Studio `prepare.ts` bun-installs the marketplace symlink to this slug root and cannot be changed this round.
- **Correction: `file:` in this app's `package.json` is not the install path.** The Unreleased bullet below that switched `@forgeax/node-runtime` to `file:../../packages/node-runtime` for Studio `bun install` is superseded. Apps keep `workspace:*`; Studio installs `@forgeax-extension/3d-lowpoly` from `release/`. SSOT: [`docs/development-and-release.md`](../../docs/development-and-release.md). *为什么：* relative `file:` dies outside this tree; mixing a pnpm workspace member with a Bun-installable extension already failed twice.
- **Op-directory generation now imports its registry through a file URL.**
  `scripts/gen-op-directory.mjs` converts the generated registry path with
  `pathToFileURL(...).href`; regression:
  `scripts/gen-op-directory-import.test.mjs`. *为什么：* Node 24 validates
  dynamic-import specifiers strictly on Windows and rejects a raw filesystem
  path.
- **Standalone installs no longer depend on pnpm's workspace protocol.**
  `package.json` now resolves `@forgeax/node-runtime` through the repository-local
  `file:../../packages/node-runtime` path, so Studio's direct `bun install` can
  install this plugin. Regression: `scripts/standalone-plugin-dependencies.test.mjs`.
  *为什么：* Studio installs a plugin directly rather than through pnpm's
  workspace resolver.
- **Architecture DSL compilation now preserves authored dimensions and component
  identity.** `floor_slab.size`, `roof.footprint`, `facade_panel.panel_size`, and
  `window.size` are explicitly adapted to their batteries' scalar ports instead
  of silently falling back to editor defaults. `door_frame` and `door_leaf` now
  execute through dedicated one-component batteries rather than both expanding
  through the composite `g_door`, preventing duplicate/mis-sized door geometry
  and restoring exact graph-to-DSL round trips. Nested wall openings and slab
  holes are serialized through their JSON-string ports, and parser helpers are
  no longer exported as candidate battery entrypoints, so runtime loading cannot
  accidentally execute a parser instead of the geometry generator.
- **Architecture edge cases now fail or size deterministically.** Floor holes
  are rejected when they extend beyond the slab in both the battery and OCCT
  baker; sidelight doors compute the central leaf opening from the actual jamb
  and divider geometry; and `g_wall` no longer emits zero-valued window-band
  overrides when the UI contract says zero means “auto”.

### Changed

- **Workbench manifest migrated to the Page contract.** `forgeax-plugin.json`
  now contributes one Page, one reusable panel type, explicit sidebar/workspace
  placements, and a horizontal left/right Page layout. *Why:* panel availability and
  position must have one Page-owned SSOT instead of legacy split metadata.

- **The AI authoring surface is now DSL-only and bounded.** Legacy
  `batteries.*`/`pipeline.*` tools are hidden from AI, persona/skill routing is
  shorter, QC returns top-K aggregates with a persisted full report, and old
  `model.apply` history can be compacted without losing the latest DSL. Why:
  fixed prompt duplication and unbounded tool/history growth caused avoidable
  context overflow.
- **Quality guidance is richer but remains non-blocking.** `model.apply` exposes
  metrics, primitive ratio, dimensions, compact bake provenance and degraded
  status without changing existing `ok`/`valid` semantics.

- **Auto-skin (`g_skin`, `frontend/.../three/auto-skin.ts`) tightened further to
  reduce animation deformation amplitude.** Why: even with the earlier
  `falloff=4`/`maxInfluences=2` hardening, the (previously unexposed)
  `radiusFactor=2.5` relative-distance cutoff still let a vertex's second-nearest
  bone sneak into its weight set fairly easily, softly blending limb "belly"
  vertices toward neighboring segments and producing more visible stretch/candy-
  wrapper deformation than desired. `DEFAULT_RADIUS_FACTOR` 2.5 → 1.6 (tighter
  cutoff, fewer far bones qualify) and the effective default `falloff` 4 → 5
  (sharper weight decay among the bones that do qualify) — set both in
  `auto-skin.ts` and, since `g_to_rig/index.ts` supplies its own fallback when the
  DSL omits `skin(falloff=...)`, there too (`meta.json` default/description for
  `g_skin.falloff` updated to match). `radiusFactor` is still not exposed via the
  DSL — only tunable by editing the `auto-skin.ts` constant.

### Added

- **Direct-to-Editor GLB import workflow.** The viewer now exposes a single
  project-relative destination dialog, while `lowpoly:export-to-engine` gives AI
  one structured export → Editor import action. Both paths use the host's
  versioned `editor.asset.import` capability and the Editor's existing
  `assetIO` → `importAsset` SSOT. *Why:* generated assets should reach the game
  project without making people manually download and re-import files, and AI
  calls should return compact receipts instead of base64.

- **`model.bakeBatch`, source-hash `model.patch`, and Placement DSL support.**
  Independent part batches reduce LLM round trips, hash conflicts protect human
  edits, and `align_centers`/`place_on_face`/`place_on_surface` use computed
  geometry bounds instead of hand-calculated origins.
- **Three fixed lowpoly benchmark tasks and telemetry reporting** split system,
  tool schema, history, tool arguments and tool results into character/token
  estimates with call counts and duration.

- **Three terminal pipelines, content-routed (static / URDF / character).** Why:
  static props were previously forced through the URDF terminal (a single-link
  robot) just to preview/export, which was conceptually wrong and blocked a clean
  merged-GLB path. The DSL compiler (`dsl-to-graph.ts`) now inspects the graph and
  routes to one of three terminal chains — auto-inferred by content, with an
  optional explicit `pipeline` override on `lowpoly:model.apply`
  (`static` / `mechanical`|`urdf` / `character`):
  - **Static** (no `joint`, no `skin`/`skeleton`): `g_geometry_qc → [g_bake_object]
    → g_to_scene → scene_preview`. New batteries `g_to_scene` (Output/Export) emits
    a `SceneSpec` IR (placed, colored mesh references) and `scene_preview` (terminal)
    hands it to the viewer. Real-shape parts are merged into a **single
    multi-material `.glb`** via `g_bake_object`; mesh-ref scenes skip the bake and
    place library blobs directly. Exports `mode="static"`.
  - **URDF** (has `joint`): unchanged `g_geometry_qc → g_to_urdf`; articulated `.glb`.
  - **Character** (has `bone`/`skeleton`/`skin`): `g_skin_qc →
    g_bake_object → g_to_rig → rig_preview`; skinned `.glb` (`mode="character"`).
- **Scenes now route through the static pipeline.** Multi-part jointless scenes
  merge into one multi-material GLB via `g_to_scene`; the old URDF auto-stitch
  (synthetic fixed joints / floating-link + island QC) is no longer used for scenes.
- **New CSG battery `g_fillet` (Modify/CSG) — general-purpose edge fillet/chamfer
  on any solid.** Why: replicad's `.fillet()`/`.chamfer()` were only used *inside*
  individual part builders (`brackets`/`controls`/`panels`/`architecture`); there
  was no way for an agent to round or bevel the edges of an arbitrary CSG/primitive
  solid (a box enclosure, a differenced shell, an extruded plate). This closes the
  single highest-leverage modeling gap (Blender's Bevel modifier equivalent) with
  zero new kernel dependency.
  - Battery `batteries/Modify/CSG/g_fillet/` (`meta.json`+`index.ts`+`icon.svg`):
    inputs `shape_id` (upstream solid), `radius`, `type` (`round` fillet / `chamfer`
    bevel), `edges` (`all` / `vertical` = only edges parallel to Z). Emits DSL
    `fillet(...)` or `chamfer(...)` depending on `type`; reads `error` on bad
    ref / non-positive radius / invalid enum like the other CSG ops.
  - DSL grammar: two new `OpSpec`s (`fillet`, `chamfer`) in `op-registry.ts`, both
    added to `SUBGRAPH_BAKE_OPS` so `g_bake_part` / `g_to_urdf` route them through
    the geometry-subgraph bake path (like `translate`/`rotate`). Rebuild via
    `pnpm build:vendor`.
  - Baker: `buildStatementShape` in `baker.service.ts` handles `fillet`/`chamfer`
    by resolving the referenced solid then calling replicad `.fillet/.chamfer`
    (all edges, or `e.inDirection([0,0,1])` for `edges="vertical"`). Rejects
    mesh-backed operands (pipe/sweep/section_loft) via `ensureReplicadShape`, and
    wraps OCCT failures (e.g. radius larger than the adjacent face) in a
    `BakerError` so `g_to_urdf` falls back to an AABB box.
  - QC: `aabb.ts` resolves `fillet`/`chamfer` to the referenced shape's AABB
    (conservative — beveling only shrinks corners), so QC overlap checks keep
    working instead of reporting the op as an unregistered shape.

- **Architecture assembly/placement contract documented + placement-hint outputs
  on `g_wall`/`g_door` (both bumped to `1.2.0`).** Why: agents produced buildings
  where wall holes and windows didn't line up, door leaves poked out of frames,
  floors were mis-sized / the upper storey had no slab, and stairs were missing —
  none of which are baker geometry bugs. The baker's coordinate convention
  (elements X/Y-centered, base at Z=0; opening `x`=offset from wall midpoint,
  `sill`/`head`=absolute Z) lived only in `ops/architecture.ts` comments, never in
  the agent-facing skill docs, so the assembly step had no alignment recipe.
  - Docs: new **对齐配方 · Placement recipes** section in
    `skills/compose-lowpoly/executions/part-b-building.md` (opening↔window/door
    mapping `width=w, height=head−sill, origin=[x,0,sill]`, parent to the *wall*
    not the root slab; door-leaf hinge origin; per-storey slab sized to footprint;
    stairs↔upper-slab well), plus a runnable end-to-end aligned example and a
    Placement-contract summary in the Architecture page of `modeling-guide.md`.
  - `g_wall` now returns **`opening_placements`** (JSON per opening:
    `{origin:[x,0,sill], width, height, depth}`) so agents copy the window/door
    placement instead of recomputing it.
  - `g_door` now returns **`frame_origin`**, **`leaf_origin`** and
    **`leaf_origins`** (JSON) — the leaf's local origin is at the hinge edge, so
    the suggested joint origin is `[∓clearW/2,0,0]` (one per jamb for double doors),
    preventing leaves placed concentric with the frame from poking out.
- **Building guidance: overlap discipline + the moving-joint QC trap, and
  "not limited to Architecture ops".** Why: after the alignment fix, windows lined
  up but doors still failed QC. Root cause is `g_geometry_qc` behavior, not the
  door battery — in an all-`g_joint_fixed` assembly, benign architectural AABB
  overlaps (wall corners, embedded frames, leaf-in-frame, stairs-in-well) are only
  warnings, but a **single moving joint** (`g_joint_revolute` for an openable door)
  promotes **every** overlap in the model to fatal. New **R5** in
  `part-b-building.md` (mirrored in `modeling-guide.md`): prefer `g_joint_fixed` for
  static buildings; if a door must swing, whitelist benign pairs via
  `g_geometry_qc` `allow_pairs`/`allow_joints`, and use `g_metrics`
  (`max_penetration`/`overlap_ratio`) to separate real clashes from conservative
  AABB false positives; the aligned example now uses a fixed leaf. Also new **§1.5**
  encouraging non-Architecture families (Primitive/CSG/Parts/Transform/Material) to
  enrich detail (chimneys, sills, bay windows, handles, vents, arrays, color) rather
  than restricting buildings to the 9 Architecture ops.
- **Architecture batteries (9) gained optional shaping parameters (all
  backward-compatible, defaults preserve prior geometry); each battery `meta`
  bumped to `1.1.0`.** Why: the arch family only exposed bare massing knobs, so
  producing believable buildings needed post-processing. New parameters are
  implemented natively in the OCCT baker (`backend/src/services/baker/ops/architecture.ts`),
  declared in `op-registry.ts`, defaulted in `arch-defaults.ts`, and sized in
  `aabb.ts`:
  - `g_wall`: auto horizontal `window_band` (`band_sill`/`band_head`/`band_margin`,
    optional `pane_width` + `mullion` division) and a `plinth_height` /
    `plinth_projection` base.
  - `g_roof`: split `eave_overhang` (span) vs `verge_overhang` (ridge) for pitched
    roofs; flat-roof `parapet_height` / `parapet_thickness` with optional
    `coping_width` cap; consistent ridge orientation.
  - `g_stairs`: `tread_thickness` + `open_riser` for thin open treads, an optional
    mid-run landing (`landing_depth` / `landing_after`), and cleaner spiral wedge
    treads.
  - `g_column`: `taper` (top/bottom radius ratio), `base_style` / `capital_style`
    (`plain`/`stepped`), and optional `flutes` count (round shafts).
  - `g_door`: multi-`leaves`, `panel_rows` / `panel_cols` recessed grid, optional
    `transom` and `sidelight`.
  - `g_window`: automatic pane division by target `pane_width`, projecting `sill`,
    optional `arch_top`.
  - `g_railing`: `post_shape` (`round`/`square`) + `post_radius`, baluster count from
    `post_spacing`, optional `bottom_rail` / `mid_rail`, `top_rail_width` /
    `top_rail_height`.
  - `g_floor_slab`: perimeter downstand beam (`beam_depth` / `beam_width`) and edge
    `edge_chamfer`.
  - `g_facade_panel`: `groove_direction` (`horizontal`/`vertical`/`both`), groove
    layout by `groove_spacing`, and `board_style` (`flush`/`lap`/`shiplap`) lap
    offset.

- **New `g_metrics` battery (`batteries/Output/QC/g_metrics/`) — quantitative
  geometry evaluation + a 0–100 health score.** Why: `g_geometry_qc` emits boolean
  signals (is there a problem, for fix loops); nothing quantified *how bad* /
  *how good* a result is. `g_metrics` reports basic info (parts/joints/DOF, overall
  bbox size + footprint area, rich vs primitive, arch/csg counts) and quality
  metrics (sibling AABB `overlap_pairs`/`overlap_volume`/`max_penetration`/
  `overlap_ratio`, `moving_joint_collisions`, `islands`/`floating_links`/
  `joints_with_gap`/`max_joint_gap`, grounding `ground_offset`, richness, poly
  budget) as a multiline `report` + scalar ports + `score`/`grade`. Read-only,
  auto-scanned by `lowpoly:batteries.list`, reuses the shared FK/AABB math. See
  `batteries/Output/QC/g_metrics/index.ts`.
- **New shared vendor geometry modules (SSOT / de-dup targets).**
  `vendor/shared/types/geometry/fk.ts` (world-frame forward kinematics
  `computeWorldTransforms` + AABB overlap/point-AABB/AABB-AABB distance + rpy→mat3,
  extracted from `g_geometry_qc` so QC and `g_metrics` share one implementation);
  `arch-defaults.ts` (`ARCH_DEFAULTS` — roof/wall/floor defaults);
  `parse-quad.ts` (`parseQuadList` — shared "[a,b,c,d] list" parser). All
  re-exported from `vendor/shared/types/geometry/index.ts`.
- **Gears consolidated 15 → 6 parametric Parts batteries (`g_gear` + friends).**
  Why: 15 near-duplicate gear batteries diverged on tooth math and tessellation and
  buried the common 90% case. The 6 survivors live under `batteries/Generate/Parts/`
  and select tooth shape via a `tooth_profile` enum (`spur`/`helical`/`herringbone`/
  `hyperbolic`) instead of one battery per profile. Dead per-profile params were
  pruned from `op-registry.ts`. The baker keeps every underlying gear DSL builder,
  so the new batteries still emit the original DSL ops. See `SKILL.md` /
  `skills/compose-lowpoly/*` for the routing (`g_gear` with `tooth_profile`, gears
  are now a Parts detail).

### Removed

- **`g_building_shell` orchestrator battery + its BSP layout dead code.** Why: the
  giant "one battery → whole multi-storey building" orchestrator was judged redundant
  (walls/floors/stairs/roof + `g_joint_*` compose a building by hand just as well) and
  its only-consumer procedural-layout code was pure carrying cost. Removed
  `batteries/Generate/Architecture/g_building_shell/`, the BSP helpers
  (`subdivideFootprint`/`roomToWalls`/`RoomRect`/`WallSeg`/`LayoutOptions`) in
  `vendor/shared/types/geometry/arch-layout.ts` + its re-export
  `backend/src/services/baker/arch/layout.ts` + the vendor index export. Trade-off:
  no more "programmatic multi-room / one-click whole building" (accepted). Compose a
  building from `g_wall`/`g_floor_slab`/`g_stairs`/`g_roof` + `g_joint_fixed` instead.
- **Deprecated per-profile gear battery IDs and the `Legacy/Gears` palette group.**
  Why: keeping `g_spur_gear` / `g_herringbone_*` / `g_crossed_*` / `g_hyperbolic_*`
  / `*_pair` around as folded shells just cluttered the palette with a standalone
  Legacy stage. They are gone; all gears go through the 6 consolidated `Generate/
  Parts` ops. Trade-off: a graph saved with a removed gear ID no longer resolves in
  the editor (the node becomes unknown) and must be re-created with `g_gear`. The
  baker still understands the underlying gear DSL ops, so re-emitted DSL bakes fine.
- **Battery taxonomy reorganised to `batteries/<Stage>/<Family>/`.** Why: the flat
  `batteries/3d/<family>` tree gave no sense of pipeline order. Families now sit
  under pipeline stages `Generate` / `Modify` / `Assemble` / `Output` (+ `Legacy`
  for deprecated shells). Folder names are **plain** (no numeric prefixes like
  `1_Generate`); `BatteryBar` sorts stages explicitly via `compareBigLabel` /
  `PIPELINE_STAGE_ORDER` rather than relying on folder-name ordering. `lowpoly:batteries.list`
  remains the single source of truth — op IDs are independent of folder paths.
- **`g_bake_object` — bake a multi-color object into ONE multi-material GLB.**
  Answers "do I really have to split every colored object into separate parts at
  assembly time?" — no. Build the object as multiple colored parts (PART A phase 2,
  each `g_part` + `g_material`), then bake the whole set with `g_bake_object` into a
  single content-addressed `<sha>.glb` whose per-part colors are embedded as glTF
  materials. Reference it once in the scene via `g_mesh(filename=<sha>.glb)` — with
  **no link material on the wrapping `g_part`** — to keep all the colors. New
  pieces:
  - `backend/src/services/baker/glb_export.ts` — hand-rolled glTF-2.0 GLB writer
    (no new dependency): one mesh, one primitive per color group, deduped
    `pbrMetallicRoughness.baseColorFactor` materials, POSITION+indices only (normals
    recomputed on the viewer, matching the OBJ path), 4-byte-aligned JSON+BIN chunks.
  - `backend/src/services/baker/baker.service.ts` — `bakeColoredAssembly(parts,
    geometry)` tessellates each part with the **same low-poly tessellation** as the
    OBJ path (refactored a shared `meshShape()` out of `obj_export.ts`), bakes each
    part's `rpy`+`origin` (URDF `Rz·Ry·Rx`) into vertices, groups by color, and
    writes the GLB into the content-addressed blob library as `<sha>.glb`.
  - `backend/src/services/baker-context.ts` — exposes `baker.bakeColoredAssembly`
    on the battery `ctx.services.baker` handle.
  - `batteries/3d/Utils/g_bake_object/` (new battery) — collects every `part()` in
    the input geometry, resolves each part's `shape` ref + `material` ref→rgba (gray
    fallback) + `origin`/`rpy`, calls the baker, and returns `filename`(`<sha>.glb`)
    + `bbox_min`/`bbox_max`/`size`. Usage constraints (guarded with clear errors):
    parts must reference **real shapes** (primitive / CSG / Parts / composite), **not**
    pre-baked `g_mesh`/`<sha>.obj` refs — `g_bake_object` is "skip OBJ staging, bake the
    whole colored object at once", distinct from the `g_bake_part` + per-instance
    `g_material` route; it bakes part poses into a single static mesh, so moving joints
    are not preserved (static props only); and the wrapping scene `g_part` must carry
    no link material or the embedded colors get overwritten.
- **Viewer keeps GLB-embedded materials when there is no explicit URDF material.**
  `frontend/src/surfaces/urdf/viewer3d/useUrdfScene.ts`: for `.glb`/`.gltf` meshes
  whose URDF `<visual>` declares no `<material>`, the loader no longer forces the
  default-gray `materialSpec` (which `applyLoadedMeshPresentation` would use to
  overwrite every loaded mesh's material) — it passes `undefined` so the per-part
  colors baked by `g_bake_object` survive. OBJ meshes and any visual with an explicit
  link material keep the previous override behavior.

### Changed

- **Frontend viewer renamed from URDF-centric to generic 3D naming (breaking wire
  contract).** Why: the single viewport now serves all three pipelines, so
  "URDF viewer" was a misnomer. `surfaces/urdf/` → `surfaces/viewer3d/` (inner
  `viewer3d/` three.js layer → `viewer3d/three/`); `UrdfViewerSurface` →
  `Viewer3DSurface`; `useUrdfLiveSync` → `useViewer3DLiveSync`; `useUrdfScene` →
  `useViewer3DScene`. The pane/runtime contract changed too: `?pane=urdf` →
  `?pane=viewer3d`, localStorage `wb3d:urdfInline` → `wb3d:viewer3dInline`.
  Headless scripts (`headless-renderer.mjs`, `north-star-loop.mjs`,
  `verify-baker-pixels.mjs`) and the `App.tsx` router were updated in lockstep;
  saved embed-toggle preferences under the old key are dropped (defaults back on).
- **`g_geometry_qc` FK + AABB math extracted to shared `vendor/.../fk.ts` (de-dup).**
  Why: `g_metrics` needs the same world-frame FK + interpenetration math; keeping it
  inlined in QC would fork into a second drifting copy. `computeWorldTransforms`,
  `transformAabbByOriginRpy`/`transformAabbByMatOrigin`, `aabbOverlapDepth`,
  `pointAabbDistance`, `aabbAabbDistance`, `rpyToMat3`, `mat3*`, `readVec3` now live in
  `fk.ts`; `g_geometry_qc/index.ts` imports them. Behaviour is byte-for-byte unchanged
  (QC regression test guards this).
- **Architecture defaults centralised in `ARCH_DEFAULTS` (SSOT).** Why: roof defaults
  drifted between `g_roof` (height=1.6, overhang=0.3) and the baker (overhang=0.3,
  height=min(bw,bd)*0.4). `g_roof/index.ts`, `baker/ops/architecture.ts` and
  `aabb.ts` now all read `ARCH_DEFAULTS` from `arch-defaults.ts`.
- **`facade_panel` gains an `orientation` param (`wall` vertical default / `slab`
  flat).** Why: the baker built the panel lying flat (thickness→Z) while its meta
  labelled `panel_h` as "Y" — reversed from how a hung cladding panel actually stands,
  and no battery could stand it up. `orientation=wall` (default) now builds it vertical
  (w→X, h→Z, base Z=0, thickness→Y, like a wall) with horizontal reveal grooves; `slab`
  keeps the old flat behaviour. `baker/ops/architecture.ts`, `op-registry.ts`,
  `aabb.ts`, `batteries/.../g_facade_panel/{index.ts,meta.json}`. Note: the default
  AABB orientation for `facade_panel` changed accordingly.
- **`openings`/`holes` parsers de-duplicated.** Battery side: `g_wall.parseOpenings` and
  `g_floor_slab.parseHoles` now delegate to shared `parseQuadList`
  (`vendor/.../parse-quad.ts`). Baker side: `readOpenings`+`readRectHoles` merged into
  one `readQuadList` in `baker/ops/architecture.ts`. Error messages preserved verbatim.
- **URDF `<collision>` defaults to a coarse AABB box proxy.** Why: copying the full
  visual mesh into `<collision>` for every composite/baked part made physics both
  slower and less stable. `g_to_urdf` now wraps composite/baked-mesh collisions in an
  AABB box (provenance `collision_proxy_box`) by default; native `box`/`cylinder`/
  `sphere` stay as-is, and an explicit `g_collision_*` still wins. New `collision_proxy`
  input (default `true`) restores the legacy `visual = collision` behaviour when set
  `false`. `batteries/Output/Export/g_to_urdf/{index.ts,meta.json}`.
- **Tessellation parameters folded into bake cache keys; colored assemblies get disk
  caching.** Why: changing tessellation used to silently reuse stale geometry, and
  multi-color GLB bakes recomputed every time. Cache keys now carry a
  `tessellationFingerprint`, and `bakeColoredAssembly` writes a content-addressed
  `<sha>.glb` to the on-disk blob library.
- **Shared baker geometry helpers extracted to `op_helpers.ts`.** Why: `safeDelete` /
  `maybeShiftToZ0` / `centeredBox` / `boxFloor` / `drawingFromPoints` were copy-pasted
  across `ops/*.ts`, `csg_helpers.ts`, `gears/*` and `baker.service.ts` and had begun
  to drift. They now live in one module; per-family variants with genuinely different
  behaviour (e.g. gears' `maybeShiftToZ0`) stay local on purpose.
- **Baker tessellation tuned for low-poly (sphere/cylinder/cone get fewer
  facets).** `backend/src/services/baker/types.ts` `DEFAULT_TESSELLATION`:
  `angularDeflection` 0.5 → 0.6 (the primary curved-surface facet lever),
  `relativeDeflection` 0.004 → 0.015, `maxLinearDeflection` 1mm → 1cm. Previously
  the 0.4%/1mm linear-chord clamp forced curved revolved surfaces into dozens of
  segments regardless of the angular budget, so baked spheres/cylinders/cones came
  out high-poly. Now round surfaces hold a stable ~12–14 segments (low-poly but not
  blocky) independent of size. `minLinearDeflection` stays 0.1mm so small standalone
  parts (their bbox diagonal is small) keep fine detail — the coarsening only bites
  large curved surfaces, which is the intended low-poly look. *Trade-off:* small
  curved features riding on a very large part can be coarsened by the 1cm clamp;
  rebuild/scale that feature on its own part if it needs more resolution.
- **Scene/asset color guidance: color is per baked part, multi-color objects must
  be baked per color region (docs + persona).** `g_bake_part` bakes pure-geometry
  OBJ (no `usemtl`/`vt`) and URDF carries one `<material>` per link, so baking a
  whole multi-color object into a single mesh yields a single-color block — the
  reported "every scene object is one color" symptom. Clarified the real workflow in
  `skills/compose-lowpoly/executions/part-c-scene-assembly.md` (expanded the
  "OBJ 无材质" section + the stage-0 dispatch loop: split an item by color region,
  `g_bake_part` each region to its own `<sha>.obj`, then assemble each as its own
  `g_part` + `g_material`; instancing still reuses the whole part-set) and the
  companion `agent-lowpoly/persona/zh.md` SCENE recipe. "Color before bake" does not
  survive — bake always strips materials.
- **`forgeax-native` skills slot now inlines prompt-skill manuals (incl. linked
  `executions/*.md`), so the agent can actually see part-a/b/c.** Companion change in
  `packages/server/builtin/kits/persona/slots/skills.ts` (no wb-3d-lowpoly source).
  The slot used to inject only a one-line skill index; under `forgeax-native` the
  `SKILL.md` body and its relative-linked sub-manuals were never delivered (the
  claude-code `composeSystemPrompt` inline path doesn't run, SkillRunner only reads
  the entry file on slash-trigger, and the agent has no generic file-read tool). The
  slot now reads each prompt skill's `SKILL.md`, BFS-follows relative `.md` links
  within the skill dir (capped at 256KB, frontmatter-stripped, path-escape guarded),
  and inlines them under a "Skill Manuals" section. So `compose-lowpoly`'s
  `part-a/b/c` + guides reach Poly directly instead of relying on the persona as the
  only delivered text.

### Fixed

- **`compose-lowpoly` now tells agents the real runtime wire names and forbids UI/shell/HTTP fallbacks.**
  Why: the skill documented ToolRegistry ids such as `lowpoly:model.apply`, while the model-facing tool is
  sanitized to `lowpoly_model_apply`; agents treated the spelling difference as a missing API, opened the
  workbench, searched ports and backend source, and exhausted their turn/context budget before modeling.
  The skill now makes the mapping explicit and requires a loud tool-assembly error instead of bypassing the
  official tools.
- **Roof ridge orientation unified along the footprint's longer edge (`baker/ops/architecture.ts`).**
  Why: `gable`/`gambrel`/`shed` drew their cross-section in XZ and extruded along **Y**
  (ridge along Y), while `hip` put its ridge rectangle along **X** — so the same
  footprint produced perpendicular ridges when the roof type changed. Worse, `hip`'s
  `ridgeLen = Math.max(bw - bd, bw*0.25)` degenerated to `bw*0.25` (wrong geometry) when
  `bd > bw`. Fix: build all four in a canonical "ridge along Y" frame and rotate 90°
  about Z when the longer edge is X (`alongX = bw >= bd`); `hip` ridge length is now
  `max(longer − shorter, shorter*0.25)` on the long axis. `pyramid`/`mansard`/`flat`
  are footprint-symmetric and unchanged.
- **Battery-side validations aligned with the baker (`g_window`/`g_door`/`g_railing`).**
  Why: these emitted values the baker would then throw on, surfacing as a bake error
  instead of a clean battery `error`. Added: `g_window` frame `< min(size)/2` and
  glass `< depth`; `g_door` frame `< height`; `g_railing` `post_size < length` and
  `rail_height < height`. Geometry output for valid inputs is unchanged.
- **Agent screenshot/glb-export tools were effectively broken for any project other than whichever one the UI happened to be viewing — the "对话时调用截图工具会出错/路径错误" report.** Two compounding bugs, both in the AI project workflow (`projects.open` → `pipeline.*` → `screenshot.capture`/`export-glb`):
  1. `lowpoly:projects.open` acquired the agent's exclusive lock but never made that project the renderer's "viewing" project, and no AI-facing tool existed to set viewing either (`projects.view`/`/view` was UI-only). Since `screenshot.capture`/`export-glb`/`assets.list` all resolve their target project as "explicit `projectId` else the *viewing* project" (`resolveProjectId` in `backend/src/tool-handlers.ts`) and the backend's `resolveAgentTarget` (`backend/src/agent/routes.ts`) hard-rejects any `projectId` that isn't the viewing one, an agent that created+opened a fresh project (the normal workflow) got a permanent `409 "project X is not the viewing project"` on every screenshot/export call, with no recovery path. Fixed at the kernel: `ProjectRegistry.openProject()` (`packages/node-runtime/src/layer2/project-registry.ts`) now also calls `viewProject()` for an `ai` caller; `routes/projects.ts`'s `/open` handler broadcasts the same `project:viewing` frame `/view` does, so connected UI clients (editor canvas, URDF viewer) cross-sync live instead of only on next poll. Non-AI opens are unaffected.
  2. `lowpoly:assets.list` could never find a GLB the agent had just exported for a non-default project. `runtime.ts`'s `createRuntime(...)` factory never set `layout.assetsDir`, so the kernel's `AssetResolver` defaulted every project to the *same* global `<workspaceRoot>/assets` folder (since `projectRoot` passed in is always the shared workspace root, not per-project) — while `export-glb`/screenshot caching correctly write under `<workspaceRoot>/projects/<id>/assets/...` (via `getProjectDir()` in `agent/routes.ts`). Fixed by deriving `assetsDir` from `dirname(dirname(graphFile))` the same way `getProjectDir()` does, so both agree per project.
  Regression coverage: `packages/node-runtime/src/__tests__/project-registry.test.ts` (existing, unchanged, still green), new `apps/wb-3d-lowpoly/backend/tests/agent-project-scoping.test.ts`. `apps/wb-scene-generator` and `apps/wb-2d-scene-asset-generator` share the identical `createRuntime`/`/open` pattern and likely need the matching `assetsDir` + view-broadcast fix too (only the kernel half — `ProjectRegistry.openProject` — is already shared and fixed for them; their own `routes/projects.ts` `/open` and `runtime.ts` were not touched here since this pass was scoped to wb-3d-lowpoly).
- **CSG / Assembly / Architecture correctness pass.** Reconciled `meta.json`
  defaults with code defaults, fixed staircase rendering and `facade_panel` Z
  alignment, emitted proper errors for missing/invalid joints, validated `mimic`
  joint sources, and plugged the `recenterXYToFloor` OCCT memory leak. Documented
  the mesh-vs-solid boundary and `building_shell` limitations directly in the
  relevant `meta.json` files. `backend/src/services/baker/ops/architecture.ts` and
  the CSG/assembly ops.
- **Frontend/backend reliability pass.** Screenshot captures now fail fast via a
  `rejectCapture` path instead of timing out silently; URDF live-sync clears stale
  models and skips redundant viewer rebuilds; the selection-highlight race is gated
  by a monotonic generation counter; JSON parsing and batch-API throws are guarded
  into structured responses; `group-templates/save` is hardened against path
  traversal; the workspace `PUT` honours the exclusive project lock; `HttpApiClient`
  is disposed on unmount; and `ops:changed` is wired end-to-end so the palette
  hot-reloads.
- **AI tool handlers transparently recover project lock after backend restart.**
  `tool-handlers.ts` re-opens active project on `mutation-denied-not-open` and retries once.
- **Mutation routes forward `expectedPrevHash` and surface lock `code` on HTTP 403.**
  `mutations.ts`, `projects.ts`, `execute.ts`, `pipelineImport.ts`.

### Added

- **Battery SVG icons migrated from the legacy dev branch.** Adds explicit icons
  for the 3D Assembly, CSG, Gears, Parts, Preview, Primitive, Profile, Transform,
  and Utils batteries so the palette no longer falls back to generic glyphs.
- **`pnpm dev` HMR launcher (`scripts/dev.mjs`).** Runs the backend
  (`tsx --watch src/main.ts`) and the frontend (Vite dev server, which proxies
  `/api`,`/ws` to the backend via `vite.config`) together — the hot-reloading
  counterpart to `serve` (built dist). Builds `vendor/dist` first if missing
  (the `tsx --watch` path skips the backend `prebuild` that `serve` gets). Both
  halves share one process group so the host can group-kill the watcher tree on
  teardown. The studio `scripts/run.sh` now prefers `pnpm dev` for standalone
  plugins by default (set `FORGEAX_PLUGIN_HMR=0` for the `serve`/dist path), so
  editing plugin/kernel source hot-reloads the iframe instead of requiring a
  rebuild.
- **Richer architecture elements.** New shape types and ops so buildings read as
  more than boxes-with-pitched-lids:
  - `roof` gained `gambrel` / `mansard` / `pyramid` (on top of flat/shed/gable/hip);
    `g_roof` and `g_building_shell` accept them.
  - `stairs` gained `type=spiral` (treads around a center pole; `radius` /
    `inner_radius` / `sweep_deg`) in addition to `straight`.
  - `window` gained `type=cross|grid|louver` with `rows` / `cols` (grid mullion
    matrix; louver slat stack).
  - `door` gained `leaves=2` (double / French door, two opposed leaves) and
    `style=flush|panel|glazed` on the leaf.
  - New `g_railing` (balustrade: end posts + top handrail + balusters) and
    `g_column` (round/square pillar with optional base & capital) batteries +
    `railing` / `column` baker ops, registry specs and analytic AABBs.
- **Architecture family — static low-poly buildings.** New `batteries/3d/Architecture/`
  family (its own palette category, derived from the folder) plus matching baker
  ops and DSL `OpSpec`s, so buildings compose from semantic elements instead of
  bare `g_box` stacks:
  - **Elements**: `g_wall` (straight wall minus an `openings` list of
    `[x, width, sill, head]` door/window holes), `g_floor_slab` (slab with
    optional `[x,y,w,d]` stair/shaft wells), `g_stairs` (fused stepped flight),
    `g_roof` (`flat`/`shed`/`gable`/`hip` via extruded prism / loft, with
    overhang), `g_facade_panel` (siding sheet with reveal grooves).
  - **Openings**: `g_window` (frame + cross mullion + optional glass, one fused
    shape) and `g_door` (emits a `door_frame` **and a separate** `door_leaf`
    shape so a generator can join the leaf `revolute`/openable or `fixed`).
  - **Generator**: `g_building_shell` (multi-storey slabs, interior/exterior walls,
    stair well, roof under a single root; a single room = `floors=1,
    rooms_per_floor=1, roof_type=none`). Layout is **dual-mode**: an explicit
    `rooms` JSON pass-through, or procedural recursive BSP split via the shared
    `subdivideFootprint`/`roomToWalls` helper (`vendor/shared/types/geometry/
    arch-layout.ts`, re-exported at `backend/src/services/baker/arch/layout.ts`).
  - **Baker**: `backend/src/services/baker/ops/architecture.ts` (8 builders:
    wall/floor_slab/stairs/roof/facade_panel/window/door_frame/door_leaf) wired
    into `ops/index.ts`; new `OpSpec`s in
    `vendor/shared/types/geometry/op-registry.ts` (rebuilt `vendor/dist`).
  - **Skill + docs**: new `skills/compose-lowpoly-building/` skill (reuses the
    same ToolRegistry/QC loop, recasts the modeling philosophy as a *building
    brief*); enumerated the Architecture family in top-level `SKILL.md`, the
    `battery-catalog.md` family table + routing, and a new **Architecture** page
    in `modeling-guide.md`; registered the skill in `forgeax-plugin.json`.
  - **Tests**: `backend/tests/architecture.test.ts` — real OCCT bakes
    (wall ±opening, slab, stairs, gable/hip/shed roof, window, door leaf),
    `g_wall`/`g_window`/`g_door` DSL emission + validate, `subdivideFootprint`
    determinism, and `g_building_shell` single-rooted-tree checks.
- **Parametric Parts templates.** Wired new optional, genuinely
  geometric parameters into both the baker and the battery meta/index:
  - `Parts/g_knob`: `bore_d` (center bore), `skirt_diameter`/`skirt_height` (base
    skirt), `indicator` (top pointer groove).
  - `Parts/g_bezel`: `flange_width` (rear mounting lip), `recess_depth` (front seat
    for a screen/lens).
  - `Parts/g_tire`: `tread_depth`/`tread_count` (circumferential tread grooves),
    `sidewall_depth` (side-face annular recess).
  - `Parts/g_wheel`: `spoke_count` (N radial spokes replacing the solid twin discs)
    plus `bore_d` (optional center bore, removing the hard-coded `0.18*radius`).
- **`Utils/g_auto_collision`** — derive `<collision>` for *every* part from its
  visual in one pass: native primitives
  are copied exactly (box→box, cylinder→cylinder, sphere→sphere), everything else
  falls back to an AABB box; parts that already have a collision are skipped unless
  `replace=true`.
- **`Utils/g_to_urdf` compile report.** New `report` output: `meshFileCount`,
  `meshTotalBytes`, `totalVertices/Triangles`, `bakeMs`, `cacheHits`,
  `bakeFallbacks`, a content `fingerprint`, and a `signalBundle`
  (errors/warnings/notes + per-code counts) for agent fix loops.
- **`Utils/g_geometry_qc` structured signals + new sensors.** Added a `signals[]`
  output (`{code, severity, message, ids?}`) plus new checks: **floating links**
  (no joint path to root), **orphan profiles** (a `profile_*` not consumed by
  extrude/loft/revolve/part), **lathe/revolve fed an XY-centered profile**, and
  **mesh-backed boolean misuse** (pipe/sweep/section_loft into union/difference/
  intersection). Exposes `floating_links`/`orphan_profiles` counts.

### Changed

- **SCENE guidance made enforce the per-item bake → reference-assembly loop, and
  lifted into the persona (docs/persona only, no battery/baker/viewer change).**
  *Why:* the `agent-lowpoly` persona runs under `forgeax-native`, whose `skills`
  slot injects only the skill **index**, not the `SKILL.md` / `executions/*.md`
  bodies. So the per-item bake discipline scattered across those files was
  effectively invisible to Poly — it fell back to the trimmed persona and piled the
  whole scene into one batch. The existing batteries already support per-item
  `g_bake_part` → reference assembly, so this is pure guidance, no new battery.
  - `agent-lowpoly/persona/zh.md` — expanded the SCENE bullet into a mandatory
    four-step loop (口播 a **detailed** item manifest → per **unique** item `read`
    its A/B execution file + model fully + `g_bake_part` → **all baked in the same
    scene project** → reference-only assembly via `g_part` origins, no re-bake), and
    added a standing reminder that the `compose-lowpoly` bodies do **not** auto-load
    under `forgeax-native`, so `read` the matching execution file before each
    modeling round.
  - `skills/compose-lowpoly/SKILL.md` — the SCENE intent-triage item, routing-table
    row, and PART-C summary now require **opening and fully following** each item's
    A/B execution file (full modeling round + `g_bake_part`) before reference
    assembly, and state the **same-project bake** rule.
  - `skills/compose-lowpoly/executions/part-c-scene-assembly.md` — upgraded the
    阶段-1 scene inventory from a one-line list to a **detailed per-item description**
    (real form in 2–3 sentences + target size, with a "thin row = failed manifest"
    gate); made **same-project bake a hard default** in 阶段0 and demoted the
    cross-project blob discussion to an **advanced footnote** (default = bake every
    unique item in the scene project).
  - `skills/compose-lowpoly/battery-catalog.md` + `quickstart.md` — note that a
    scene = per-item `g_bake_part` (same project) → reference assembly, with **no
    new scene-level battery needed**.

- **`compose-lowpoly` skill recast for three-tier modeling + SCENE orchestration
  (docs only, no battery/baker/viewer change).** The skill used to route to three
  flat PARTs (A asset / B building / C "pure assembly"), with no guidance on
  *scene* requests and a PART C that hand-wired every instance with
  `g_joint_fixed`. Reworked the docs so a scene / city / multi-object request is a
  first-class flow:
  - `skills/compose-lowpoly/SKILL.md` — added an **intent-triage** decision tree
    (single object/assembly → A; building → B; scene/city → SCENE orchestration)
    and an **assembly-vs-scene boundary** disambiguation ("one interlocking whole"
    → A; "several independent things staged together" → SCENE); recast the routing
    table + PART summaries so SCENE orchestration *wraps* per-item A/B modeling and
    ends in PART C; refreshed the frontmatter description to match.
  - `skills/compose-lowpoly/executions/part-c-scene-assembly.md` — expanded from
    "pure assembly" into **scene orchestration & assembly**: prepended a scene
    **brief** (theme / scale / footprint / layout paradigm), an item-level **scene
    inventory** (per item: A or B, count, which instances reuse one `<sha>.obj`),
    and a single-agent **dispatch loop** (model + bake each *unique* item). Changed
    the default assembly recipe from per-instance
    `g_mesh→g_part→g_material→g_joint_fixed` to **`g_mesh→g_part(origin=pose, rpy,
    material)` with no `g_joint_fixed`**, relying on `g_to_urdf` auto-stitch to
    join the jointless roots into one tree. Added a **re-bake trap** warning (using
    `g_translate`/`g_array_*` to place a referenced mesh re-bakes a fresh OBJ per
    instance and kills instancing — mass reuse = one `<sha>.obj` + many `g_part`
    origins) and a **scene-mode QC note** (`g_geometry_qc` `islands` is noise after
    auto-stitch; `aabb_overlap` stays the hard placement signal, so `g_mesh` must
    still carry `bbox_min/max`). Added a **Deferred** note for future scene-level
    batteries (`g_scene_root` / `g_place` / `g_scatter`) that would retire the
    `g_part` boilerplate (needs backend work, not done here).
  - `skills/compose-lowpoly/battery-catalog.md` — added a top SCENE-orchestration
    routing row (decompose → A/B per item → assemble by `g_part` origins) noting
    `g_array_*` re-bakes referenced meshes.
  - `skills/compose-lowpoly/quickstart.md` — tightened the Iteration Loop into an
    agent-owned **self-check → self-fix → re-render** closed loop (fix mechanical
    defects yourself, only ask the user on subjective calls) and added the
    two-tier scene iteration note (per item first, then whole-scene QC/four-view).
  - Companion `agent-lowpoly` persona/manifest (no CHANGELOG in that plugin):
    `persona/zh.md` + `AGENT.md` rewritten to the three-tier spine with intent
    triage and the self-check/self-fix loop (replacing the "screenshot critique,
    hand it back to the user" anti-pattern); `forgeax-plugin.json` description
    widened from props/mechanical to also cover buildings and scenes/cities.
- **`primitive_only` QC signal now fires for box-stacks wrapped in parts/joints.**
  The original gate required `no part` **and** `no joint`, so the moment a model
  wrapped its boxes in `g_part` + `g_joint_*` — i.e. the exact lazy
  "stacked-boxes assembled into a URDF" failure mode — the signal went silent and
  never warned. `Utils/g_geometry_qc` now judges **only the shapes**: it warns
  when *every* shape is a bare primitive with no rich geometry at all (no CSG
  solid, no Parts/Gears/Architecture, no baked `mesh`), independent of
  part/joint wrapping. Pure-placement transforms and 2D profiles do not count as
  rich geometry. Still non-fatal (`severity: warning`, does not affect `valid`)
  per the "QC as a sensor" design. `meta.json` output doc updated to match.
- **`compose-lowpoly-3d-pipeline` SKILL workflow normalized to "model Parts →
  assemble URDF".** The generic 7-step tool loop (whose step 4 "apply graph
  changes" invited a single mega-batch) is replaced by a phase-structured spine
  (Phase 0 manifest → Phase 1 per-part model + `g_bake_part` → Phase 2 reference
  meshes + assemble), so the first procedure the agent reads already enforces the
  two-phase discipline. Refreshed the stale `primitive_only` descriptions in
  `quickstart.md` / `modeling-guide.md` to note it now fires even when boxes are
  wrapped in parts/joints.
- **Phase 0 manifest now demands a detailed per-part build spec.** The manifest
  schema in `compose-lowpoly-3d-pipeline/SKILL.md` was a thin field list that the
  agent satisfied with placeholder rows ("A: box, B: cylinder"), giving Phase 1
  nothing to model against. It now requires, per part, the function, a 2–3
  sentence real-form description, a concrete op route, dimensions with axes &
  proportions, located detail features, local datum/orientation, the assembly
  link/joint, and material — with a worked example row setting the expected
  density and an explicit "a thin/generic row is a failed manifest" gate.
  `quickstart.md` Phase 0 step updated to match.
- **Kernel source now hot-reloads in dev (no `pnpm -r build` needed).** The
  frontend imported the kernel via package `exports`→`dist`, so editing
  `node-runtime` / `node-runtime-react` only took effect after a rebuild +
  restart. `frontend/vite.config.ts` now adds a dev-only `resolve.alias` mapping
  `@forgeax/node-runtime-react` (`.`, `/editor`, `/themes`) and
  `@forgeax/node-runtime` (`.`, `/layer1`) to their `src/*.ts`, with
  `optimizeDeps.exclude` (serve unbundled) and `dedupe: [react, react-dom,
  reactflow, zustand]` (single React across app + kernel source). `scripts/dev.mjs`
  runs the backend's `tsx --watch` with `--conditions=source` so the kernel's
  new `"source"` export condition resolves backend imports to `src` too — kernel
  edits hot-restart the backend. Verified: a `node-runtime-react/src` edit fires
  a Vite `hmr update`, and a `node-runtime/src` edit restarts the backend, both
  with zero build. `vite preview` / `serve` (dist) are untouched.
- **Docs realigned to monorepo (kernel is `workspace:*` `packages/*`, not an
  `external/` submodule); removed dead `.gitmodules` + `.cursor/rules/kernel-cascade.mdc`;
  hygiene-check kernel-submodule guard removed.**
- **Removed the `g_room` battery.** It rendered as nothing useful in the viewer
  and fully overlapped `g_building_shell`; a single room is now
  `g_building_shell(floors=1, rooms_per_floor=1, roof_type=none)`. Docs and the
  architecture test suite were updated accordingly.
- **Gears real geometry (P2).**
  - `herringbone_rack_gear` no longer reuses the straight rack body; it now slices
    the rack along its width with a symmetric half-helix X-shift so the teeth form
    a real V/chevron (distinct mesh from `rack_gear`).
  - `bevel_gear`/`bevel_gear_pair` now consume `helix_angle` (progressive per-slice
    Z-rotation → spiral-bevel tooth trace; `0` = straight bevel) and the pair routes
    `pressure_angle`/`clearance`/`backlash` through to each side's slices.
  - `worm` pitch/lead math made self-consistent: lead `L = n_threads·π·module`,
    `d0 = L/(π·tan(lead_angle))`, total twist `= 2π·length/L`, all derived from a
    single source so the radius and twist no longer disagree.
- **Hinges A/B knuckle interleave (P2).** `barrel_hinge`/`piano_hinge` knuckles now
  alternate ownership between the two leaves (each leaf is fused with its own
  knuckles, then leaf B rotates with its knuckles), so the fold reads as interleaved
  fingers; `barrel_hinge` `knuckle_count` is forced odd to match `piano_hinge`.
- **Gears metadata truthfulness (P1).** Removed dead inputs from meta+index
  (`hub_d`/`hub_length`/`chamfer` on spur/herringbone/ring; `trim_top`/`trim_bottom`
  on bevel; `helix_angle` on rack/bevel_pair); aligned `helix_angle`/pitch/sweep
  default *descriptions* with the baker's real fallbacks (e.g. herringbone 25°,
  crossed-helical 15°, fan/blower sweep); exposed `slat_direction` on
  `Parts/g_vent_grille`; and rewrote every `Gears/*` meta to the Parts style
  (`principal: geometry`, per-input `description-en`, when-to-use triggers).
- **Planetary validation alignment (P1).** `g_planetary_gearset`/
  `g_herringbone_planetary_gearset` index now require sun/planet teeth `>= 3` and
  `n_planets >= 1`, matching the baker.

### Fixed

- **Visible baker safety (P3).** The mesh-backed boolean error message now names the
  offending upstream (pipe/sweep/section_loft) and suggests solid alternatives;
  `lathe`/`revolve` now report a clear error (with the source op) when fed an
  XY-centered profile instead of silently producing a wrong solid of revolution.
  (AABB fallback already surfaces a configurable `BAKE_FALLBACK_USED` diagnostic +
  mesh provenance.)

- **Anti-primitive modeling guidance + richer battery metadata (docs/metadata only,
  plus one non-fatal QC signal).** The LLM almost always fell back to `g_box`/
  `g_cylinder` stacks even though the catalog ships full `CSG` / `Parts` / `Gears`
  / `Assembly` families, because the skill was ~90% tool-call mechanics with
  primitive-biased modeling advice, the families were never enumerated, and the
  `*_id` wiring (plus its silent failure) was undocumented. Reworked the
  approach:
  - **Skill rewrite** (`skills/compose-lowpoly-3d-pipeline/`): added a *Modeling
    Philosophy* (realistic-geometry-first, explicit anti-primitive rule, a
    mandatory decomposition **brief** before the first `applyBatch`) to
    `SKILL.md`; replaced the primitive-biased *Lowpoly Guidance* in
    `battery-catalog.md` with a **family list + routing table** and a
    "read the `error`/`report` outputs" note; added the **id-port wiring** rules
    and a **runnable multi-part assembly example**
    (`shape → CSG → g_part → g_joint_* → g_geometry_qc → g_to_urdf → urdf_preview`)
    to `pipeline-schema.md`; inserted the brief + a **QC step** into the
    `quickstart.md` iteration loop; and added a new per-family `modeling-guide.md`.
    Top-level `SKILL.md` now enumerates the geometry families instead of only
    pointing at `batteries.list`.
  - **Battery metadata** (no runtime/logic change): filled in `description-en`,
    "when to use" clauses, `*_id` upstream-port wiring, and a documented `error`
    output for every `CSG/*` op; clarified `shape_id`/`parent_id`/`child_id`
    wiring and added a single-rooted-tree drop warning to `Assembly/g_part` and
    `Assembly/g_joint_*`; and added `description-en`, trigger words, and a
    consistent `principal: geometry` hint to every `Parts/*` op.
  - **QC sensor** (`Utils/g_geometry_qc`): added a non-fatal **geometry-richness
    signal** — when the model is all bare primitives with no CSG/Parts/Gears and
    no `part`/`joint`, it appends a `primitive_only` note to `report` and exposes
    a new `primitive_only` boolean output. Does not affect `valid` or block
    execution; it is the "QC as a sensor" gate the loop reads.

- **Kernel cascade: bump `external/forgeax-wb-node-core` to `f831fe6`.** The
  kernel retires the obsolete `asset_grid` core port type and the legacy
  texture-binding executor hook.

- **`pnpm serve` matches scene-generator dist contract.** Replaced
  `backend dev` + `vite preview` with `scripts/serve-dist.mjs`: serves
  `frontend/dist`, runs `backend/dist/main.js`, auto-builds missing dist
  bundles, proxies `/api/*` and `/ws` (same host `run.sh` integration).

### Fixed

- **`batteryRoots` loads shared common batteries from `external/forgeax-wb-node-core`.**
  Same resolution order as scene-generator: `external/` submodule path, then
  sibling `../forgeax-wb-node-core`, then plugin `batteries/` (marketplace vs
  forgeax-studio layouts).

### Changed

- **Kernel cascade: bump `external/forgeax-wb-node-core` to `afd18d0`.** Kernel
  `isTemplateBattery` now keys off the big label (`getBigLabel !== 'groups'`)
  instead of an exact `displayGroup` match, so `groups/<cat>` group batteries
  stay in the Develop palette (GROUPS tab, sub-categorized) while `templates/*`
  stay in Templates mode. No lowpoly code change — pin + dist sync only;
  existing lowpoly groups/templates are unaffected (backward compatible).

### Added

- **Multi-project management in the left pane + per-agent project lock** (kernel
  cascade — bump `external/forgeax-wb-node-core`; see its CHANGELOG Unreleased).
  - The left pane (`frontend/src/workbench/WorkbenchLeftPane.tsx`) now mounts the
    kernel **`<ProjectPanel>`** (cards: switch / create / delete) as its top section;
    it configures its own editor transport + `subscribeProjectActivation()` so it
    stays live with the center editor. The old read-only "Recent projects" list was
    removed (superseded by the interactive panel). The static flow / outputs / tips
    sections are kept.
  - New AI tool **`lowpoly:projects.close`** (release the exclusive lock) +
    backend `POST /api/v1/projects/:id/close` (`backend/src/routes/projects.ts`).
    Open-then-operate: an agent opens (locks) a project, operates, then closes;
    it cannot open a second project until it closes the first, and cannot open a
    project another agent holds. Tool calls forward the caller via
    `x-forgeax-caller-*` headers (`backend/src/tool-handlers.ts`); the activate +
    batch/execute/import routes enforce the lock (`ensureMutationAccess`).
- **Agent-callable GLB export + headless rendering loop** (plugin-only, no kernel cascade).

### Changed (multi-project)

- **The canvas top-right "projects" button + modal were removed** in favour of the
  left-pane `<ProjectPanel>` (`frontend/src/workbench/WorkbenchHost.tsx`). *Why:*
  one project-management surface, in the left pane, for both the human and the LLM.
  - New AI tool **`lowpoly:export-glb`** (`forgeax-plugin.json` provides.tools, `exposedToAI`):
    bakes the current pipeline model to an engine-neutral `.glb` (with joint-preview
    animation) under `<projectRoot>/assets/3d/<name>.glb`. Mirrors the screenshot WS
    round-trip — backend `/api/v1/agent/glb/{export,store}` (`backend/src/agent/{routes,
    glb.service}.ts`) broadcast `glb:request` → the viewer's new `useGlbExport`
    (`frontend/src/surfaces/urdf/useGlbExport.ts`) bakes via the existing
    `exportAnimatedGlbBlob` → POSTs back → backend writes the file + returns its path.
    *Why:* the GLB exporter was client-only (titlebar button); agents had no API to export.
  - **Headless renderer daemon** `scripts/headless-renderer.mjs` (launched by the host
    `run.sh`): runs the existing `?pane=urdf` surface in a headless Chromium so
    `lowpoly:screenshot.capture` / `lowpoly:export-glb` always have a live renderer —
    no human-opened panel needed. Added a `serve` npm script + a `vite preview` config
    block so the frontend is served as a bundled build (faster than the dev server).
  - Default capture timeout 5s → 10s (cap 20s); glb export 30s (cap 60s). *Why:* cold
    heavy-URDF renders exceeded 5s and surfaced as a misleading "no renderer connected"
    timeout. (NB: the `timeout` arg is **milliseconds**.)
  - Verified: agent `lowpoly:export-glb` → valid glTF 2.0 written to
    `assets/3d/heavy_tank.glb`; headless `screenshot.capture` returns the rendered model.

### Fixed

- **Runtime WS had no reconnect → silent dead renderer.** `HttpApiClient` (graph/exec
  channel), `useScreenshotCapture` and the new `useGlbExport` opened their `/ws` socket
  once with no reconnect, so a stack restart / WS blip permanently stopped
  `exec:completed` delivery — the headless viewer never live-synced the URDF and
  screenshots/exports silently captured an empty scene (a green "ok" with no model).
  Added capped-backoff reconnect (+ re-subscribe) to all three. The render/export loop
  now self-heals after restarts and blips.

### Added (geometry chain — prior)

- **3D geometry chain — assetKind + strict delivery validation + collision/QC batteries**
  (ports upstream `6fa0a167` + `9f9c4a2e`; plugin-only, no kernel cascade).
  - `g_to_urdf` gains `strict` / `asset_kind` (`static|assembly|mechanism`) plus
    `allow_bake_fallback` / `allow_auto_wrap_orphans` / `allow_auto_stitch_roots`
    inputs and structured `diagnostics` / `stats` outputs. Default stays the old
    lenient preview (`strict=false`); strict mode promotes AABB bake-fallbacks,
    implicit orphan links, auto-root-stitching and mechanism-without-moving-joint
    to hard errors. *Why:* let callers gate on real URDF deliverability without
    breaking lenient previews.
  - New batteries under `batteries/3d/Utils/`: `g_collision_box` (single AABB
    collider), `g_collision_clustered` (per-instance / split colliders), and
    `g_geometry_qc` (geometry quality-control report). `g_inertial_from_geometry`
    extended to match.
  - Added a `collision` op to the geometry DSL op-registry
    (`vendor/shared/types/geometry/op-registry.ts`); rebuilt `vendor/dist`. A part
    may carry multiple `collision` statements (box/cylinder/sphere/shape-ref),
    each emitted as a URDF `<collision>`; parts with none keep visual-as-collision.
  - Ported the upstream `geometry-dsl.test.ts` end-to-end regression suite to
    `backend/tests/geometry-dsl.test.ts` (parser/validate/serialize/make/summary/
    op-registry/desk_lamp URDF + strict diagnostics). Reconciliation: dropped the
    `summarizeGeometryForBroadcast` case — that helper was deliberately removed in
    our refactor as dead code (port values summarize locally via
    `summarizeGeometry`); did **not** re-add it.
  - Skipped upstream `.claude/skills/compose-3d-pipeline/**` (legacy skill docs +
    standalone `validate.ts`); the strict-validation logic they describe is ported
    into `g_to_urdf` proper.
  - Verified: backend `50 passed` (incl. new suite), battery load `114 ops
    (0 skipped)` with the 3 new ops in `/api/v1/ops`, and a collision→URDF smoke
    emitting `<collision>`.

- **CAD geometry validation + baker subgraph cache/memo + collision DSL op**
  (ports upstream `7bccdc20`; plugin-only, no kernel cascade).
  - Geometry DSL core (vendored `shared/types/geometry/`) advanced to the
    `7bccdc20` revision: new `subgraph.ts` (`reachableSubgraphSource` /
    `collectReachableStatements`), stronger semantic validation in `validate.ts`
    (`checkSemanticRefs`: part/joint/collision/inertial/CSG/transform/profile ref
    *kind* checks, parent≠child, single collision descriptor), expanded
    `surface.ts` / `aabb.ts` / `op-registry.ts` (adds `opProduces`,
    `listBakeableShapeOps`, surface/profile ops), `make.ts` / `mutate.ts`.
  - Baker: `bakeGeometryShape` cache key now hashes only the **root-reachable
    shape/profile subgraph** (`reachableSubgraphSource`) instead of the whole
    source, and `buildStatementShape` memoizes built sub-shapes within a single
    bake (`BakeBuildMemo` + `cloneBakeProduct`/`disposeMemo`). Preserves the
    single-WASM serialized bake queue + in-proc cache semantics. `listBakeableOps`
    now intersects locally-registered builders with the registry's bakeable shape
    ops. *Why:* avoid redundant re-bakes when unrelated parts/joints/materials
    change, and avoid rebuilding shared sub-shapes.
  - ~26 batteries (joints, gears, `g_part`, `g_box`, `g_align_centers`,
    `g_place_on_face`, collision/QC/inertial, `g_to_urdf`, CSG/Profile metas)
    advanced to their `7bccdc20` revisions to match the new core API.
  - Build/SSOT seam: `scripts/build-vendor.mjs` now emits `.d.ts`
    (`--declaration true`) so the backend baker shim
    (`backend/src/services/baker/shared-types.ts`) re-exports the **real**
    compiled vendored runtime (`reachableSubgraphSource`, `listBakeableShapeOps`)
    + types instead of a hand-maintained mirror — single source of truth, still
    `tsc -b` clean (vendor ships declarations, treated as a library reference).
  - Reconciliation / not-applicable: upstream `7bccdc20` also touched legacy
    plugin-backend services (`battery.service` algTag index, `pipeline.service`
    mtime name-cache, `project.service` throttled index save, `watcher.service`,
    `websocket/manager`) — those services do not exist in this refactored plugin
    (their concerns now live in the kernel runtime/transport), so their perf
    tweaks have no landing site here. The standalone `geometry-dsl.smoke.ts`
    (a no-vitest fallback harness) and `.claude/skills/**` docs/`validate.ts`
    were skipped; the vitest `geometry-dsl.test.ts` already covers the contract.
  - Verified: backend `tsc --noEmit` clean, `50 passed`, load `114 ops
    (0 skipped)`, and a real OCCT CSG-difference bake (32 tris) with a warm-cache
    re-bake (71ms → 2ms) confirming the subgraph cache key.

### Changed

- **Kernel cascade: bump `external/forgeax-wb-node-core` → `1441ca5`.** Picks up
  the debounced-persist editor change (`schedulePersistSession` + skippable
  `incrementalExecute({ persist:false })`). This is the **editor half of upstream
  `7bccdc20`**; the backend (baker subgraph cache/memo) + geometry (CAD validation,
  collision DSL op, new batteries) halves of `7bccdc20` landed plugin-side in this
  repo (see the `Added` entries above). Editor-only kernel change; no 3d
  backend/frontend source change beyond the submodule pin. Kernel dist rebuilt
  under `external/`. Pin matches the scene plugin. Verified: 3d frontend
  `4 passed`, backend `50 passed`.

- **Kernel cascade: bump `external/forgeax-wb-node-core` → `a2a848e`.** Picks up
  the upstream `wb-scene` editor-parity batch (i18n preview labels `7c1206cd`,
  relay fork-delete `e0c567d7`, relay capsule `09388e3f`, preview-disabled ring
  `b2beda9e`, group-view overlap `1506493a`, port handle z-index `e75d91aa`,
  annotation Ctrl-drag/copy `440da6a5`, the bbox/frame chain
  `3b907c5c`/`0993136a`/`40f27e51`, favorites context-menu affordances
  `51dceee2`, frame-persistence reconciliation `f3414fe1`). Editor-only kernel
  change; no 3d backend/frontend source change required beyond the submodule
  pin. Kernel dist rebuilt under `external/`. Pin matches the scene plugin.

### Added

- **Architecture docs.** Added [`ARCHITECTURE.md`](./ARCHITECTURE.md),
  [`docs/architecture/`](./docs/architecture/) (backend · frontend ·
  extension-and-contracts) and [`AGENTS.md`](./AGENTS.md): a code-grounded map of
  the 3d-lowpoly plugin (backend routes/runtime/baker/library, the URDF/3D viewer
  surface, the geometry domain seam) and a read-before-write protocol.

### Fixed

- **Kernel bump → `483431c`** (cascade). Bumped `external/forgeax-wb-node-core`
  for the deterministic battery scan + first-wins duplicate-id guard. Backend
  loads `111 ops (0 skipped)`; verified the load path + resolution are healthy
  (no regression). Documented in `docs/architecture/extension-and-contracts.md`.

- Bumped the shared editor kernel so grouped nodes persist as real kernel
  groups across live-sync/refetch instead of immediately expanding back to
  member nodes.
- Bumped the shared editor kernel so double-clicking a wire reliably hits the
  ReactFlow edge interaction path and inserts a typed Relay in the browser.

### Added

- Added lowpoly group-template REST support (`/api/v1/group-templates*`) so the
  shared editor can save collapsed groups as reusable template batteries, list
  them in Templates mode, and instantiate them back onto the canvas without
  touching the existing live chest project.
- **Staged visual composition helper.** Added `pnpm compose:visual-staged-demo`
  for LLM/CLI graph edits that must be visible step-by-step: each small batch
  waits for its exact `graph:applied` batch id, runs execute, waits for
  `exec:completed`, and can optionally capture the live URDF pane (`CAPTURE=1`).
  The script defaults to an isolated lowpoly project so existing work, including
  chest compositions, is not overwritten.
- **Relay double-click parity.** Bumped the shared editor kernel to restore the
  legacy relay interactions for every plugin: double-click a wire to insert a
  typed relay, double-click a relay node to remove it and restore the direct wire
  when possible.
- **Programmatic batch labels.** `/api/v1/batch` now forwards `label` and caller
  `batchId` into kernel history, so staged AI/CLI edits show meaningful history
  rows and can be acknowledged by exact batch id.

- **OCCT baker + content-addressed mesh library.** Added the backend baker service,
  slim `/api/v1/library/blob/<sha>.obj` route, runtime `ctx.services.baker`
  injection, and URDF viewer `baseUrl` wiring so composite Parts/Gears bake to real
  OBJ meshes instead of AABB placeholders. Added Parts/Gears batteries plus baker
  unit/smoke coverage for OCCT, CSG, full Parts/Gears catalogs, HTTP blob serving,
  URDF `<mesh>` emission, and real-pixel mesh loading.

- **Shared Projects/Open/Save editor chrome.** Bumped the kernel submodule to the
  unified editor-core and wired the 3d workbench to the same shared
  `ProjectsDialog` / `PipelineFileDialog`, Toolbar `onOpen` / `onSave`,
  project-store cascade, and project/import/export API methods used by
  scene-generator. 3d-specific code now stays in the URDF preview pane, lowpoly
  project defaults, and baker/renderer services.
- **Projects/import backend routes.** Added `/api/v1/projects`,
  `/api/v1/workspace`, and `/api/v1/pipeline/{templates,import,export}` over the
  shared `ProjectRegistry` / `importPipelineGraph` kernel path. Default project
  type is `lowpoly`; project activation rebinds WS subscriptions and broadcasts
  `graph:applied` so the editor and URDF preview reload through the standard
  live-sync cascade.
- **Shared editor probe / relay affordances.** Bumped the kernel submodule so the
  inherited editor exposes the data-probe toggle directly in the toolbar and adds a
  Canvas quick-search **Relay** entry that creates the kernel `__relay__` sentinel.
  Relay remains kernel/editor infrastructure rather than a common battery pack item.
- **Shared `common` batteries.** The backend now scans
  `forgeax-wb-node-core/packages/batteries-common/batteries` in addition to this
  plugin's `batteries/3d`, so generic ops such as `number_const`, `range_list`,
  and `tree_merge` are available in the 3d-lowpoly catalog and palette under the
  `common` tab without duplicating battery source. Category discovery now treats
  every scan-root top-level folder as an automatic tab, so future sibling packs
  become available to this plugin by being added next to `common`.

### Changed

- Frontend dev server port + backend proxy target are now env-overridable
  (`VITE_DEV_PORT`, `VITE_API_TARGET`); defaults preserve the original `9555 -> 9557`.
  Lets this plugin run on its own address (e.g. `9565 -> 9567`) alongside the
  scene-generator without colliding.

- Bumped the `external/forgeax-wb-node-core` kernel submodule `ff1c884 → f7e1ba2`,
  reconciling the scene-generator kernel improvements onto this plugin's own kernel
  delta. The reconcile is a cherry-pick of this plugin's `opSpecToBattery`
  `nodeType`/`hideOutputs` forwarding (`ff1c884`) on top of scene-gen's `ea5c538`,
  so the new kernel commit contains BOTH sets of work (merge-base `013c2d0`; the
  parallel pre-`ea5c538` chain was content-identical, so the only local delta was
  the mapper forwarding). Inherited kernel improvements now available to this plugin:
  - **Incremental canvas reconcile** (`edfcca5`): dragging/adding one battery no longer
    rebuilds every ReactFlow node — unchanged nodes keep object identity. Fixes the
    drag-add full-reload bug here too (active via the mounted kernel `<Editor>`).
  - **tree_merge `inferredAccess` connect-hook** (`d57038a`) restored in `useCanvasConnect`.
  - **History bridge** (`3dcc6b7`): AI/CLI batches flow into the History panel
    (+ optional `label` on `HistoryEntryV1`); served via the existing `GET /api/v1/history`.
  - **Keyboard Undo/Redo** (`ea5c538`): global Ctrl/⌘+Z / Ctrl+Y / Ctrl+Shift+Z wired into
    the editor canvas (`useCanvasUndoRedo`), reversible through History — active here.
  - **Graph import** (`dc59a61`): kernel `importPipelineGraph` + react mapper/adapter
    + `pipeline import` CLI. Kernel-ready; app-level wiring (backend route + UI) is a
    follow-up — not yet user-facing in this plugin.
  - **Multi-project management** (`64a24e9`): kernel `ProjectRegistry` + store + CLI +
    `createRuntime(registry?)`. Kernel-ready; this plugin still runs single-project, so
    project-switch wiring (registry + routes/UI) is a follow-up — not yet user-facing.
  The `nodeType`/`hideOutputs` specialized-panel path (`g_preview → name_list_panel`) is
  preserved and verified working after the reconcile.

### Added

- Kernel `forgeax-wb-node-core` vendored as a git submodule, consumed via pnpm `link:`.
- Backend Fastify kernel bridge: `/health`, `/api/v1/{pipeline,nodes,edges,ops,history,groups}`,
  `/api/v1/batch`, `/api/v1/execute`, `/ws`. `/api/v1/batch` broadcasts `graph:applied`
  so external/LLM/CLI batches live-sync (scene-generator lesson applied from day one).
- Battery category projection on `GET /api/v1/ops` for palette grouping.
- Frontend mounts the shared kernel `<Editor>` in a `WorkbenchHost`; `HttpApiClient`
  over fetch + WebSocket.
- `scripts/smoke-livesync.mjs` headless broadcast regression test.
- Geometry DSL (`shared/types/geometry`) vendored + `build:vendor` step that compiles it to `vendor/dist`.
- 49 no-baker 3D-modeling batteries ported under `batteries/3d/`: Primitive (8), Profile (5),
  CSG (11), Transform (6), Assembly (9), Utils (8, incl. `g_to_urdf`), Preview (2).
- `/api/v1/ops` forwards `frontend.nodeType` / `hideOutputs`; the shared kernel mapper
  (`opSpecToBattery`) updated to apply them, so `g_preview` renders `name_list_panel`.
- `g_to_urdf` emits URDF; composite / non-native shapes degrade to analytic AABB `<box>`
  placeholders (OCCT baker + Parts/Gears deferred to Plan 5).
- `scripts/smoke-urdf.mjs` headless geometry → URDF pipeline test.
- Ported the three.js URDF viewer as a `?pane=urdf` surface embedded in `WorkbenchHost`
  (same-origin iframe; editor selection forwarded over the `workbench:editor-selection`
  postMessage channel).
- Live URDF sync on exec/graph events (REST pull via `HttpApiClient` + `flattenWire`),
  with stale eviction that empties the viewport when no `urdf_preview` / `g_to_urdf`
  source node remains.
- Best-effort editor-selection → link highlight: a selected node's `id` param maps to a
  URDF `<link name>` (or `<id>_link`) and emissive-tints matching link meshes; a mapping
  miss is a clean no-op and can never break rendering.
- Agent screenshot routes `/api/v1/agent/screenshot/{capture,store,latest}`:
  `/capture` broadcasts `screenshot:request{captureId}` over `/ws` and blocks until a
  renderer POSTs the frame to `/store` (or 504s); `/latest` returns the cached record.
- URDF viewer WS capture hook (`useScreenshotCapture`) + a synchronous `renderFrame`:
  the live `?pane=urdf` page answers `screenshot:request` by force-painting a fresh
  frame and POSTing the canvas PNG back, so the agent screenshot equals the human view.
- `scripts/smoke-screenshot-plumbing.mjs` (`pnpm smoke:screenshot`): headless,
  browser-free proof of the capture handshake (WS → `/capture` → `/store` → `/latest`
  round-trip with a valid 1×1 PNG).
- `scripts/north-star-loop.mjs` (`pnpm north-star`): the Playwright real-pixel LLM loop —
  API-drive a `g_box → g_part → g_to_urdf → urdf_preview` pipeline, live-render it in a
  headless chromium `?pane=urdf` page, capture a REAL non-blank PNG via the agent API,
  then iterate (box → cylinder) and assert the new PNG differs. The `urdf_preview.urdf`
  XML is the always-available textual observation; gracefully degrades to a documented
  data-only PASS when chromium is unavailable.
- Screenshot PNG toolbar button (Camera) exporting the current frame via
  `renderer.domElement.toBlob('image/png')` — the manual image-export path, backed by a
  reusable `captureFrame` / `getFrameCanvas` seam shared with the headless capture loop.
- Primitives render with no mesh backend (empty `baseUrl`); mesh visuals await the Plan 5
  baker blob route.
- Initial scaffold consuming `@forgeax/node-runtime` via git URL dependency.
- Backend / frontend / batteries / schemas directory skeleton.
- ForgeaX plugin manifest with split surface layout.
- Hygiene check, ESLint, Prettier, CI workflow.
