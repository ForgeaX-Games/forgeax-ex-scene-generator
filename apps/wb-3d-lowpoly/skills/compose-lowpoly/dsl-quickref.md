# Geometry DSL — syntax quick reference

The DSL is the single source of truth. You submit the full text via
`lowpoly:model.apply({ source })`; the backend compiles it to a graph, executes,
bakes, and runs QC in one call. **Never** hand-wire nodes/edges.

## Grammar

One statement per line: `id = op(arg=value, arg=value, ...)`

- **id** — unique, SSA (assign once). Referenced later by name.
- **op** — an operation name from `op-directory.md` (the full signature SSOT).
- **args** — `name=value` pairs; order-free. Omitted optional args take defaults.
- `#` starts a comment to end of line. Blank lines are ignored.

## Value kinds

| kind   | example                       | notes                                   |
|--------|-------------------------------|-----------------------------------------|
| number | `0.12`, `-3`, `3e2`           | meters / radians / degrees per param    |
| string | `"revolute"`, `"a.obj"`       | double quotes                           |
| bool   | `true`, `false`               |                                         |
| list   | `[0.2, 0.4, 0.8]`, `[[0,0],[1,0]]`, `[p1, p2, p3]` | vectors, nested lists, **or a list of refs** |
| ref    | `base`, `p_body`              | a bare id referencing a prior statement |

A **ref** wires geometry together: `part(shape=base)` means this part uses the
shape produced by the statement `base`. Refs must point to an **earlier** line.

A **list of refs** feeds multi-input ops: `loft(profiles=[p1, p2, p3])` lofts the
three earlier `profile_*` statements (in order). Use the plain `[a, b, c]` list
syntax with bare ids — no quotes, no special delimiter. Same for
`extrude_with_holes(outer=o, holes=[h1, h2])`.

## Minimal example (a hinged lid)

```
mat    = material(rgba=[0.6, 0.4, 0.2, 1])
body   = box(size=[0.6, 0.4, 0.8])
cavity = box(size=[0.55, 0.38, 0.7])
shell  = difference(base=body, tool=cavity)   # hollow the box
p_body = part(shape=shell, material=mat)
lid    = box(size=[0.6, 0.02, 0.75])
p_lid  = part(shape=lid, material=mat, origin=[0, 0.21, 0])
hinge  = joint(type="revolute", parent=p_body, child=p_lid,
               axis=[0, 0, 1], origin=[0.3, 0.2, 0], lower=0, upper=1.57)
```

Submit the whole block with `model.apply`. The receipt tells you, per DSL line,
any parse/validate errors, QC signals (islands, overlaps, orphan profiles, joint
placement), mesh-aware interpenetration (with concrete translation deltas to fix
it), and the URDF fingerprint. Fix the flagged lines and re-apply.

## Character rig example (soft-body skinning — see PART D)

角色 / 生物走**角色路**：和机械一样逐件建模 + bake，组装时**不用 `joint`，改由你亲手写
`bone`/`skeleton`** 建骨架（父子按解剖定），再加**一行 `skin(method="auto")` 自动蒙皮**。
DSL 里出现 `bone`/`skeleton`/`skin` 之一即触发角色路（终端链 `g_skin_qc → g_bake_object →
g_to_rig → rig_preview`，权重由前端测地体素绑定按需求解）。

```
# 组装阶段：引用 Phase 1 烘好的 mesh，自己写骨架（脊柱为根，头/尾各自挂脊柱）
mbody   = mesh(filename="<sha_body>.obj")
p_body  = part(shape=mbody)
mhead   = mesh(filename="<sha_head>.obj")
p_head  = part(shape=mhead, origin=[0, 0, 0.42])
mtail   = mesh(filename="<sha_tail>.obj")
p_tail  = part(shape=mtail, origin=[0, 0, -0.4])
b_spine = bone(origin=[0, 0, 0.05], tail=[0, 0, 0.3],  source_part=p_body)
b_head  = bone(origin=[0, 0, 0.3],  tail=[0, 0, 0.5],  parent=b_spine, source_part=p_head)
# axis=弯曲铰链（会动的骨必写）：尾巴左右甩用 [0,0,1]；行走腿用 [0,1,0]
b_tail  = bone(origin=[0, 0, -0.2], tail=[0, 0, -0.5], axis=[0, 0, 1], parent=b_spine, source_part=p_tail)
sk      = skeleton(root=b_spine)
skn     = skin(skeleton=sk, method="auto")     # 唯一自动的一步：权重前端求
# 骨骼动画：通道键 = 骨骼名，值 = 绕该骨 axis 的弧度
wag     = animation(fps=30, loop=true,
                    keyframes="{\"b_tail\":[{\"t\":0,\"q\":0},{\"t\":0.5,\"q\":0.6},{\"t\":1,\"q\":0}]}")
# 根运动（可与 keyframes 同时用）：模型根帧 X 向前、Z 向上；米制 bind-relative 位移
jump    = animation(fps=30, duration=1, loop=false,
                    root_motion="[{\"t\":0,\"x\":0,\"y\":0,\"z\":0},{\"t\":0.5,\"x\":0.2,\"y\":0,\"z\":0.8},{\"t\":1,\"x\":0.5,\"y\":0,\"z\":0}]")
```

骨架的父子**你按解剖写**（四肢挂中轴骨，绝不腿挂腿）。**弯曲轴写在 `bone(axis=…)`，别靠启发式。**
导出：`export-glb({ mode: "character" })`。**别在同一文件里混 `joint` 和 `skin`/`skeleton`**（报混合模型错）。

## Rules of thumb

- **Only once you write a `joint`** must the model be one **rooted** tree: from
  then on every `part` has to reach the root via `joint`s (else it's a floating
  link, dropped at URDF time). A jointless model (building, static scene) has no
  tree to satisfy — each `part` just carries its own absolute `origin`/`rpy`, and
  poses that only make sense relative to a parent use `place_local`, which flattens
  them at compile time without creating a joint.
- A `profile_*` (2D sketch) is not a solid — it must be consumed by
  `extrude` / `loft` / `revolve` (a lone profile bakes to a ~2mm slab).
- `revolve` reads profile points as `(r, z)` — author a dedicated r,z
  profile with all `r >= 0`, not an origin-centered XY rect/circle.
- Prefer rich ops (architecture, CSG) over stacking bare primitives.
- To assemble already-baked meshes, reference them by name from
  `lowpoly:parts.list`: `m = mesh(filename="<sha>.obj")`.
- **角色 ≠ 机械**：要连续表皮平滑弯曲用角色路（组装写 `bone`/`skeleton` + 一行 `skin(method="auto")`，
  见 PART D）；刚性零件绕轴转用 `joint`。两者不可同文件混用。骨架父子**手写按解剖**，不用启发式猜。
- **动作看载体不看词**：**会走 / 会跑 / 会游的动物是角色路**，运动用 `animation`（通道键=骨骼名）；
  只有机械件（门、齿轮、机械臂、走路机器人）的运动才用关节动画（通道键=关节名）。别因「要走路」连 `joint`。

See `op-directory.md` for the complete, auto-generated list of op signatures.
