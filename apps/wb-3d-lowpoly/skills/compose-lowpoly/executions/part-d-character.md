# PART D · 角色 / 生物（逐件建模 → bake → 组装时写骨架 → 自动蒙皮 → K 帧 → 导出）

> [SKILL.md](../SKILL.md) 路由到此。授权参考：DSL 语法 [dsl-quickref.md](../dsl-quickref.md)、
> op 签名——[core](../op-directory/core.md)（逐件建模用 Profile/CSG/Transform/primitive）+
> [rig-character](../op-directory/rig-character.md)（`bone`/`bone_chain`/`skeleton`/`skin`）+
> [assembly-misc](../op-directory/assembly-misc.md)（`part`/`animation`…），见
> [op-directory.md](../op-directory.md) 索引；**PART D 一般不需要** architecture 分片。

> **角色路 = 软体平滑蒙皮**（不是 URDF 刚性关节）。DSL 里出现 `skin` / `skeleton` / `bone` 即触发
> 角色路，后端自动追加终端链 **`g_skin_qc → g_bake_object → g_to_rig → rig_preview`**。前端切
> character 模式：合并网格 + **测地体素绑定**求每顶点 4 骨平滑权重，弯曲不裂。

适用：人 / 动物 / 怪物 / 吉祥物 / 布偶。机械装配（刚性分件绕轴转）走 [PART A](part-a-asset.md)。

> **和 PART A 是同一套：逐件建模 + bake 成 `<sha>.obj` → 引用组装。唯一区别 = 组装时写什么**：
> PART A 组装写 `joint`，PART D 组装**由你亲手写 `bone` / `skeleton` 建骨架**，外加一行
> `skin(method="auto")`。**骨架的父子关系你按解剖来定**——四肢各自挂中轴骨，绝不腿挂腿。
> **整套流程里只有蒙皮权重是自动的**（前端体素绑定），骨架不是。
>
> **最终一起 bake**：角色路终端的 `g_bake_object` 会**把你引用的各 `<sha>.obj` 回读、按 part
> 位姿合并成一张可蒙皮网格**（喂给 `g_to_rig`）。所以你**照 PART A 那样分件建、逐件 bake、再引用组装**
> 就行——不用把所有几何内联进一张图。每件先单独 bake 还能让你先验证每件形状再组装。

> ⚠️ **会走 / 会跑 / 会移动的动物也是角色路**：运动是**骨骼动画**（Phase 3，腿骨交替前后摆），
> 不是 `joint`。别因为需求出现「走 / 跑 / 动」就退回 PART A 连关节。
> **铁律**：同一 DSL 别混 `joint` 和 `skin` / `skeleton`（两条终端链互斥，报「混合模型」错）。

需求特征先路由：身体主轮廓用 profile/revolve/loft/capsule 起形，再用 CSG 做口鼻、眼窝、甲壳或服装层次；对称肢体独立 bake/实例化。组装位姿由 spec 的 `place.center` 减去 bake 回执的局部 bbox 中心算出，同轴/贴面关系仍用 `align_centers`/`place_on_face`，再按解剖写 bone。计划走 [build-spec.md](../build-spec.md) 的 JSON schema（D 变体用 `bone`/`bone_parent` 取代 `joint`）；同一缺陷最多 3 次，metrics 建议未清零不阻塞最好结果交付。

---

## Workflow — 逐件建模 → bake → 组装骨架 → 蒙皮 → K 帧 → 导出

`caller.kind = "ai"`。

1. **Set up.** `lowpoly:projects.*` 开 / 建项目。op 签名查 [core](../op-directory/core.md) /
   [rig-character](../op-directory/rig-character.md) / [assembly-misc](../op-directory/assembly-misc.md)。
2. **Phase 0 — build spec（硬门禁，schema 见 [build-spec.md](../build-spec.md)）.**
   把角色拆成解剖部件（头 / 躯干 / 上臂 / 前臂 / 大腿 / 小腿 / 尾…），每件一条 JSON、字段与通用 schema
   完全一致（`function` / `form` 2~3 句 / `ops` / `size` / `place` / `datum` / `features` / `material`），
   **D 变体把 `joint` 换成两个字段**：
   - **`bone`** —— 这个 part 对应哪根骨；
   - **`bone_parent`** —— 这根骨的父骨是谁，即解剖上它接到哪根骨（大腿骨的父是髋 / 脊柱骨，
     **不是另一条腿**）。根骨（脊柱 / 躯干）填 `null`。**这个字段就是你之后手写骨架的父子表，
     先在这里想清楚。**

   拆件粒度 = 你要的可弯关节数：每个要独立弯的部位至少一个 `part`（＝一根骨）。
   > **细节从这来**：角色细节和机械一样靠逐件真形状建模，不是糊几个球和胶囊。spec 写薄（"头=球、身=胶囊"）
   > → 建出来就是气球人。口鼻、耳、爪、甲、肌肉起伏、装备都要写进对应 part 的 `features`、Phase 1 建出来。
