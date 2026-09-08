# Battery Catalog — which op to use (routing only)

This is a **routing aid** for picking a family/op. It is *not* where you get op
signatures: exact arg names/kinds live in [op-directory.md](op-directory.md) (the
authoring SSOT). **Do not call `batteries.list` / `batteries.get`.**

## Battery Families

The DSL op name is authoritative from [op-directory.md](op-directory.md); the
families below tell you **which op to even look for** (they list `g_*` battery ids;
the DSL op you write is the un-prefixed name from op-directory.md).

| Family | Examples | Produces | Use when |
|---|---|---|---|
| **Primitive** | `g_box` `g_cylinder` `g_sphere` `g_cone` `g_capsule` `g_torus` `g_dome` `g_mesh` `g_rock` | a `geometry` + `id` | the visible form genuinely *is* that primitive (slab, plain rod, ball); **`g_mesh` references a Phase-1 staged `<sha>.obj`** to reassemble a baked part (set its optional `bbox_min`/`bbox_max` from `g_bake_part` so the scene mesh resolves an AABB for QC overlap); **`g_rock`** (DSL `rock`/`boulder`) = icosphere + deterministic per-seed displacement for terrain decoration/rubble/boulders — **use this instead of `g_sphere`** for irregular rocks; mesh-backed like `g_pipe`/`g_sweep`/`g_section_loft`, so it **cannot** feed union/difference/intersection |
| **Profile** | `g_profile_rect` `g_profile_rounded_rect` `g_profile_circle` `g_profile_polygon` `g_profile_regular_polygon` | a 2D `profile` + `id` | you need a cross-section to feed extrude / revolve / loft / sweep |
| **CSG** | `g_difference` `g_union` `g_intersection` `g_extrude` `g_extrude_with_holes` `g_loft` `g_revolve` `g_sweep` `g_pipe` `g_section_loft` `g_fillet` `g_sdf_blob` | a `geometry` + `id` | hollow shells, cut openings/holes, recesses, lofted/swept/revolved bodies, merged solids; **`g_fillet`** rounds (`type=round`) or bevels (`type=chamfer`) the edges of a solid; **`g_sdf_blob`** (DSL `sdf_blob`) smooth-blends multiple sphere/capsule/box/cone/ellipsoid primitives into one continuous organic mesh (monster torso, fused muscle/limb blobs) — mesh-backed like `g_rock`/`g_pipe`/`g_sweep`/`g_section_loft`, so it **cannot** feed union/difference/intersection/fillet |
| **Architecture** | `g_wall` `g_floor_slab` `g_stairs` `g_roof` `g_facade_panel` `g_window` `g_door` `g_railing` `g_column` (assemble by hand with `g_part` + `g_place_local`, **no joints**) · **`g_storey_stack`** (DSL `storey_stack`) | a `geometry` + `id` | the prompt names a building / house / room / wall / floor / stair / roof / door / window / railing / column (static low-poly architecture). **`g_storey_stack`** repeats one already-modelled storey up the Z axis: list the storey's part ids, give `count` + `storey_height`. By default (`mode="merge"`) it flattens the storey's poses (each part's own `origin`/`rpy`, or forward kinematics through intra-storey joints when the model has any), bakes the whole floor into **one multi-material `<sha>.glb`**, and replaces the storey with **one `part` per floor** referencing it — a 20-storey tower costs 20 parts instead of 600, with a single copy of the mesh data. Those per-floor mesh-ref parts **mix freely with hand-authored real-shape parts** (roof, canopy, ground-floor lobby): the static bake partitions them and drops nothing. Pass `mode="instance"` only when an individual element of a given floor must stay addressable (an openable door, per-element collision): that copies every `part` per storey instead. Use it for high-rises / towers / any repeated typical floor instead of hand-writing the same storey N times |
| **Transform** | `g_translate` `g_rotate` `g_scale` `g_mirror` `g_array_linear` `g_array_radial` | transformed `geometry` | place / orient / mirror / repeat an existing shape |
| **Assembly** | `g_part` + `g_joint_fixed` `g_joint_revolute` `g_joint_prismatic` `g_joint_continuous` `g_joint_planar` `g_joint_floating` `g_joint_mimic` `g_joint_on_surface` | a `geometry` (URDF links/joints) + `id` | wrap a shape into a link (`g_part`) and connect links into one rooted tree (`g_joint_*`) |
| **Utils** | `g_bake_part` `g_bake_object` `g_material` `g_texture` `g_named_color` `g_align_centers` `g_place_local` `g_place_on_face` `g_place_on_surface` `g_collision_box` `g_collision_clustered` `g_auto_collision` `g_inertial_from_geometry` `g_geometry_qc` `g_metrics` `g_to_urdf` | varies | **`g_bake_part`** = Phase-1 bake-staging (one shape → reusable colorless `<sha>.obj`; returns `bbox_min`/`bbox_max`/`size`). **`g_bake_object`** = bake a whole object of multiple colored parts into ONE multi-material `<sha>.glb` (per-part colors embedded) — reference once via `g_mesh` with NO link material to keep the colors; use for fixed-palette objects reused as a unit. Each part's shape can be a REAL shape **or** a `g_mesh` reference to a pre-baked `<sha>.obj` (read back + merged by pose) — the character path relies on this to merge separately-baked parts into one skinnable mesh. **`g_material`** now also takes `metalness`/`roughness` (both 0..1) and an optional `texture_id` (ref to a `g_texture`) — the texture/PBR values only actually render when the material's part goes through `g_bake_object` (plain URDF `<color>` has no texture slot; metalness/roughness there are a non-standard `<pbr>` hint for this project's own viewer only). **`g_texture`** = declare a `texture(image, repeat, offset, rotation)` statement (`image` path is relative to the project's `assets/textures/`) to feed into `g_material`'s `texture_id`. Plus placement helpers, collision/inertia, QC sensors (**`g_geometry_qc`** = boolean signals for fix loops; **`g_metrics`** = quantitative numbers + a 0–100 `score`/`grade`), and the terminal **`g_to_urdf`** URDF emitter. **`g_place_local`** (DSL `place_local`) places a child at a pose stated **relative to a parent part** — it composes `parent.origin/rpy ∘ offset/rpy` at compile time and writes the result back as the child's absolute pose, so it builds **no joint** and stays on the static path (this is how PART B seats a window in a wall opening or a door leaf on its frame) |
| **Animation** | `g_bake_animation` (DSL `animation`, 关节路，通道键=URDF 关节名) · `g_bake_skin_animation` (DSL `animation`, 角色路自动走，通道键=骨骼名 + 可选 `root_motion`) | a `geometry` (+ `animation`/`report`/`error`) | 导出的 GLB 要**播一段动作**。**路线由「谁在动」决定，不看动作词**：**活物**（人 / 动物 / 怪物）走 / 跑 / 游 / 摆尾 / 呼吸 / 跳跃 = **角色路骨骼动画**（先建 skeleton，再 `animation`；骨骼弯曲写 `keyframes`，整体前进/腾空写米制 bind-relative `root_motion=[{t,x,y,z},…]`，模型根帧 X 向前、Z 向上）；**机械件**门扇 / 夹爪 / 齿轮转 / 机械臂 = **关节路关节动画**（先建 `joint`，再 `animation` 通道键=关节名）。**一只会走的动物是角色，不是关节机器** |
| **Character rig** (角色路) | **DSL ops**: `bone` · `bone_chain`（一个 part 对应多段骨骼链，如尾巴/蛇身）· `skeleton` · `skin`（组装时手写骨架 + 一行 `skin(auto)`）。终端链电池（自动追加）：`g_skin_qc` `g_bake_object` `g_to_rig` `rig_preview` | a `geometry` → **RigSpec**（角色 IR） | 角色 / 生物 / 软体：要**一块连续表皮随骨架平滑弯曲**（非刚性关节）。出现 `bone`/`bone_chain`/`skeleton`/`skin` 即触发角色路（见 [PART D · 角色](executions/part-d-character.md)）。骨架手写、父子按解剖，只有蒙皮权重由前端测地体素绑定自动求解、不在 DSL |
| **Static scene** (静态路终端，自动追加) | `g_geometry_qc` `g_bake_object`(仅真实形态件) `g_to_scene` `scene_preview` | a `geometry` → **SceneSpec**（静态 IR） | 无 `joint`、无 `skin`/`skeleton` 的物体/场景自动走静态路：`g_to_scene` 按各 part origin/rpy/material 合并成**单个多材质 `.glb`**，导出 `mode="static"`（见 [PART C · 场景](executions/part-c-scene-assembly.md)） |
| **Preview** | `urdf_preview` `g_preview`（机械/URDF 路） · `scene_preview`（静态路，passthrough SceneSpec） · `rig_preview`（角色路，passthrough RigSpec） | URDF / SceneSpec / RigSpec / preview | make the model visible in the 3D viewer |

### Which family? (routing — try these top-to-bottom, primitive is LAST)

Default to a richer family; only fall through to **Primitive** when every row
above genuinely does not apply.

- The prompt asks for a whole **scene / city / multi-object + building
  composition** (a street, a village, a small city, props + buildings staged in
  one environment) → **SCENE orchestration** (see
  [PART C · 场景编排与组装](executions/part-c-scene-assembly.md)): write a
  **detailed** scene inventory (per item: A or B, 2–3-sentence real form, target
  size, count, which reuse one mesh), then model each **unique** item through its
  PART A/B execution file + `g_bake_part` — **all baked in the same scene project**
  (the blob library is workspace-level/content-addressed, so same-project bakes
  resolve straight from `g_mesh`). Assemble by giving each `g_part` an `origin` (no
  `g_joint` — a jointless scene routes to the STATIC pipeline and `g_to_scene`
  merges the placed parts into one multi-material `.glb`; no URDF auto-stitch).
  Reuse one `<sha>.obj`
  across N instances via N `g_part` origins; **do not** `g_array_*` / `g_translate`
  a referenced mesh for placement (those `SUBGRAPH_BAKE_OPS` re-bake a fresh OBJ per
  instance and kill instancing — use `g_array_*` only for genuine rule-based
  repetition where the re-bake cost is acceptable). **No new scene-level battery is
  needed** — per-item `g_bake_part` + reference assembly already covers it.
- The prompt names a building / house / room / interior or a building element
  (wall, partition, floor/slab, stair, roof, door, window, facade/siding) →
  **Architecture** (see the dedicated [PART B · 建筑](executions/part-b-building.md)).
  There is no whole-building orchestrator: emit each element op, wrap it in a
  `g_part` and give that part its **absolute** `origin`/`rpy`; only the poses that
  can only be stated relative to a parent (window in a wall opening, door frame in
  a wall opening, door leaf on its frame) go through **`g_place_local`**. **Emit no
  `joint`** — a jointless building routes to the STATIC pipeline and bakes into one
  merged GLB. Write `g_joint_revolute` only for a genuinely openable leaf, and
  accept that it puts the whole building back on the URDF path (everything then
  needs joints into one rooted tree). If the building has **repeated typical
  floors** (high-rise, tower, slab block), model **one** storey that way and repeat
  it with a single `storey_stack(...)` line instead of writing the same storey again
  per floor — it bakes that floor into one GLB and leaves you a single `part` per storey.
- The form is hollow, has a cut/hole/recess/pocket, or is a lofted / revolved /
  swept / extruded / tapered / rounded body → **Profile → CSG** (build a profile,
  then extrude/revolve/loft, then `g_difference` to cut openings).
- The object has multiple parts and/or anything that moves (door, lid, wheel,
  switch, arm) → wrap each shape with **`g_part`** and connect with
  **`g_joint_*`** so it is one rooted URDF tree.
- The prompt names a **character / creature / soft body** (person, animal,
  monster, mascot) — anything that should be **one continuous skin bending
  smoothly with a skeleton** (not rigid parts turning about axes) → **Character
  rig** (see [PART D · 角色](executions/part-d-character.md)): bake each body part
  like PART A, then in assembly **author the bone tree by hand** — one
  `bone(origin=head, tail=, parent=)` per part with the parent chain set by anatomy
  (limbs each parent to a central bone, never leg-to-leg) — plus `skeleton(root=…)`
  and one `skin(method="auto")`. A single continuous part that wants several smoothly
  bending segments (tail, snake body, whip) uses **`bone_chain(origin=, tail=, count=N, parent=)`**
  instead of hand-writing N `bone` lines. Export with `export-glb({ mode: "character" })`. **This holds even when the creature MOVES:
  a walking / running / swimming animal is still a character — its locomotion is
  bone animation, never URDF joints.** **Never mix `joint` and `skin`/`skeleton`
  in one file** (mixed-model error).
- The prompt wants the exported GLB to **perform a motion** → **route by what is
  moving, not by the motion word.** A **living creature** that walks / runs /
  swims / wags → it is a character: build the skeleton (PART D) and add one
  `animation(...)` whose **channel keys are bone names** (value = bend radians
  about the bone's authored `axis`; e.g. a walk = each leg bone with `axis=[0,1,0]` swinging fore/aft, legs
  in alternating phase). A **mechanical / articulated** thing (door, lid,
  gripper, gear, robot arm, even a *walking robot*) → build the `joint`s first,
  then add one `animation(...)` whose **channel keys are joint names**. Either
  way describe the motion as sparse **`keyframes`** — a few `{t, q}` points per
  channel, never a full per-frame array (the battery samples/interpolates it).
  Joint example: `anim1 = animation(fps=30, keyframes="{\"wrist\":[{\"t\":0,\"q\":0},{\"t\":1,\"q\":1.2},{\"t\":2,\"q\":0}]}")`.
- The form is an **irregular rock / boulder / rubble / terrain decoration** → **`g_rock`**
  (DSL `rock`/`boulder`), not `g_sphere` — a plain sphere reads as an obviously artificial
  ball, `g_rock`'s seeded displacement gives a genuinely irregular silhouette for free.
- The form is a soft **organic blend of multiple rounded volumes** (fused muscle/
  limb blobs, a tentacle root mass, a monster torso that is not a clean skeleton +
  skin) but does **not** need a full character rig → **`g_sdf_blob`** (DSL
  `sdf_blob`): smooth-unions/subtracts/intersects sphere/capsule/box/cone/ellipsoid
  primitives into one continuous mesh via marching cubes. Prefer plain `g_fillet`
  for routine edge-rounding on an otherwise-solid shape — reach for `sdf_blob` only
  when the goal is genuine multi-volume blending.
- **Only if none of the above apply** and the form is literally a flat slab /
  plain rod / ball / ring with no cut, cavity, curve, or fillet → **Primitive**.

For any non-trivial object this routing runs **per part inside Phase 1**: each
part is modeled in its own subgraph and baked with **`g_bake_part`** into a staged
`<sha>.obj`. Phase 2 then references those meshes with **`g_mesh`**, wraps each in
`g_part`, colors with `g_material`, and connects with `g_joint_*`.

Then always end Phase 2 with QC + a terminal — but **the compiler auto-appends
the right chain by content, so you never hand-write the terminal**: jointless
object/scene → `g_geometry_qc → [g_bake_object] → g_to_scene → scene_preview`
(static, single merged GLB); has `joint` → `g_geometry_qc → g_to_urdf →
urdf_preview` (URDF); has `skin`/`skeleton` → `g_skin_qc → g_bake_object →
g_to_rig → rig_preview` (character).

- **Prefer the semantic family over faking a form with primitives + transforms.**
  A box-stack that "reads as" the object is the most common failure here — if you
  reach for a second or third primitive to imitate one part, you are on the wrong
  family. Re-route to Profile → CSG (or `g_sdf_blob` for organic blends).
- Read the richer sensor/report outputs: `g_geometry_qc` emits
  `floating_links` / `orphan_profiles` / `primitive_only` and a structured
  `signals[]`; `g_to_urdf` emits a `report` (mesh/triangle counts, `bakeFallbacks`,
  `fingerprint`). `g_auto_collision` derives `<collision>` for every part.
- Use preview/output batteries already present in the catalog to make the
  result visible in the URDF viewer.
- Treat missing batteries as a capability gap and report it instead of
  inventing op IDs.
