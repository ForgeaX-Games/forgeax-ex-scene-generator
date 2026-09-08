---
name: compose-lowpoly
description: Route low-poly assets, mechanical assemblies, buildings, characters, and static scenes into the matching Geometry DSL execution flow.
trigger: /compose-lowpoly
---

# Compose Lowpoly · 短路由器

Geometry DSL 是唯一真源。禁止手工 `createNode`/`connect`，禁止 AI 使用 `batteries.*` 与 `pipeline.*`。截图是内部/人工能力，不参与 AI 完成判定。

## 1. 分诊并只读一个 execution

先判断任务属于哪一类，**只用 Read 工具打开那一个 execution 文件**，其余三个不要读：

- A · 单物件/机械/刚性装配 → 判断成立就 Read `executions/part-a-asset.md`
- B · 建筑/房间/建筑构件 → 判断成立就 Read `executions/part-b-building.md`
- C · 多个独立物件的静态空间组合 → 判断成立就 Read `executions/part-c-scene-assembly.md`
- D · 连续表皮角色/生物/软体 → 判断成立就 Read `executions/part-d-character.md`

活物走跑仍走 D 的骨骼动画；刚性零件绕轴才走 A 的 joint。同一模型不得混合 joint 与 skin/skeleton。
B / C 默认**不写 joint**（静态路）：构件各写各的绝对 `origin`，只有相对父件才说得清的位姿用
`place_local`。B 里只有真正可开合的门窗扇例外，一旦写了 joint 整栋回到 URDF 路。

## 2. 共同协议

### 官方工具调用

Agent 工具列表会把注册 ID 中的 `:` / `.` 规范化为下划线。调用 `lowpoly:model.apply` 时使用
`lowpoly_model_apply`，并将 `source`、`name` 等参数直接放在工具输入顶层。禁止传
`toolId` / `args` / `caller` envelope，也禁止空参数调用；若返回
`missing required property "source"`，按顶层参数形状重试一次，不改用 graph、UI、shell 或 HTTP。

### 断点续接（对话被截断/压缩后不失忆）

长任务（多件 bake + 组装的循环）跨的轮次多，对话可能因为上下文压缩、网络问题或用户手动
中断而在任意一步断开；"继续"时的新一轮**看不到旧对话被截掉的那部分**，只凭聊天记录复原
计划并不可靠。真正扛得住中断的，是写在磁盘上、下一轮 `projects.open` 就能读回的状态，不是
聊天记录里的那段文字：

- **每次 build spec 定稿或产生实质性进展后**（bake 完一个 unique item、进入组装阶段、组装
  收敛完成），立刻 `lowpoly:projects.update({ id, description: JSON.stringify({phase, spec, baked}) })`
  把一份**够继续干活的最小 checkpoint** 写回项目——`phase`（`"spec"｜"phase1-bake"｜"phase2-assembly"｜"done"`）、
  `spec`（当前 build spec JSON，或至少 `target` + 每个 part/item 的 `id`/`size`/`place`）、
  `baked`（已烘出的 `{id, filename, bbox_min, bbox_max}` 列表）。这是**原子写盘**的项目元数据
  （见 `lowpoly:projects.update` 工具说明），不依赖这轮对话还记不记得，重开后端 / 新开一轮
  对话都能读回。
- **每次 `lowpoly:projects.open` 之后，先看 `project.manifest.description`（或
  `lowpoly:projects.list` 里对应项目的 `description`）有没有 checkpoint，再决定怎么干**——
  尤其是用户说"继续"这类没有说明具体在建什么的指令时，这一步是**唯一**能确认"这个项目上次
  干到哪了"的地方，比凭对话记忆瞎猜或者从头重新写 spec 可靠得多。读到 checkpoint 后用
  `lowpoly:parts.list`（真实已烘焙的件）和 `lowpoly:model.get`（真实当前 DSL/图）交叉核实——
  checkpoint 记的是"当时的意图"，`parts.list`/`model.get` 才是"现在的事实"，两者对不上以
  事实为准，只把 checkpoint 当作恢复计划上下文的线索。
- 没有 checkpoint 却又不是全新项目（`parts.list` 已有件、`model.get` 已有 DSL）时，**先补一份
  checkpoint 再继续**——多半是旧版本干到一半没来得及写，别因为读不到 checkpoint 就假装这是
  新任务从头重建。

### build spec（动手前的硬门禁）

写任何 DSL 之前先产出一份 build spec JSON，字段规范见
[build-spec.md](build-spec.md)。每个 unique part 一条：

```json
{"id":"part","function":"是什么/干什么","form":"2~3句真实形态","ops":["semantic_op","csg_op"],
 "size":[1,1,1],"place":{"center":[0,0,0.5],"rpy":[0,0,0]},"datum":"局部原点",
 "features":["显著细节+位置+尺寸"],"material":"颜色","parent":"父件id"}
```

`place.center` 是该件在**装配坐标系**下的目标 bbox 中心——它让 Phase 2 摆位变成一次减法，
而不是反复试。bake 时把 `size` / `features` 回传给 `model.apply` 的
`expectedDims` / `features`，回执 `advice.dimensionDelta` 会直接给出与计划的偏差。

删除不能直接驱动 DSL 的修辞。优先 semantic family：

- 建筑：Architecture
- 机械细节/轮廓实体：Profile → extrude/revolve/sweep + CSG（本工具不提供齿轮/铰链/旋钮类机械
  CAD 电池，机械细节一律用 CSG 搭出来）
- 装配摆位：`align_centers` / `place_local` / `place_on_face` / `place_on_surface`
- 裸 primitive 仅用于确实简单的板、杆、球

### 两阶段

1. 每件独立 source 建模并 bake，带上 spec 里的 `expectedDims` / `features`。多件可一次提交 `model.bakeBatch({items})`，但每个 item 仍是独立 DSL，不形成 mega graph。
2. 用 `<sha>.obj` + bbox 建 mesh/part 组装，位姿由 `place.center − c_local` 算出。机械写 joint；角色写 bone/skeleton/skin；建筑与静态场景不写 joint（相对父件的位姿用 `place_local`）。

### 增量迭代

- 首次或结构变化大：`model.apply`
- 已知行号的小改：先持有 `sourceHash`，用 `model.patch({baseHash, patches})`
- hash 冲突：调用 `model.get` 后重放修改
- bake 清单：`parts.list`

## 3. 完成与收敛

`ok/valid` 语义保持既有门禁。metrics、primitive ratio、尺寸偏差、bake provenance 和 QC 建议均为非阻断信号：

1. 先修 error，再按显著特征缺失、尺寸比例、semantic op 缺失、warning/note 排序。
2. 同一问题最多 3 次修复；总 apply/patch 次数服从 execution 预算。
3. fingerprint/sourceHash 不变化时停止重复提交。
4. 达到预算后保留最好结果；建议未清零不阻塞交付。

仅用户明确要求文件时调用 `export-glb`。

## 4. 按需参考

同样刻意不用链接——每个 execution 文件顶部已经按自己需要链了对应分片，从那里点进去即可，
不要在这里把全部按需文档一次性预拉：

- 计划 schema（所有路线的硬门禁，已在上面 §2 用真链接引用过一次）：`build-spec.md`
- DSL 语法：`dsl-quickref.md`（当前 execution 顶部通常已链，缺失时才单独 Read）
- op 家族入口：`op-directory.md`（只读当前 execution 顶部点名的那几个分片，不读整个目录）
- 共同行为：`shared-conventions.md`（当前 execution 顶部通常已链）
