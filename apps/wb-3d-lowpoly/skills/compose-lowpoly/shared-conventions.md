# Shared conventions — anti-primitive modeling rules

> Referenced by all four executions. The **planning gate itself now lives in
> [build-spec.md](build-spec.md)** — one structured JSON spec per model, shared by
> PART A / B / C / D. PART B layers its building-specific placement recipes on top in
> [part-b-building.md](executions/part-b-building.md). This file only keeps the rules
> about *which op builds a given form for real*.

## Anti-primitive modeling rules

Real objects are **shells, cuts, curves, recesses, grilles and fillets** —
almost none are a bare box or cylinder. Before placing any primitive, default to
"which Profile/CSG op builds this for real?":

- hollow shell / casing / enclosure → profile → `g_extrude`/`g_revolve` then
  `g_difference` (cut the cavity), **not** a box.
- opening / window / port / slot / vent → `g_difference` (repeated/patterned
  cuts for a grille/perforation), **not** a smaller box laid on top.
- round / domed / bottle / nozzle / barrel body → `g_revolve` / `g_loft`,
  **not** a cylinder.
- pipe / cable / handle / duct → `g_pipe` / `g_sweep`, **not** stacked cylinders.
- rounded edges / chamfers / fillets → build them into the profile
  (`g_profile_rounded_rect`) or via CSG, **not** ignored.
- irregular / organic / craggy (rock, boulder, rubble, terrain chunk) →
  `rock`/`boulder` ([core](op-directory/core.md); deterministic-noise icosphere,
  `seed` for reproducibility), **not** a plain `sphere`.
- multiple basic volumes that must **fuse into one continuous organic body**
  (monster torso, tentacle root mass, fused muscle/limb blobs, blob-creature
  head+body) → `sdf_blob` ([core](op-directory/core.md); sphere/capsule/box/
  cone/ellipsoid primitives combined via `smooth-union`/`subtract`/`intersect`,
  real Marching Cubes isosurface — a smoothly continuous mesh, not a
  faceted union of separate solids), **not** several primitives merely placed
  next to each other or hard-`union`'d (that leaves a visible seam at the
  join). Reach for plain `fillet`/`chamfer` instead when the goal is just
  rounding a solid's edges — `sdf_blob` is for genuine multi-volume blending,
  not routine edge softening. Its output is a triangle mesh like `rock`, so it
  cannot itself feed `union`/`difference`/`intersection`/`fillet`/`chamfer`.

`g_bake_part` skips native primitives on purpose: if `shape_id` points at a
`box`/`cylinder`/`sphere` it bakes nothing and returns an empty `filename` plus a
`note`. Such trivial parts need no mesh — assemble them in Phase 2 with `g_box`
/ `g_cylinder` / `g_sphere` directly.
