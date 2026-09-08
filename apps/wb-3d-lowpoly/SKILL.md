---
id: wb-3d-lowpoly:author-guide
trigger: /wb-3d-lowpoly
displayName:
  en: 3D Lowpoly Generator Author Guide
  zh: 3D 低多边形生成器 作者指引
---

# 3D Lowpoly Generator · AI guide

This plugin extends `@forgeax/node-runtime` with domain ops and surfaces
specific to **3D Lowpoly Generator** workflows. AI agents drive editor actions
through Studio ToolRegistry (`/api/tools/call`) tools declared in
`forgeax-plugin.json`; nothing in this plugin requires a human-only path.

## Workflow shape — DSL-first

Geometry **DSL is the single source of truth**. You write DSL text; the backend
compiles it to a graph, executes it, bakes, and runs QC in **one** call. You
**never** hand-wire nodes/edges (`createNode`/`connect`).

1. `lowpoly:projects.list` / `lowpoly:projects.open` — choose the active project.
   `open` is a shared attach (no write lock, never queues); the first mutation
   claims and waits for the write lock. Call `lowpoly:projects.close` when done —
   it releases the lock *and* your session, and is required before you can open a
   different project.
2. `lowpoly:model.apply({ source })` — the main entry point. Pass the **full**
   Geometry DSL text; the backend validates → compiles to a graph → imports (the
   visual editor updates) → executes → QC → URDF, and returns a **compact
   receipt**: `errors` / `qc.signals` / `meshQc.signals` are **mapped back to DSL
   line numbers**, plus mesh-aware interpenetration hard signals, baked-mesh
   suggestions (concrete translation deltas), and a URDF fingerprint. Read the
   receipt, fix the offending lines, re-`apply`. `model.apply` replaces the whole
   model each call, so always send the complete DSL.
3. `lowpoly:model.get` — read back the current model as DSL source (reconstructed
   from the graph, so any human edits in the editor round-trip back to DSL).
4. `lowpoly:parts.list` — list meshes you have baked (`name → sha256 + bbox +
   dims`); use these names in `mesh(filename=...)` for phase-2 assembly. Solves
   "I can't find the mesh I baked".

Syntax and op signatures: see `skills/compose-lowpoly/dsl-quickref.md` (DSL grammar
cheat-sheet) and `skills/compose-lowpoly/op-directory.md` (auto-generated family
index — the SSOT for authoring; you do not need `batteries.list`). The index links
to per-family shards under `skills/compose-lowpoly/op-directory/`; open only the
shard(s) the current task needs, not every shard.

The completion gate is a clean `model.apply` receipt (no `errors`, `qc.valid`,
`meshQc.clean`, no URDF errors) — judge the model purely from the receipt.

> **Transitional / legacy:** the low-level `lowpoly:pipeline.get` /
> `pipeline.applyBatch` / `pipeline.execute` tools still exist for humans and old
> flows, but agents should drive modeling through `model.apply` and never emit
> `createNode`/`connect`.

## Domain op catalogue

For DSL authoring, `skills/compose-lowpoly/op-directory.md` is the op-signature
SSOT — agents do **not** call `batteries.list` / `batteries.get`. The plugin ships
these geometry families under `batteries/<Stage>/<Family>/` — organised by pipeline
stage (**Generate → Modify → Assemble → Output**). Prefer the richer families over
stacking primitives:

### Generate
- **Primitive** — `g_box` `g_cylinder` `g_sphere` `g_cone` `g_capsule` `g_torus`
  `g_dome` `g_mesh` `g_rock`. Use only when the form genuinely is that primitive.
  `g_mesh` takes optional `bbox_min`/`bbox_max` (wired from `g_bake_part`) so a
  referenced mesh resolves an AABB for QC overlap checks. `g_rock` (DSL
  `rock`/`boulder`) is an icosphere with deterministic per-seed displacement for
  terrain decoration/rubble/boulders — mesh-backed like `g_pipe`/`g_sweep`/
  `g_section_loft`/`g_sdf_blob`, so it cannot feed a boolean.
- **Profile** — `g_profile_rect` `g_profile_rounded_rect` `g_profile_circle`
  `g_profile_polygon` `g_profile_regular_polygon`. 2D sections for CSG.