3. **Phase 1 — 逐件建模 + bake（完全同 PART A，一次一件）.** 每件写一小段 DSL，用 **CSG**
   （`difference` / `revolve` / `loft` / `fillet`…）做出真实细节，
   `model.apply({ source, bake: "<shape id>", expectedDims: part.size, features: part.features })`
   烘成 `<sha>.obj`，记下 sha + bbox，并看一眼回执 `advice.dimensionDelta` 是否偏离计划。反 primitive 纪律见
   [shared-conventions.md](../shared-conventions.md#anti-primitive-modeling-rules)（`capsule` / `sphere` 只是起手体块）。
4. **Phase 2 — 组装 + 写骨架（一段干净 DSL）.**
   - 每件 `mesh(filename="<sha>.obj")` → `part(origin=…, rpy=…)` 摆到位（同 PART A 组装，但**不写 `joint`**）。
     **origin 是算出来的**：`origin = place.center − c_local`，其中 `c_local = (bbox_min + bbox_max) / 2`
     取自该件 bake 回执。
   - **按 Phase-0 的父子表写骨架**，每根骨一行：
     `bone(origin=<head>, tail=<末端>, axis=<弯曲轴>, parent=<父骨 ref>, source_part=<part>)`。
     根骨不写 `parent`；父子怎么定见下方 [「怎么写骨架」](#怎么写骨架关键先建立正确心智模型)（绝不腿挂腿）。
     **`axis` 必写（会动的骨）**：模型根帧铰链方向——行走腿 `axis=[0,1,0]`（前后摆），尾巴左右甩
     `axis=[0,0,1]`。**别指望启发式推轴**（竖直腿缺省偶发横摆）。
   - **一条 mesh 想要多段可弯骨骼**（尾巴 / 蛇身 / 长鞭子这类"一整根连续 part 但想要多节平滑弯曲"的
     情况）：不必手写 N 行 `bone`，改用一行 **`bone_chain(origin=…, tail=…, count=N, parent=…,
     axis=…, source_part=…)`**——展开成 N 条首尾相接的标准 `bone` 语句，生成的骨骼 id 形如
     `<chainId>_0`、`<chainId>_1`……可直接被 `animation` 按骨骼名单独驱动。见下方
     [「多段肢体 / 尾巴 / 蛇身」](#多段肢体--尾巴--蛇身--bone_chain)。
   - `skeleton(root=<根骨>)` 声明根骨（其余经 `parent` 链隐式挂上）。
   - **一行 `skin(skeleton=<sk>, method="auto")`** —— 省略 `mesh` ＝对所有 part 合并网格自动蒙皮，
     权重前端求解。**这是整套里唯一自动的一步。** 默认偏硬（`falloff=4, max_influences=2`）以免动作
     扯软身子；仍太软可再加大 `falloff`，太硬关节裂可用 `falloff=2, max_influences=4`。
   - `model.apply({ source })`，读回执 `skinQc`。
5. **Phase 3 — 骨骼动画（按需，行走 / 奔跑 / 跳跃都在这步）.** 加
   `animation(fps=…, loop=…, keyframes=…, root_motion=…)`：**通道键 = 骨骼名（`bone` 那行的 DSL id）**，值 =
   **绕该骨 `axis` 的旋转弧度**（你在 Phase 2 写死的弯曲轴；未写 `axis` 才走启发式）。
   **行走 = 每条腿骨前后摆、左右腿相位相反**（脊柱可轻微起伏）。角色整体前进/腾空用
   `root_motion="[{\"t\":秒,\"x\":米,\"y\":米,\"z\":米},...]"`：模型根帧 **X 向前、Z 向上**，
   数值是相对根骨 bind position 的位移；它和骨骼关键帧共用 fps/duration/interpolation。
6. **Phase 4 — 导出.** `lowpoly:export-glb({ mode: "character", name })` —— 带骨架 + 平滑蒙皮 +
   骨骼动画的 `.glb`。

## 怎么写骨架（关键——先建立正确心智模型）

**核心心智：一个 part 对应一根或一条骨骼链，按你想要的可弯节数选——骨（或链）就“长”在这个 part 里、沿它的长轴走。**
单段肢体（大腿、上臂、头）一个 part 配一根 `bone` 就够；一整根连续 mesh 想要多节平滑弯曲
（尾巴 / 蛇身 / 长鞭子）就配一条 `bone_chain`（见下方
[「多段肢体 / 尾巴 / 蛇身」](#多段肢体--尾巴--蛇身--bone_chain)）——两者本质都是"长在这个
part 里的骨"，链只是把它拆成 N 段首尾相接的骨。

- **head（`origin`）= 该 part 连向身体的那端**（腿 → 髋 / 肩根部；头 → 脖子根；尾 → 尾根）。骨绕 head 转。
- **tail = 该 part 的自由端**（腿 → 脚；尾 → 尾尖；头 → 头顶）。head→tail 就是骨在这段肢体里的走向。
- **躯干那根骨是根骨**（脊柱），沿身体主轴；**四肢 / 头 / 尾的骨各自 `parent` 到躯干骨**。

所以「一个躯干 + 四条腿」的骨架 = **1 根脊柱骨（长在躯干里）+ 4 根腿骨（每条腿里各长一根）**，
四根腿骨的 `parent` **都是脊柱骨**。是的——**骨确实是长在四条腿上的**，每条腿一根，只是它们的
根端（head）都挂到躯干的脊柱骨上：

```
            b_spine  (根骨：head 在躯干后端，tail 指向前端，长在躯干里)
           /   |   \   \
   b_leg_fl b_leg_fr b_leg_bl b_leg_br   (四根腿骨：每根 head 在髋、tail 在脚，长在各自的腿里)
   (每根 parent = b_spine —— 挂到脊柱，不是挂到隔壁那条腿)
```

- **`parent` 按解剖、不按“谁离得近”**：腿骨的父是躯干 / 髋骨，不是另一条腿。左右对称的肢体
  （左右腿 / 左右臂）各自挂中轴骨，**彼此绝不互为父子**（“两条腿连一起”就是把 parent 写错成隔壁腿）。
- **多段肢体**：若一条腿拆成大腿 + 小腿两件（两个 part），则大腿骨 `parent` 躯干、小腿骨 `parent`
  大腿骨（一条链）。若肢体是**一整件连续 mesh**（一个 part）只是想多节平滑弯曲（尾巴 / 蛇身），
  用 `bone_chain` 代替手写多根 `bone`，见 [「多段肢体 / 尾巴 / 蛇身」](#多段肢体--尾巴--蛇身--bone_chain)。
- **弯曲轴 `axis`（作者自定，别猜）**：模型约定 **+X=前方、±Y=侧向、+Z=上**。
  - 腿要前后摆（走路）→ `axis=[0,1,0]`（绕侧向轴，脚在 X–Z 平面动）。
  - 尾巴左右甩 → `axis=[0,0,1]`；尾巴上下甩 → `axis=[0,1,0]`。
  - 未写 `axis` 时前端才用 head→tail 启发式（易错）。摆反了把该通道 `q` 取负。

## 多段肢体 / 尾巴 / 蛇身 → `bone_chain`

一整根连续 mesh（尾巴 / 蛇身 / 长鞭子 / 多节触手）想要多节平滑弯曲时，不必手写 N 行 `bone`
逐段手算坐标——用一行 `bone_chain(origin=<链起点>, tail=<链终点>, count=N, parent=<挂到哪根骨>,
axis=<弯曲轴>, source_part=<part>)`：内部在 origin→tail 之间等分展开成 N 条首尾相接的标准
`bone` 语句（第 2 段起自动 `parent`=上一段），行为等价于手写但零手算、零出错。

**对比：4 段尾巴**

手写 4 行 `bone`（每段坐标都要自己算，链条中间还要记着把 `parent` 接到上一段）：

```
b_tail0 = bone(origin=[0,0,-0.15], tail=[0,0,-0.275], axis=[0,1,0], parent=b_spine, source_part=p_tail)
b_tail1 = bone(origin=[0,0,-0.275], tail=[0,0,-0.4],  axis=[0,1,0], parent=b_tail0, source_part=p_tail)
b_tail2 = bone(origin=[0,0,-0.4],   tail=[0,0,-0.525], axis=[0,1,0], parent=b_tail1, source_part=p_tail)
b_tail3 = bone(origin=[0,0,-0.525], tail=[0,0,-0.65],  axis=[0,1,0], parent=b_tail2, source_part=p_tail)
```

一行 `bone_chain(count=4)` 等价替代：

```
b_tail = bone_chain(origin=[0,0,-0.15], tail=[0,0,-0.65], count=4, axis=[0,1,0], parent=b_spine, source_part=p_tail)
```

**要点**：
- 生成的骨骼 id 形如 `<chainId>_0`、`<chainId>_1`……`<chainId>_{count-1}`（`<chainId>` = 你给
  `bone_chain` 这行起的 DSL id，如上例的 `b_tail` → `b_tail_0`..`b_tail_3`），**`animation` 的关键帧
  通道键要用这些分段 id**（不是 `b_tail` 本身）——想做蛇形波动，让 `b_tail_0`..`b_tail_3` 依次错相摆动。
- `b_tail` 这个语句自身的 id（可被别处 `ref` 引用，如挂一根尾尖装饰骨的 `parent=b_tail`）指向**链的最后一段**（tip）。
- `axis` / `source_part` 只写一次，自动应用到链上每一段。
- 因为只是展开成多条标准 `bone` 语句，天然获得自动蒙皮（测地权重）对"一根长 mesh 被多根骨骼平滑
  分段控制"的原生支持，不需要额外适配。
- `count` 是整数 ≥1；`count=1` 等价于一根普通 `bone`（合法但没必要，直接写 `bone` 更直白）。

## 最小示例（组装阶段，显式骨架）

```
# Phase 1 已把每件烘成 <sha>.obj；这里是 Phase 2 组装
mbody  = mesh(filename="<sha_body>.obj")
p_body = part(shape=mbody)
mhead  = mesh(filename="<sha_head>.obj")
p_head = part(shape=mhead, origin=[0, 0, 0.42])
mtail  = mesh(filename="<sha_tail>.obj")
p_tail = part(shape=mtail, origin=[0, 0, -0.4])
# 骨架：脊柱是根，头和尾各自挂脊柱（父子由你按解剖写）
b_spine = bone(origin=[0, 0, 0.05], tail=[0, 0, 0.3],  source_part=p_body)
b_head  = bone(origin=[0, 0, 0.3],  tail=[0, 0, 0.5],  parent=b_spine, source_part=p_head)
# axis=[0,0,1]：绕竖直轴左右甩尾（作者自定，不靠启发式）
b_tail  = bone(origin=[0, 0, -0.2], tail=[0, 0, -0.5], axis=[0, 0, 1], parent=b_spine, source_part=p_tail)
sk      = skeleton(root=b_spine)
skn     = skin(skeleton=sk, method="auto")   # 唯一自动的一步：权重前端求
# 尾巴摆动（通道键=骨骼名 b_tail，值=绕该骨 axis 的弧度）
wag     = animation(fps=30, loop=true, keyframes="{\"b_tail\":[{\"t\":0,\"q\":0},{\"t\":0.5,\"q\":0.6},{\"t\":1,\"q\":0}]}")
```

## 行走示例（四足，四条腿各挂脊柱 —— 不是腿挂腿）

```
mbody    = mesh(filename="<sha_body>.obj")
p_body   = part(shape=mbody, rpy=[0, 1.5708, 0])
mleg     = mesh(filename="<sha_leg>.obj")            # 四腿复用同一 <sha>.obj
p_leg_fl = part(shape=mleg, origin=[0.28, 0.16, -0.32])
p_leg_fr = part(shape=mleg, origin=[0.28, -0.16, -0.32])
p_leg_bl = part(shape=mleg, origin=[-0.28, 0.16, -0.32])
p_leg_br = part(shape=mleg, origin=[-0.28, -0.16, -0.32])
# 脊柱为根；四条腿 head 在髋、tail 朝下，parent 全是 b_spine；axis=[0,1,0]=前后摆
b_spine  = bone(origin=[0, 0, 0], tail=[0.4, 0, 0], source_part=p_body)
b_leg_fl = bone(origin=[0.28, 0.16, -0.15],  tail=[0.28, 0.16, -0.5],  axis=[0, 1, 0], parent=b_spine, source_part=p_leg_fl)
b_leg_fr = bone(origin=[0.28, -0.16, -0.15], tail=[0.28, -0.16, -0.5], axis=[0, 1, 0], parent=b_spine, source_part=p_leg_fr)
b_leg_bl = bone(origin=[-0.28, 0.16, -0.15], tail=[-0.28, 0.16, -0.5], axis=[0, 1, 0], parent=b_spine, source_part=p_leg_bl)
b_leg_br = bone(origin=[-0.28, -0.16, -0.15],tail=[-0.28, -0.16, -0.5],axis=[0, 1, 0], parent=b_spine, source_part=p_leg_br)
sk       = skeleton(root=b_spine)
skn      = skin(skeleton=sk, method="auto")
# 步态：对角腿同相、另一对反相；摆角宜 ±0.3~0.4 rad（±0.5 已偏夸张，低模会显得形变大）
walk     = animation(fps=30, loop=true, keyframes="{\"b_leg_fl\":[{\"t\":0,\"q\":0.35},{\"t\":0.5,\"q\":-0.35},{\"t\":1,\"q\":0.35}],\"b_leg_br\":[{\"t\":0,\"q\":0.35},{\"t\":0.5,\"q\":-0.35},{\"t\":1,\"q\":0.35}],\"b_leg_fr\":[{\"t\":0,\"q\":-0.35},{\"t\":0.5,\"q\":0.35},{\"t\":1,\"q\":-0.35}],\"b_leg_bl\":[{\"t\":0,\"q\":-0.35},{\"t\":0.5,\"q\":0.35},{\"t\":1,\"q\":-0.35}]}")
```

## 跳跃示例（蹲下 → 起跳 → 腾空 → 落地）

跳跃通常 `loop=false`：根位移负责角色整体向前/向上，腿骨旋转负责蹲腿与伸腿。两组稀疏关键帧
使用同一时间轴，预览播一次后保持落地末帧；停止或切换动画会恢复 bind pose。

```
# 假定 b_spine 是 skeleton root，左右腿都明确 axis=[0,1,0]
jump = animation(
  fps=30,
  duration=1.2,
  loop=false,
  interpolation="linear",
  keyframes="{\"b_leg_l\":[{\"t\":0,\"q\":0},{\"t\":0.25,\"q\":-0.65},{\"t\":0.45,\"q\":0.25},{\"t\":0.85,\"q\":0.1},{\"t\":1.1,\"q\":-0.45},{\"t\":1.2,\"q\":0}],\"b_leg_r\":[{\"t\":0,\"q\":0},{\"t\":0.25,\"q\":-0.65},{\"t\":0.45,\"q\":0.25},{\"t\":0.85,\"q\":0.1},{\"t\":1.1,\"q\":-0.45},{\"t\":1.2,\"q\":0}]}",
  root_motion="[{\"t\":0,\"x\":0,\"y\":0,\"z\":0},{\"t\":0.25,\"x\":0,\"y\":0,\"z\":-0.08},{\"t\":0.45,\"x\":0.12,\"y\":0,\"z\":0.35},{\"t\":0.75,\"x\":0.38,\"y\":0,\"z\":0.85},{\"t\":1.0,\"x\":0.58,\"y\":0,\"z\":0.3},{\"t\":1.2,\"x\":0.65,\"y\":0,\"z\":0}]"
)
```

## 完成门禁

- 回执 `mode="character"`、**`skinQc.valid=true`**、`rig.error` 为空。
- `skinQc.signals` 无 `error` 级（`bone_zero_length` 是 warning：骨太短，把 `tail` 拉开）。
- 预览器 character 模式下弯曲**平滑不裂**。
- `export-glb({ mode: "character" })` 产出的 `.glb` 含 `SkinnedMesh + Skeleton + AnimationClip`。

## 常见坑

- **骨太少 / 弯不动**：每个想独立弯的部位各一个 `part` + 一根骨。躯干一整块只得一根骨。
- **骨架连错（腿连腿 / 连歪）**：在 Phase 2 亲手写 `parent`，照 spec 里的 `bone_parent`——四肢挂中轴骨。
- **动画没反应**：① 通道键必须是**骨骼名**（`bone` 那行的 DSL id），不是 part 名；② 预览器要开
  autoAnimate 才播放（`loop=false` 只播一次并保持末帧；导出的 `.glb` 始终内嵌 clip，不受此开关影响）。
- **摆动方向 / 平面不对**：在 `bone(..., axis=[…])` 上写死铰链轴（腿前后摆=`[0,1,0]`）；方向反了把该通道 `q` 取负。别只靠调 `tail` 碰运气。
- **动作形变太大 / 身子被腿扯软**：① 行走 `q` 用 ±0.3~0.4，别超过 ±0.5；② 蒙皮默认已偏硬，
  仍软可 `skin(..., falloff=6)`；关节裂了再软一点 `falloff=2, max_influences=4`。
- **想要机械关节**：那是 [PART A](part-a-asset.md) 的 `joint`（门、夹爪、机械臂、走路机器人）；
  别在角色文件里混 `joint` + `skin`。
