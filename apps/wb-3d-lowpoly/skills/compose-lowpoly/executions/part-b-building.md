# PART B · 建筑（Architecture 家族）

> [SKILL.md](../SKILL.md) 路由到此。本文件是 **PART B** 的完整执行步骤。
> 授权参考只需两份：DSL 语法 [dsl-quickref.md](../dsl-quickref.md)、op 签名——
> [architecture](../op-directory/architecture.md)（墙/楼板/楼梯/屋顶/窗/门/栏杆/柱）+
> [core](../op-directory/core.md)（Primitive/CSG——补细节，或外形复杂/异形时直接建主体）+
> [assembly-misc](../op-directory/assembly-misc.md)（`part`/`joint`/`material`…），见
> [op-directory.md](../op-directory.md) 索引。选型拿不准再查 [battery-catalog.md](../battery-catalog.md)
> 的路由表——按需，别一次全读。

> **DSL-first（唯一流程）**：只写 DSL、用 `lowpoly:model.apply({ source })` 提交。逐条
> 写 Architecture op（`wall`/`floor_slab`/`stairs`/`roof`/`window`/`door`/`railing`/`column`），各自
> `part(...)` 包壳，**直接把想要的世界坐标写进 `part` 的 `origin`/`rpy`**；只有位置必须相对
> 父件表达的那三类（窗嵌墙洞、门框嵌墙洞、门扇挂门框）用 `place_local` 摆。**不写 `joint`** ——
> 整栋走静态路，一次 `model.apply` 跑完（编译器自动追加 QC → 合并烘焙 → 场景终端）。语法见
> [dsl-quickref.md](../dsl-quickref.md)，op 签名见 [architecture](../op-directory/architecture.md) 分片。
> **完成门禁 = 回执干净。**
>
> **例外**：要做**真正可开合**的门/窗扇才写 `joint(type="revolute")`。一旦出现任何 `joint`，
> 整栋楼就改走 URDF 路（此时所有构件都要 `joint` 连成单根树）。两套写法**不要混用**。

适用：房屋 / 建筑 / 房间 / 多层壳体 / 室内布局，或栏杆、护栏、柱这类建筑构件——而不是单个
机械件（机械件走 [PART A](part-a-asset.md)）。

就是做**正常的建筑**：像真实房子一样有墙、有梁柱、有楼板、有坡顶或平顶、门窗开在墙上、
楼梯连通楼层。不追求规范审查级别的精确，但也不要糊成一个空心方盒子——用 Architecture 家族
的语义电池把墙的开洞、楼板的梯井、屋顶的坡度、门窗的框扇都做出来。

需求特征先路由：开口墙→`wall`，楼板/洞口→`floor_slab`，坡/女儿墙屋面→`roof`，台阶/平台→`stairs`，
门窗/栏杆/柱用同名 Architecture op；梁没有专用电池——周圈边梁用 `floor_slab(beam_depth,beam_width)`、
单根梁/内部梁格用 `box(size=[跨度,梁宽,梁高])` 摆到柱顶标高。Architecture 电池是**规则直纹造型**
（直墙、平/坡屋面、矩形楼板）的推荐首选，但不是唯一解——外形本身带倒角、圆角、曲面、异形轮廓
（弧墙、曲面/穹顶屋面、非矩形平面、渐变截面塔身）时，直接用 Profile→CSG 建主体往往比硬凑
Architecture 参数更贴近真实效果，见下方 §1.5。**一切以最终效果为准**，哪个部件适合哪种电池就用
哪种，不必整栋二选一。构件贴楼板、墙面或柱面时优先 Placement DSL。同一问题最多修 3 次。

---

Architecture-flavoured sibling of [PART A](part-a-asset.md): **same DSL-first flow
and completion gate**, what changes is the **modeling philosophy** — for buildings
the semantic `wall` / `floor_slab` / `stairs` / `roof` / `window` / `door` /
`railing` / `column` ops are the **default**, not bare `box`. A building = many
element shapes, each `part(...)`-wrapped and given its **absolute** `origin`/`rpy`;
the handful of poses that only make sense relative to a parent (window in a wall
opening, frame in a wall opening, leaf on a frame) go through `place_local`, which
composes them into absolute poses at compile time. No joints — same authoring style
as PART C scene assembly. Meters, Z up.