- **Architecture** — `g_wall` `g_floor_slab` `g_stairs` `g_roof`
  `g_facade_panel` `g_window` `g_door` `g_railing` `g_column`, plus
  **`g_storey_stack`** (DSL `storey_stack`) to repeat one already-modelled
  storey up the Z axis (bakes the repeated floors into per-floor `<sha>.glb`
  parts instead of re-modelling every floor). Static low-poly building
  elements (walls with openings, slabs with wells,
  stairs, pitched roofs, framed windows/doors). Each exposes optional shaping
  knobs (all default off / backward-compatible): walls take an auto `window_band`
  and a `plinth` base; roofs split eave/verge overhang and add flat-roof
  parapets + coping; stairs add thin/open treads and a mid landing; columns take
  taper + base/capital styles + flutes; doors add panel grids + transom/sidelight;
  windows auto-divide panes by width and add sill/arch tops; railings pick post
  shape/spacing + bottom/mid rails; slabs add perimeter downstand beams + edge
  chamfer; facade panels choose groove direction/spacing + lap/shiplap board
  style. No whole-building orchestrator —
  emit the element ops and assemble them into one rooted tree by hand with
  `g_part` + `g_joint_fixed`. See **PART B** of the `skills/compose-lowpoly/` skill
  (`skills/compose-lowpoly/executions/part-b-building.md`).

### Modify
- **CSG** — `g_difference` `g_union` `g_intersection` `g_extrude`
  `g_extrude_with_holes` `g_loft` `g_revolve` `g_sweep` `g_pipe`
  `g_section_loft` `g_fillet` `g_sdf_blob`. Hollow shells, cuts, recesses,
  lofted/swept/revolved solids. **`g_fillet`** rounds (`type=round`) or bevels
  (`type=chamfer`) a solid's edges (`edges=all` / `vertical`) — the general
  edge-treatment op; only works on solids, not on the meshes from
  `g_pipe`/`g_sweep`/`g_section_loft`/`g_sdf_blob`, which emit a **mesh**, not a
  solid, and can't feed a boolean either. **`g_sdf_blob`** (DSL `sdf_blob`)
  smooth-unions/subtracts/intersects sphere/capsule/box/cone/ellipsoid
  primitives via marching cubes into one continuous organic mesh — for genuine
  multi-volume blending (fused muscle/limb blobs), not routine edge rounding.
- **Transform** — `g_translate` `g_rotate` `g_scale` `g_mirror` `g_array_linear`
  `g_array_radial`.
- **Material** — `g_material` `g_named_color` `g_texture`.
- **Placement** — `g_align_centers` `g_place_local` `g_place_on_face`
  `g_place_on_surface`.

### Assemble
- **Assembly** — `g_part` + `g_joint_fixed` `g_joint_revolute`
  `g_joint_prismatic` `g_joint_continuous` `g_joint_planar` `g_joint_floating`
  `g_joint_mimic` `g_joint_on_surface`. Links + joints into one rooted URDF tree.
- **Collision** — `g_collision_box` `g_collision_clustered` `g_auto_collision`
  `g_inertial_from_geometry`.
- **Character rig** (角色路, `batteries/Assemble/Rig/`) —
  `g_bone` (`bone`), `g_skeleton` (`skeleton`), `g_skin` (`skin`). Soft-body
  characters/creatures: a free bone tree + smooth skinning instead of rigid URDF joints.
  **The agent authors the bone tree by hand** (parent chain by anatomy — limbs each parent
  to a central bone, never leg-to-leg), then adds one `skin(method="auto")`. Any of
  `bone`/`skeleton`/`skin` switches the compile to the **character path**. Weights are NOT
  stored in the DSL/backend — solved on the frontend by geodesic voxel binding. Same
  two-phase build as PART A (per-part bake → reference-assemble), the only difference being
  the assembly writes bones instead of joints. See **PART D** of the
  `skills/compose-lowpoly/` skill (`skills/compose-lowpoly/executions/part-d-character.md`).

