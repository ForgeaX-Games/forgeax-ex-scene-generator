# Quickstart

DSL-first. Studio ToolRegistry (`lowpoly:*`) is the only control plane; you write
Geometry DSL text and submit it — never hand-wire nodes.

1. `lowpoly:projects.list` / `lowpoly:projects.open` (or `create`) to pick the
   active project. `open` is a shared attach — it does **not** take the write
   lock and never queues, so it is safe even while a peer is mid-edit; the write
   lock is claimed (and waited on) by the first `model.apply` / `pipeline.*`
   mutation. Always `lowpoly:projects.close` when done: it releases both your
   write lock and your session, and you cannot open a second project until you
   do. Use `projects.heartbeat` only across a long non-editing stretch, and
   `projects.queue.status` / `projects.queue.leave` if a peer is holding the
   write lock. **Resuming an interrupted task** (told to "continue", or the
   project already has parts/DSL you don't remember building): read
   `project.manifest.description` from the `open` response (or `description` on
   `projects.list`) for a checkpoint **before** re-planning — see SKILL.md
   §2 "断点续接". Write one back with `lowpoly:projects.update` after every real
   milestone (spec finalized, an item baked, assembly converged); it is a durable
   disk write, unlike anything that only lives in this conversation.
2. **Op signatures come from [op-directory.md](op-directory.md)** (the authoring
   SSOT) and syntax from [dsl-quickref.md](dsl-quickref.md). Do **not** call
   `batteries.list` / `batteries.get`.
3. **Phase 0 — build spec** (hard gate): one structured JSON entry per part
   (`function` → `form` → `ops` → `size` → `place.center` → `datum` → `features` →
   `material` → `parent`), then run the spec's own self-check. A thin
   "A: box, B: cylinder" list is a failed spec — see
   [build-spec.md](build-spec.md). Prefer CSG / Architecture / Assembly over
   stacked primitives. Never build the whole object in one model. Buildings additionally
   read [part-b-building.md](executions/part-b-building.md) for the Architecture-op
   workflow and placement recipes.
4. **Phase 1 — model + bake each part** (loop): write a small DSL per part and
   submit
   `model.apply({ source, bake: "<shape_id>", expectedDims: part.size, features: part.features })`;
   record the returned `<sha>.obj` filename + bbox (`lowpoly:parts.list` can
   re-list them) and check `advice.dimensionDelta` against the spec.
5. **Phase 2 — assemble** (one clean DSL): `mesh(filename=<sha>.obj)` per
   non-trivial part (trivial primitives stay `box`/`cylinder`), wrap with `part`,
   color with `material`, connect with `joint`, then `model.apply({ source })`
   (the compiler auto-appends the QC + URDF terminals). Placement is arithmetic:
   `origin = place.center − c_local`, where `c_local` is the local bbox center from
   the bake receipt.

Do not write runtime JSON directly.

## Iteration Loop

A **self-check → self-fix → re-apply closed loop the agent owns**: diagnose and fix
mechanical defects yourself from the `model.apply` receipt, loop until it is clean
*and* each part's size/AABB matches the Phase-0 spec. Only stop to ask the user
on subjective / unclear-requirement calls. The loop runs in **Phase 2** (assembly);
Phase 1 is a bake loop with no per-part gate.

For a **scene** (see [part-c-scene-assembly.md](executions/part-c-scene-assembly.md)):
per-unique-item `model.apply({bake})` (all in the same project) → reference assembly
by giving each `part` an `origin` (one `<sha>.obj` reused across N instances). A
jointless scene **auto-routes to the STATIC pipeline** (`g_geometry_qc → g_to_scene`),
which merges every placed part into **one multi-material `.glb`** — there is **no
URDF, no auto-stitch, and no `islands`/`floating_link`** in scene mode. Only overlap
signals apply, and they are informational — fix obvious real clashes, not every AABB touch.

The **`model.apply` receipt is the whole completion gate** — read it after every
apply:

- `errors` — parse / validate / unmapped-op, each mapped to a DSL line number. Fix
  that line and re-apply.
- `qc` — `valid`, `islands`, `overlaps`, `missing_aabb`, `floating_links`,
  `orphan_profiles`, plus structured `signals[]` with a per-signal `severity`
  (`error`/`warning`/`note`). **Loop until `valid` is true / no `error`-severity
  signal remains.** **On the URDF path `islands`/`floating_link` are the hard
  connectivity defects** — a part with no joint path to the root gets silently
  dropped from the URDF, so wire it in with `g_joint_*`. Jointless models
  (buildings, static scenes) have no joint tree and never raise these two; there
  nothing is dropped, but nothing checks for floating parts either — that is on your
  own spec self-check. **`aabb_overlap`/`mesh_overlap` never fail `valid`**
  — low-poly models often have benign rest-pose AABB touches (wall corners, embedded
  frames, stair wells). Rigid fixed-joint overlaps emit `note`; moving-joint-chain
  overlaps emit `warning`. Review case-by-case with `g_metrics max_penetration` /
  `overlap_ratio`, but **do not detach or reposition parts just to silence overlap**
  — that trades informational noise for a real `floating_link`/`islands` error.
- `meshQc` — mesh-aware interpenetration (needs `mesh` `bbox_min/max`); same
  note/warning split as `aabb_overlap` above. Only `joint_child_detached` on a moving
  joint fails `clean`.
- `urdf` — `fingerprint` (compare across iterations to confirm the output changed),
  `bytes`, and any `errors`.
- `advice.dimensionDelta` (bake mode) — the per-axis gap between what baked and the
  `expectedDims` you passed from the spec. Non-blocking, so it is on you to act on it.
- Cross-check each part's size/AABB against the Phase-0 spec to catch
  scale/proportion errors.

Fix the **decomposition**, not just the symptom; do not declare completion from a
single clean apply if a part still doesn't match its spec entry. For physics/sim,
add `g_auto_collision` before the assembly's terminal.
