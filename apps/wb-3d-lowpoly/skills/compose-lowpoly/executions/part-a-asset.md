# PART A · 资产 / 机械（逐件建模 → 引用 mesh 组装）

> [SKILL.md](../SKILL.md) 路由到此。本文件是 **PART A** 的完整执行步骤。
> 授权参考只需两份：DSL 语法 + 可跑示例 [dsl-quickref.md](../dsl-quickref.md)、op 签名——
> [core](../op-directory/core.md)（Profile/CSG/Transform/primitive）+
> [assembly-misc](../op-directory/assembly-misc.md)（`part`/`joint`/`material`…）两个分片，见
> [op-directory.md](../op-directory.md) 索引。选型拿不准再查 [battery-catalog.md](../battery-catalog.md)
> 的路由表——按需，别一次全读。

> **DSL-first（唯一流程）**：**只写 DSL、用 `lowpoly:model.apply({ source })` 提交**——后端一次完成
> 校验+编译成图+执行+QC，回执把错误/QC 信号**定位到 DSL 行号**。**阶段1 烘焙**用
> `model.apply({ source, bake: "<shape_id>" })`（回执 `baked.filename`=`<sha>.obj`，自动登记
> `parts.json`，`lowpoly:parts.list` 可查）；**阶段2 组装**写 `mesh(filename="<sha>.obj")` → `part`
> → `joint` 再 `model.apply`。语法见 [dsl-quickref.md](../dsl-quickref.md)，op 签名见上面三个分片
> （authoring SSOT，不必再读 battery-catalog / archive 里的旧 modeling-guide）。
> **完成门禁 = 回执干净**（无 errors / `qc.valid` / `meshQc.clean` / 无 urdf 错误）——完成判定只看回执。

适用：单个物件 / 机械件 / 装配体（枪、宝箱、机械臂…）——任何非平凡物件都走下面的
**强制两阶段工作流**。建筑走 [PART B](part-b-building.md)；把已 bake 的件摆成场景走
[PART C](part-c-scene-assembly.md)。

## 需求特征 → op（先选再写）

- 规则轮廓、孔腔、倒角、齿/铰链/把手/风扇/面板这类机械细节 → Profile/CSG（`g_revolve`/`g_extrude`
  回转或拉伸出主体，`g_difference` 切齿槽/孔/缝），不要找专用零件电池——本工具不提供齿轮/
  合页/旋钮类机械 CAD 电池。