## Modeling Philosophy

> **Recommended default, not an exclusive gate.** The catalog ships an
> **Architecture** family because for buildings with a regular, orthogonal shell
> these ops are usually the *better* choice than raw `g_box` slabs: walls have
> door/window openings, slabs have stair wells, roofs are pitched, windows have
> frames and mullions — all of which the semantic ops express directly. Reach for
> them first for a normal building. But the actual goal is **the closest visual
> result, not compliance with a fixed battery list** — when the building's real
> form is complex (chamfered/rounded corners, curved or arced walls, a curved/
> free-form/domed roof, a non-rectangular footprint, a tapering or organic massing),
> Profile → CSG (`extrude` / `loft` / `revolve` / `sweep` / `fillet` / `difference`)
> is often the *more suitable* tool for modeling that part of the shell — not
> restricted to small decorative add-ons, see §1.5 below. Using a plain box to
> rough something in is also **not an error** and won't fail QC; just pick whichever
> op actually reproduces the intended shape — **一切以效果为准**.

### 1. Prefer Architecture ops for regular shells (strong recommendation, not exclusive)

These are the recommended op for each element when the shell is basically
rectilinear/pitched — they beat boxes specifically on openings, pitched/complex
roofs, and stair wells:

- A wall (with or without a door/window hole) → **`g_wall`** — its `openings`
  list cuts the holes for you, instead of faking a window by laying smaller
  boxes on top.
- A floor / ceiling / landing, with or without a stair/shaft well → **`g_floor_slab`**
  (`holes`) rather than a flat box you then have to cut by hand.
- Stairs / steps → **`g_stairs`** (`type=straight` or `spiral`) rather than a
  stack of boxes.
- A pitched / hipped / shed / flat / gambrel / mansard / pyramid roof → **`g_roof`**
  rather than a wedge faked from primitives.
- A window (frame + `cross` / `grid` / `louver`) → **`g_window`**; a door (frame +
  one or two **separate** leaves, `flush` / `panel` / `glazed`) → **`g_door`**.
- Exterior cladding / siding → **`g_facade_panel`**.
- A railing / guardrail / handrail / balustrade → **`g_railing`**.
- A column / pillar / post → **`g_column`** (`round` / `square`, optional base &
  capital).

> Soft hint: if you do rough a feature in with a `g_box` (e.g. a placeholder
> mass), that's acceptable — just note it and upgrade to the Architecture op when
> the opening / pitch / well becomes relevant. No redo is forced.

### 1.5 外形复杂/异形时，主体也直接用 CSG（不止是补细节）

Architecture 电池的墙/板/顶假设的是**直墙、平/单坡面、矩形或简单折线平面**——参数
（`length`/`thickness`/`height`、`openings`、`type=gable|hip|...`）只覆盖这类规则形状。
一旦建筑本身的外形超出这个假设，比如：

- 墙体/立面本身带**倒角、圆角转角**，或整段是弧形/曲面（弧墙、筒拱立面）；
- **曲面或穹顶屋面**（穹顶、鞍形曲面、自由曲面），而不是规则的坡/攒尖/曼萨德/歇山；
- 楼板/平面是**非矩形轮廓**（多边形带圆角、弧边、异形转角）；
- 整体是**渐变/异形体量**（收分的塔身、斜切体块、有机造型的立面段）；

——这些情况下硬把 `wall`/`floor_slab`/`roof` 的参数拗成近似形状，效果通常不如直接用
Profile→CSG 建主体：`profile_rounded_rect`/`profile_polygon` 定义带倒角的平面轮廓再
`extrude`，`loft` 做渐变截面的塔身/收分立面，`revolve` 做穹顶/回转屋面，`sweep` 沿曲线
放样弧形线脚/断面，`fillet` 给直棱边整体倒角/圆角，`difference` 在曲面主体上整体开洞
（而不是用 `wall.openings` 那种直墙洞口逻辑）。做出来的 CSG 主体照样 `part(...)` 包壳、
写绝对 `origin`/`rpy`，和普通 Architecture 构件一样接受 R5 的 QC/对齐检查；同一栋楼里
规则部分继续走 Architecture、异形部分走 CSG 完全正常——**哪个部件适合哪种电池就用哪种，
不必整栋二选一，一切以最终效果为准**。