### Animation
- **Clip** — `g_bake_animation` (DSL `animation`, joint-path: channel keys = URDF
  joint names, limit-clamped) and `g_bake_skin_animation` (DSL `animation` on the
  **character path**: channel keys = bone names, value = bend radians about **each
  bone's own bend axis** — a stable hinge axis perpendicular to the bone's head→tail
  direction, so `tail` controls the swing plane; no limit clamp). The compiler routes
  an `animation` statement to the skin variant automatically when the DSL is a
  character DSL. Prefer authoring motion as sparse `keyframes`.

### Output
- **Bake** — `g_bake_part` `g_bake_object`. `g_bake_part` also returns
  `bbox_min`/`bbox_max`/`size` (baked mesh local AABB + dimensions in meters) for
  placement and feeding `g_mesh`. On the character path, `g_bake_object` also merges
  all parts into the one skinnable mesh consumed by `g_to_rig`.
- **QC** — `g_geometry_qc` (URDF path: SSA/type + URDF semantics + geometry
  checks in one battery), `g_skin_qc` (character path: skeleton/bone/skin
  topology + bone-length checks).
- **Export** — `g_to_urdf` (URDF path terminal + OCCT baker) and **`g_to_rig`**
  (character path terminal: emits a **RigSpec** JSON — skeleton + skinnable-mesh ref
  + skin params + bone clips, weights excluded). Preview: `g_preview` / `urdf_preview`
  (URDF) and **`rig_preview`** (character, passthrough RigSpec). GLB export supports
  `mode: animated|static|skinned|character` (character = skeleton + smooth skinning +
  bone animation).

> **Mechanical CAD parts** (gears, hinges, brackets, panels/grilles, fans, knobs,
> bezels, wheels/tires) are **not available in this game-asset tool** — the
> `Generate/Parts` batteries that used to generate them were removed and the
> corresponding DSL ops (`spur_gear`/`wheel`/`knob`/`clevis_bracket`/etc.) were
> deleted from `op-registry.ts`; they no longer appear in the op-directory and
> compiling DSL that still references them fails at compile time with an
> unmapped-op error. Their shape-building code still lives under
> `backend/src/services/baker/ops/` for internal reuse (e.g. `baker-gears-all.smoke.ts`),
> but it is not DSL-reachable. Do not reference `g_gear`/`g_knob`/`g_wheel`/etc.;
> route mechanical-looking forms through Profile → CSG (extrude/revolve/loft +
> boolean) or `g_sdf_blob` instead.

The end-user modeling guidance lives in the single `skills/compose-lowpoly/`
skill — an entry/router (`SKILL.md`) over four flows: **PART A · asset /
mechanical** (philosophy, family routing, id-port wiring, runnable assembly
example, QC loop — `executions/part-a-asset.md`); **PART B · building** (the
architecture-flavoured walls/slabs/stairs/roofs/openings workflow + the building
brief — `executions/part-b-building.md`); **PART C · scene assembly** (place
already-baked meshes and export the whole scene to .glb —
`executions/part-c-scene-assembly.md`); and **PART D · character / creature**
(per-part bake like A, then author the bone tree + `skin(auto)` for soft-body
skinning — `executions/part-d-character.md`). The **required** shared references are
`op-directory.md` (op signatures, sharded by family — see the shard index at its
top) + `dsl-quickref.md` (syntax); `battery-catalog.md` and `quickstart.md` are
consulted on demand. The old `createNode`-format background docs
(`modeling-guide.md` / `pipeline-schema.md`) moved out of the agent read path to
`docs/superpowers/archive/` (human historical reference only). Keep the op
catalogue in sync with the families under `batteries/<Stage>/<Family>/` when ops
are added or removed, and regenerate the op-directory shards
(`node scripts/gen-op-directory.mjs`) so the DSL SSOT stays current.

## Domain surfaces

- `wb-3d-lowpoly.projects` — project list/create/open/remove actions.
- `wb-3d-lowpoly.model` — **DSL-first** modeling: `model.apply` (validate +
  compile + execute + QC in one call), `model.get` (read back DSL), `parts.list`
  (baked-mesh manifest). This is the primary agent surface.
- `wb-3d-lowpoly.pipeline` — low-level graph get/apply/execute/import/export
  actions (transitional / human; agents use `model.*`).
- `wb-3d-lowpoly.preview` — asset inspection actions (human-only; not an agent step).

## Path slots

(empty — populated when path slots are declared)