- 装配位姿由 spec 的 `place.center` 减去 bake 回执的局部 bbox 中心算出（[build-spec.md §3](../build-spec.md#3-spec-怎么驱动后面两个阶段)）。同轴 / 贴面这类**语义关系**仍优先 `align_centers`、`place_on_face`、`place_on_surface`。
- 计划走 [build-spec.md](../build-spec.md) 的 JSON schema。同一缺陷最多 3 次 patch；sourceHash/fingerprint 不变即停止。

---

## Workflow spine — model each part → bake → assemble

`caller.kind = "ai"`. Every non-trivial object is built in two passes and **never
in a single mega-model**:

1. **Set up.** Open/create a project with `lowpoly:projects.*`. Get op signatures
   from [core](../op-directory/core.md) / [assembly-misc](../op-directory/assembly-misc.md) —
   do **not** call `batteries.list` / `batteries.get`.
2. **Phase 0 — build spec (hard gate).** One structured JSON spec *before* any
   DSL ([build-spec.md](../build-spec.md)). No spec, no building.
3. **Phase 1 — model + bake each part (loop).** For each part write a small DSL that
   builds the real detail (CSG / Architecture) and submit
   `model.apply({ source, bake: "<shape_id>", expectedDims: part.size, features: part.features })`.
   Record the returned `<sha>.obj` filename + bbox, and read `advice.dimensionDelta`.
   One part per `apply`.
4. **Phase 2 — assemble (one clean DSL).** `mesh(filename=<sha>.obj)` → `part` →
   `material` → `joint` into one rooted tree, then `model.apply({ source })` (the
   compiler auto-appends the QC + URDF terminals — you do not write them).
5. **Iterate on the assembly only** from the receipt signals. To change a part's
   geometry, re-model + re-bake that single part in Phase 1.

## Mandatory Two-Phase Workflow (read before the first `model.apply`)

> **The default failure mode of this skill is laziness: the agent heaps the whole
> object into one big batch, stacks a few `g_box`/`g_cylinder` primitives, the
> batch turns green, and ships a blocky toy that does not look like the object.**
> One mega-batch that builds the entire graph at once *forces* this degradation —
> there is no room to model any single part properly.

**Hard rule — never compose the whole object in a single batch.** Build every
non-trivial object in two phases: model each part *on its own*, bake it to a
reusable mesh, then assemble a clean graph that only *references* those meshes.

This works because the backend already content-addresses baked meshes: when
`g_to_urdf` (or `g_bake_part`) bakes a non-native shape it writes a
content-addressed `.obj` into the workspace-level `library/blobs/` and hands you a
`<sha>.obj` filename. `g_mesh(filename=<sha>.obj)` references it, and the viewer
resolves it over the same baseUrl. So Phase 1 *stages* meshes and Phase 2
*references* them — no re-baking, no re-running heavy CSG at assembly time.

### Phase 0 — Build spec (hard gate)

Full schema, self-check list and worked example are in
[build-spec.md](../build-spec.md) (shared by all four routes) — **PART A uses the
base schema plus the `joint` field, nothing else**. One entry per real part (a
distinct solid / distinct material-color / independently moving piece — no filler
entries), each detailed enough to model *from that entry alone*. A thin list
("A: box, B: cylinder, C: box") is a **failed spec** and Phase 1 will degrade
straight back into stacked primitives — fix the entry before modeling, not during.
**Do not build any node until the spec is complete and passes its own self-check.**

### Phase 1 — Per-part standalone modeling + bake staging (loop)

Iterate over the spec's `parts`, **one part at a time**. For each part:

1. Write a **small standalone DSL** for just this part. Use `CSG` / `Architecture`
   to build every entry in that part's `features` — this is where form quality is
   won or lost.
2. Submit
   `model.apply({ source, bake: "<shape_id>", expectedDims: part.size, features: part.features })`
   where `<shape_id>` is the terminal shape's `id`. The backend bakes it into
   `library/blobs/` and returns `baked.filename = <sha>.obj` (plus `bbox_min` /
   `bbox_max` / `size`), and auto-registers it (query later via `lowpoly:parts.list`).
3. **Read `advice.dimensionDelta`** — the per-axis difference between what baked and
   what the spec planned. Off by more than ~10% on any axis means either the DSL is
   wrong or the spec was wrong; fix one of them and say which. It is a non-blocking
   signal, so nothing stops you from ignoring it — don't.
4. **Record the returned `<sha>.obj` filename + bbox** for Phase 2.
5. Move to the next part — each `bake` apply replaces the graph, so nothing
   accumulates; you carry only the recorded filenames forward.

Phase 1 has **no per-part QC gate** — the only machine signal is
`advice.dimensionDelta`; everything else about form quality is on you as you model.
Bake as soon as the part reads right and matches its spec entry, then move on.
Model each part around its **own local origin / assembly datum** (the `datum` field):
the bake stores *local* coordinates, so all placement happens later in Phase 2.

The anti-primitive rules still govern Phase-1 modeling — see
[shared-conventions.md § Anti-primitive modeling rules](../shared-conventions.md#anti-primitive-modeling-rules)
(shared with PART D) for the full "which CSG op builds this for real?" table.
`g_bake_part` skips native primitives on purpose: if `shape_id` points at
a `box`/`cylinder`/`sphere` it bakes nothing and returns an empty `filename` plus
a `note`. Such trivial parts need no mesh — assemble them in Phase 2 with `g_box`
/ `g_cylinder` / `g_sphere` directly.

### Phase 2 — Reference meshes to assemble (rewrite a clean lightweight DSL)

Start a **fresh, clean geometry DSL** — do **not** reuse Phase-1 subgraphs. For
each part:

- **non-trivial part** → `g_mesh(filename = the <sha>.obj staged in Phase 1)`
  (wire `g_bake_part.filename` straight into `g_mesh.filename`, or paste the
  literal). 
- **trivial primitive part** → `g_box` / `g_cylinder` / `g_sphere` directly.
- wrap each shape with `g_part`.
- **color each part with `g_material` / `g_named_color`** — color rides on the
  URDF `<material>` on the link, it does **not** go into the mesh.
- **articulated assembly** → connect parts with `g_joint_*` into a **single rooted
  tree** (routes through the URDF pipeline), using the spec's `parent` field for the
  tree shape. **A single static object with no moving joints** needs no `g_joint_*` —
  a jointless DSL routes through the STATIC pipeline (`g_to_scene`, exported as a
  single merged `.glb` via `mode="static"`).
- **joint origins are a subtraction, not a guess.** With `c_local = (bbox_min +
  bbox_max) / 2` from that part's bake receipt:
  `joint.origin = child.place.center − parent.place.center`
  (if the parent has a non-zero `rpy`, apply its inverse rotation to that difference
  first). Where the relation is really "coaxial" or "flush against this face", keep
  using `g_align_centers` / `g_place_on_face` / `g_place_on_surface` — they express
  the intent and survive a part being re-baked at a different size.
- optionally `g_auto_collision` (URDF path only; a mesh visual gets an AABB collision).
- submit `model.apply({ source })`. The compiler auto-appends the QC terminal plus the
  content-selected terminal (URDF `g_to_urdf` when joints are present, else static
  `g_to_scene`); judge completion from the receipt signals (see
  [quickstart.md](../quickstart.md#iteration-loop)).

If the assembled object is wrong, only adjust **joints / placement / color** in
Phase 2 — do **not** reach back into a part's internals. To change a part's
geometry, re-model and re-bake that single part in Phase 1.

**Material decision (PART A default):** the per-part stage format is **OBJ (pure
geometry)**; `g_bake_part` bakes geometry only and color is applied in Phase 2 by
`g_material` on the link. This keeps geometry deduped and lets you recolor per
instance.

> **Alternative — one reusable colored asset:** if this object will be **placed into
> scenes as a fixed-palette unit** (and has no moving joints), you can instead skip
> the per-part OBJ staging and bake the whole colored object into a **single
> multi-material `<sha>.glb`** with **`g_bake_object`**: build all parts with their
> real shapes + `g_material` in one graph, then `g_bake_object`. Scenes reference it
> once via `g_mesh(filename=<sha>.glb)` with **no link material**. See
> [PART C · route A](part-c-scene-assembly.md). Trade-off: color is baked in, so the
> `.glb` is not recolorable per instance and same-shape/different-color does not
> dedup. Use the OBJ + Phase-2 `g_material` route when you need per-instance recolor.

**Phase-2 efficiency check:** because Phase 2 is all native `g_mesh` references,
`g_to_urdf` should report `bakeFallbacks = 0`, `report.meshFileCount = 0`, and
`stats.meshProvenance` all `native` — it does **not** re-bake; the meshes were
already staged in `library/blobs/` during Phase 1.

### Forbidden anti-pattern

A single mega-model that heaps the entire object's shapes, parts and joints into
one DSL. It always degrades into primitive stacking and under-modeled parts.
Phase 1 (per-part bake) and Phase 2 (mesh references → assembly) are mandatory
and separate.

## Modeling Decisions

- Prefer semantic ops (Architecture, CSG) over stacked primitives; route with the
  table in [battery-catalog.md](../battery-catalog.md). Op signatures come from
  the [core](../op-directory/core.md) op-directory shard — never guess, never call
  `batteries.list` / `batteries.get`.
- **Two-phase for any non-trivial object**: Phase 1 bakes each part to a
  `<sha>.obj` (one `model.apply({bake})` per part), Phase 2 references them with
  `mesh` and assembles in one `model.apply`. Keep units in meters, Z-up.
- Judge completion from the receipt signals (`errors` / `qc` / `meshQc` / `urdf`)
  **and** from whether every part still matches its spec entry. A clean receipt on
  an object that doesn't match the spec is not done.

## References

- [build-spec.md](../build-spec.md): the Phase-0 spec schema, self-check list, and
  the placement formulas Phase 2 runs on.
- [dsl-quickref.md](../dsl-quickref.md): DSL grammar + a minimal runnable example.
- op-directory shards used by PART A: [core](../op-directory/core.md) ·
  [assembly-misc](../op-directory/assembly-misc.md) — the authoritative op signatures (SSOT);
  full family index at [op-directory.md](../op-directory.md).