### 1.6 用别的家族丰富细节（鼓励，不止 9 个 Architecture 电池）

Architecture 家族只是**外壳与主结构**的首选，**不是唯一可用的电池**。一栋只有墙/板/
顶/门窗的房子会很空——主动混用其它家族把细节做足，让成品更丰富可信：

- **Primitive**（`g_box`/`g_cylinder`/`g_sphere`/`g_cone`/…）：烟囱、女儿墙压顶、窗台
  花箱、雨棚、门槛、台阶踏步、灯柱、屋顶水箱、简单家具体块。
- **CSG**（`g_difference`/`g_extrude`/`g_revolve`/`g_loft`/…）：任何 Architecture 电池
  参数覆盖不到的异形——凸窗、老虎窗、拱廊、装饰线脚、掏空的壁龛、异形阳台板、门把手/
  灯具环圈（`g_revolve` 回转体）、通风口/百叶（`g_difference` 在面板上开一排孔/条缝）、
  装饰圆窗（`g_extrude` 一个圆 profile）。
- **Architecture 里的配件电池**别忘了用：`g_column`（柱廊/门廊/雨棚支柱）、
  `g_railing`（阳台/露台/楼梯/女儿墙护栏）、`g_facade_panel`（外墙挂板/板缝质感）。
- **Transform**（`g_array_linear`/`g_array_radial`）：把一个窗/柱/栏杆条**阵列**成一排，
  别手动复制几十遍。
- **Material**（`g_material`/`g_named_color`）：给墙、屋顶、门窗、木作分别上色，颜色对比
  是低模"看起来完成度高"的关键——别整栋一个灰。

原则不变：**规则形状能用语义电池（含 Architecture 的开洞/坡顶/梯井）就用**（见 §1），
语义电池表达不了的细节大胆用 Primitive/CSG 补；而当**主体本身**就是异形/曲面/带倒角
（§1.5 那几类），CSG 直接顶替 Architecture 电池建主体也是对的选择——不必勉强凑语义参数。
所有补充件或 CSG 主体同样 `g_part` 包壳、写自己的绝对 `origin`，并遵守下方对齐配方的规则。

### 2. Compose a building by hand from the element ops

There is **no whole-building orchestrator** — build the shell explicitly from the
Architecture element ops and place each one yourself:

- Emit each element with its own op: floors/landings → `g_floor_slab` (with
  `holes` for stair wells), walls → `g_wall` (with `openings` for door/window
  holes), stairs → `g_stairs`, roof → `g_roof`, plus `g_window` / `g_door` /
  `g_railing` / `g_column` as needed.
- Wrap each element shape in a `g_part` and give that part its **absolute**
  `origin`/`rpy` (meters, Z up): a wall standing on a slab gets
  `origin=[cx, cy, slabTopZ]`; a wall running along Y also gets `rpy=[0,0,π/2]`.
  Stack floors by `origin=[0, 0, floorIndex*storeyH]`. The formula is in
  [the placement recipes](#对齐配方--placement-recipes对不上就是这里没做对) below.
- For the three poses that can only be stated relative to a parent — window in a
  wall opening, door frame in a wall opening, door leaf on its frame — use
  `place_local(parent=…, child=…, offset=[…])`. It composes parent pose ∘ offset
  at compile time and writes the result back as the child's absolute pose, so
  everything downstream still sees a flat list of placed parts.
- **Do not emit `joint`** unless a leaf must actually open (see the note at the
  top of this file). A jointless building compiles down the static path into a
  single multi-material GLB.

### 3. 动手前想清楚这几件事（口头过一遍即可，不必写成结构化 JSON）

- **体量与规模**：整体 `w × d × h`（米）、层数、层高。
- **平面布局**：自己列出房间矩形 / 墙的中心线（相对建筑中心的坐标）。**共享内墙要去重**——
  相邻两个房间别在公共边上各画一道墙。
- **交通**：楼梯 / 电梯放在哪里，连通哪几层。
- **开洞**：每面墙上的门窗洞 `[x, width, sill, head]`。
- **屋顶**：`flat` / `shed` / `gable` / `hip` / `gambrel` / `mansard` / `pyramid` 之一，
  脊高、出檐；平屋顶记得给女儿墙（`parapet_height`）。
- **细节构件**：临空的阳台 / 露台 / 敞开楼梯边用 `g_railing` 兜住；门廊 / 柱廊用 `g_column`。

尺寸没概念就抄这份速查（不是硬性规范，落进区间即可）：

| 项目 | 参考值 |
|---|---|
| 层高 | 住宅/别墅 2.8–3.3 m；写字楼 3.6–4.2 m |
| 柱距 / 开间 | 住宅/别墅 4–7 m；写字楼 6–9 m |
| 门 | 宽 0.8–1.0 m（主入口 ≥ 1.2 m）× 高 2.0–2.4 m |
| 窗 | 窗台高 ~0.9 m，窗高 1.2–2.1 m |
| 楼梯踏步 | 踏高 0.15–0.18 m，踏宽 0.26–0.30 m |
| 护栏高 | ≥ 0.9–1.1 m |
| 墙 / 板厚 | 全楼统一一个值即可，常见 0.2 m |

搭建顺序按常识来就行：先楼板/地面，再立柱/砌墙，再留门窗洞，最后封顶/装栏杆——大致
自下而上、逐层往上搭，不用逐字套一个固定七步模板，但**上层构件要落在下层对应构件上**，
别悬空。

### 4. 一次提交，然后读 QC

Submit one `model.apply({ source })` — the compiler auto-appends the static
terminal chain (QC → `g_bake_object` merges every real-shape part into one
multi-material GLB → `g_to_scene` → preview). Read the QC signals: on the
jointless static path the meaningful ones are `overlaps`（穿模）和 `missing_aabb`，
而 `islands` / `floating_links` **不适用**（没有 joint 树可言）——悬空构件、错位的
门窗、缺失的楼板这些 QC 查不出来，靠下面的[对齐配方](#对齐配方--placement-recipes对不上就是这里没做对)
自己核对。

要 `<collision>` 或可动关节时才回到 URDF 路（整栋补 `joint`，终端换成 `g_to_urdf`）。

**回执干净只是第一道门。** QC 查的是图的连通性和 AABB 互穿，它**查不出**悬浮的楼板、
通往虚空的门、错位的窗——这些要你自己对着成品过一遍常识：楼板接住了所有的墙和柱吗？
每层都有地板吗？门窗和墙上的洞对上了吗？楼梯两头都落在实处吗？

## Element quick reference

| Want | Op | Key params |
|---|---|---|
| straight wall + holes | `g_wall` | `length` `height` `thickness` `openings=[[x,w,sill,head]]` · opt `window_band`+`band_sill`/`band_head`/`band_margin`/`pane_width`/`mullion`, `plinth_height`/`plinth_projection` |
| slab + wells | `g_floor_slab` | `width` `depth` `thickness` `holes=[[x,y,w,d]]` · opt `beam_depth`/`beam_width`, `edge_chamfer` |
| stair flight | `g_stairs` | `total_rise` `run` `width` `step_count` `type=straight\|spiral` (`radius` `inner_radius` `sweep_deg`) · opt `tread_thickness`, `open_riser`, `landing_depth`/`landing_after` |
| roof | `g_roof` | `width` `depth` `type=flat\|shed\|gable\|hip\|gambrel\|mansard\|pyramid` `height` `overhang` · opt `eave_overhang`/`verge_overhang`, `parapet_height`/`parapet_thickness`/`coping_width` |
| siding | `g_facade_panel` | `panel_w` `panel_h` `thickness` `orientation=wall\|slab` `groove_count` · opt `groove_direction=horizontal\|vertical\|both`, `groove_spacing`, `board_style=flush\|lap\|shiplap` |
| window | `g_window` | `width` `height` `depth` `frame` `type=cross\|grid\|louver` `rows` `cols` `glass` · opt `pane_width`, `sill`, `arch_top` |
| door (frame + leaf/leaves) | `g_door` | `width` `height` `depth` `hinge` `leaves=1\|2` `style=flush\|panel\|glazed` `openable` · opt `panel_rows`/`panel_cols`, `transom`, `sidelight` |
| railing / balustrade | `g_railing` | `length` `height` `baluster_count` `post_size` `rail_height` · opt `post_shape=round\|square`/`post_radius`, `post_spacing`, `bottom_rail`/`mid_rail`, `top_rail_width`/`top_rail_height` |
| column / pillar | `g_column` | `height` `radius` `shape=round\|square` `base_height` `capital_height` · opt `taper`, `base_style`/`capital_style=plain\|stepped`, `flutes` (round) |
| **beam（无专用电池）** | 周圈边梁 `g_floor_slab` · 单根梁 `g_box` | 板底四周一圈下沉梁环用 `beam_depth`+`beam_width`（**只有外圈，没有内部梁格**）；内部梁 / 单根梁用 `g_box(size=[跨度, 梁宽, 梁高])` 摆到柱顶标高 |
| **重复的标准层**（可选，省事用） | **`g_storey_stack`** | `parts=[本层全部 part]` `count=总层数` `storey_height` · opt `root`（缺省=本层子树的根）、`levels=[…]`（各层标高不等距时用）、`prefix`、`mode`（缺省 `merge`=整层烘成一张 GLB、每层只剩 1 个 part）。高层住宅/写字楼中间层完全重复时才用它省得手写 N 遍；不重复的楼层照常各写各的 |
| assemble the shell | `g_part` (+ `g_place_local`) | wrap each element and give it its absolute `origin`/`rpy`; only window-in-wall / frame-in-wall / leaf-on-frame go through `place_local(parent, child, offset)` |

Confirm exact param names/defaults in [architecture](../op-directory/architecture.md) before wiring;
the family/routing table is in [battery-catalog.md](../battery-catalog.md).

## 对齐配方 · Placement recipes（对不上就是这里没做对）

> 所有元素 shape 都是 **X、Y 居中、底面 Z=0**（`g_roof` footprint 居中）——
> **`g_stairs` 是唯一的例外**，见下方⚠️。装配错位不是电池的几何算错，而是下面这套
> 坐标契约没照做。单位=米，Z 上。
>
> **摆位的通用算法**：`part.origin = 目标位置 − 该 shape 的局部 AABB 中心`。
> 局部中心恒为 `[0, 0, h/2]`（X/Y 居中、底面 Z=0），而建筑里的 `rpy` 只有绕 Z 的偏航、
> 转不动 Z 轴上的点，所以实际就是：
>
> ```
> part.origin = [目标x, 目标y, 目标z − h/2]
> ```
>
> —— 也就是"**减自己的高度一半**"。沿 Y 走向的墙照旧加 `rpy=[0, 0, 1.5707963268]`。
>
> ⚠️ **`g_stairs` 的局部原点是"第一级起步点"，不是几何中心**：底面 Z=0、Y 方向居中
> （`[-width/2, width/2]`），但 **X 方向从 0 起步向 +X 递增**，局部 AABB 中心是
> `[totalRunX/2, 0, total_rise/2]` 而不是 `[0, 0, total_rise/2]`
> （`totalRunX ≈ run × step_count`，有 `landing_depth` 时替换其中一级、不是叠加）。
> 通用公式对楼梯不成立——直接套用会把楼梯在 X 方向多偏移半个梯段长度，是
> "楼梯错位 / 楼梯和梯井对不上"最常见的根因（另一半原因见下方 R4：`run` 参数本身
> 填错）。楼梯要么改用 `place_local` 相对楼梯井定位，要么手算：
>
> ```
> part.origin = [目标x − totalRunX/2, 目标y, 目标z]
> ```
>
> 只有位置**本来就只能相对父件表达**的三类（R1 的窗、R2 的门框与门扇）才用
> `place_local`，其 `offset` 就是洞口在墙局部帧里的坐标。下面 R1–R4 是几个高频关系
> 的现成配方，直接用配方比套通式更不容易错。

### R1 · 洞口 ↔ 窗/门（"墙上的洞和窗对不上"的根因）

`g_wall` 切洞（`openings`）和 `g_window`/`g_door` 是**两个独立 shape**——你必须把窗/门
摆进洞里，它们不会自动对齐。规则：

- 每个洞口 `[x, width, sill, head]` 对应的配套窗：`width=width`、
  **`height = head − sill`**（不是 head）、`depth = 墙的 thickness`。
- **把窗/门 part 以"这面墙"为父**摆：`place_local(parent=p_墙, child=p_窗,
  offset=[x, 0, sill])`（窗底在 Z=0 → 对 `sill`，不是 `(sill+head)/2`）。
- **为什么必须以墙为父**：这样洞口的 `x`/`sill` 直接就是 `offset`。若改成给窗 part 自己
  写世界 origin，你得手动把墙的平移**和旋转**套进去——**沿 Y 方向的墙（`rpy=[0,0,π/2]`）
  几乎必然算错**，这就是"洞和窗经常对不上"的头号原因。`place_local` 就是替你做这一步
  复合：它按墙的 `origin`/`rpy` 把 `offset` 转到世界帧，结果直接写回窗 part。
- 窗还会**继承墙的朝向**（`place_local` 同时复合 `rpy`），所以沿 Y 的墙上的窗自动转正，
  不用另写 `rpy`。
- 偷懒法：`g_wall` 现在直接返回 **`opening_placements`**（JSON 数组，每项
  `{origin:[x,0,sill], width, height, depth}`）；把 `origin` 照抄进 `offset` 即可，
  别自己重算。

```
w_e   = wall(length=6, height=3, thickness=0.2, openings=[[-1, 1.2, 0.9, 2.3]])
p_w_e = part(shape=w_e, material=m_wall, origin=[3.9, 0, 0.2], rpy=[0, 0, 1.5707963268])
win   = window(size=[1.2, 1.4], depth=0.2)     # height = 2.3 − 0.9
p_win = part(shape=win, material=m_trim)
mount = place_local(parent=p_w_e, child=p_win, offset=[-1, 0, 0.9])   # 洞口的 [x, 0, sill]
```

### R2 · 门框 + 门扇（"门建模有问题"的根因）

`g_door` 出**门框 `door_frame` + 独立门扇 `door_leaf`**两条 shape。关键陷阱：
**门扇的局部原点在铰链边、不在几何中心**（`hinge=left` → 扇占局部 X∈[0,leafW]、
转轴在 X=0）。所以：

- 门框：以墙为父，`place_local(parent=p_墙, child=p_框, offset=[x, 0, 0])`（用 R1 里门洞的 `x`）。
- 门扇：**不要**和门框同心摆，否则会整体偏移半扇、戳出框外。以**门框**为父再摆一次：
  `place_local(parent=p_框, child=p_扇, offset=<g_door 返回的 leaf_origin>)`（单扇
  `[∓clearW/2,0,0]`、双扇分置两门挺）。链式没有额外代价——DSL 前向可见，第二跳读到的
  已经是门框复合完的世界位姿。
- **门扇要能开**才写 `joint(type="revolute", parent=p_框, child=p_扇, axis=[0,0,1],
  origin=<leaf_origin>)`；那样整栋楼回到 URDF 路，**其余构件也全部要用 `joint` 连成
  单根树**。只要门是装饰性的（绝大多数低模建筑），就用 `place_local`。

### R3 · 楼板（"地板大小不对 & 二楼缺地板"的根因）

- **尺寸对齐墙壁围合的范围**：`g_floor_slab` 默认 `6×4`，必须显式把 `width`/`depth` 设成
  这一层墙体围出来的实际 footprint，别用默认值，也别让楼板比墙小一圈或大出一截。
- **每一层楼面各要一块**：一层地面一块、**二层楼面一块**、三层一块……逐层堆叠就是给
  每块板的 part 写 `origin=[0, 0, i*storeyH]`。**屋顶不是楼面**——`g_roof` 不能顶替二层
  楼板。最常见的漏项就是"忘了给二层 emit 一块 `floor_slab`"。

### R4 · 楼梯 ↔ 楼梯井（"缺楼梯 / 楼梯不通"、"楼梯撞墙/悬空"的根因）

跨层楼梯要三件套一起做，缺一件就"没有楼梯"或楼梯穿板：

1. `g_stairs` 的 `total_rise = storeyH`（一层楼高），part `origin=[sx, sy, i*storeyH]` ——
   `[sx,sy]` 落的是**第一级起步点**（楼梯局部原点，见上方⚠️），**不是**梯段的几何中心，
   也不是楼梯井中心。
2. **上层** `g_floor_slab` 在楼梯正上方开一个对齐的 `holes` 井
   `[[wx, wy, wellW, wellD]]`（井是**几何中心**，`wellW`/`wellD` 略大于梯段投影）。
   井中心 ≠ 起步点：`wx = sx + totalRunX/2`（若 `rpy` 转了 90°，把 X/Y 对应换过来）、
   `wy = sy`；**不能直接抄 `[sx,sy]`**，否则井会偏移半个梯段长度、和梯段对不上。
3. `run` 是**每一级**踏步的进深（米，通常 0.26–0.30），**不是**整段楼梯的水平总长
   `totalRunX`；`totalRunX ≈ run × step_count`（有 `landing_depth` 时替换其中一级：
   `totalRunX ≈ run × (step_count − 1) + landing_depth`）。反过来算：已知想要的
   `totalRunX` 和 `step_count`，应填 `run = totalRunX / step_count`，**不要把
   `totalRunX` 直接填进 `run`**——那会把每级踏步拉到几米宽，整段楼梯长出正常尺寸
   一个数量级（`step_count` 倍）。`total_rise`/`step_count` 决定踏高，落进 0.15–0.18 m
   的区间反推 `step_count = round(storeyH / 0.17)`，别自己拍。

### R5 · 别让结构重叠、也别让构件悬空

静态路上每个 part 的世界 AABB 就是它自己的 `origin`/`rpy` 摆出来的，**穿模/重叠检测照常
工作**——`g_geometry_qc` 第④步逐对比较兄弟 part：

- 兄弟 part 的 AABB 互穿 → **`note`**（静态路全是刚性摆位，没有相对运动），**不 fail `valid`**。
  低模建筑里"合理交叠"很多：墙在墙角/T 形接头按一个墙厚交叠、窗/门框嵌在墙平面里、门扇的
  AABB 落在门框 AABB 内、楼梯占着楼板的楼梯井……这些都是 AABB 保守估计的常态，**默认不算缺陷**。
- 只有走 URDF 路、且互穿的两个 part 之间路径上有非 fixed joint 时，才升级为 **`warning`
  供审查**（比如某扇门的转轴装反了，门扇休止位直接怼进自己的框）——视情况用 `allow_pairs`
  白名单或调整摆位。

**真正要消除的重叠**（这些是真缺陷，白名单不能盖）：共享内墙要**去重**（相邻两房间别
在公共边上各画一道墙）、别把两块 shape 叠在同一处、窗/门要**恰好填满**洞口而不是比洞
大一圈捅进墙体、楼梯别插进实心楼板（见 R4）。先用 `g_metrics` 读
`max_penetration`/`overlap_ratio` 判断是真穿模还是 AABB 保守误报。

**`islands` / `floating_link` 在静态路上不是信号**：没有 joint 树，每个 part 都会照自己的
绝对位姿进合并 GLB，**QC 查不出悬空的墙、浮在半空的柱**——这条要你自己核对：柱、墙、梁的
落点必须真的贴在下面那层楼板 / 梁 / 墙的顶面或侧面上，上层构件不能凭空落在楼板中间或悬在
边缘外。回执干净 ≠ 楼站得住。

## References

- [PART A · 资产 / 机械](part-a-asset.md): the shared DSL-first flow + QC loop.
- op-directory shards used by PART B: [architecture](../op-directory/architecture.md) ·
  [core](../op-directory/core.md) · [assembly-misc](../op-directory/assembly-misc.md) ·
  [dsl-quickref.md](../dsl-quickref.md): op signatures + DSL syntax (the authoring SSOTs);
  full family index at [op-directory.md](../op-directory.md).
- [battery-catalog.md](../battery-catalog.md): family list + routing table.
