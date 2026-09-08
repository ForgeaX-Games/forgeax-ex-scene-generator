# Build spec — 建模前的结构化计划（硬门禁）

> 四条 execution（[A](executions/part-a-asset.md) / [B](executions/part-b-building.md) /
> [C](executions/part-c-scene-assembly.md) / [D](executions/part-d-character.md)）共用这一份
> schema。动手写任何 DSL 之前，先产出一份 build spec JSON；它同时是**建模的目标**、
> **bake 的对账基准**、**装配摆位的算术输入**。
>
> 它不是文字清单。一行流水账（「A：盒子，B：圆柱」）等于没有计划——Phase 1 会直接退化成
> 堆 primitive。

## 1. Schema v1

```json
{
  "spec_version": 1,
  "route": "A",
  "target": {
    "name": "spray_bottle",
    "intent": "家用喷雾瓶，手持扳机式",
    "size": [0.07, 0.07, 0.26],
    "frame": "装配原点=瓶底中心，+Z 向上，+X 为正前"
  },
  "parts": [
    {
      "id": "barrel",
      "function": "主瓶体，盛液并与瓶盖旋合",
      "form": "细长中空圆柱，近顶部有一段收肩，底部倒圆；顶端开口带外螺纹环。是容器不是实心棒，壁很薄。",
      "ops": ["profile_circle", "revolve", "difference"],
      "size": [0.07, 0.07, 0.18],
      "place": { "center": [0, 0, 0.09], "rpy": [0, 0, 0] },
      "datum": "局部原点=底面中心，轴=+Z；顶缘与 cap 配合",
      "features": [
        "内腔通体中空，壁厚 0.002",
        "顶部螺纹环 Z 0.17~0.18",
        "底部圆角 r0.01"
      ],
      "material": "translucent_white",
      "parent": "root",
      "joint": { "type": "fixed" },
      "primitive_reason": null
    }
  ]
}
```

### 字段含义

| 字段 | 必填 | 说明 |
|---|---|---|
| `route` | 是 | `A` / `B` / `C` / `D`，决定下面用哪套变体字段 |
| `target.size` | 是 | 整体外包尺寸 `[x,y,z]`，米。所有 part 必须装得下 |
| `target.frame` | 是 | 一句话说清装配原点在哪、哪个方向是正前。后面所有 `place.center` 都在这个系里 |
| `parts[].id` | 是 | 稳定短名，同时用作 DSL 里的 shape id 前缀 |
| `parts[].function` | 是 | 这件东西**是什么、干什么用**。功能决定形态 |
| `parts[].form` | 是 | **2~3 句**真实形态：轮廓 / 截面 / 中空还是实心 / 收放曲直 / 对称性 / 凭什么一眼认出它是这个而不是通用方块。禁止「大概是个盒子」「差不多圆柱形」这类占位话 |
| `parts[].ops` | 是 | 具体 op 路线，不是家族名。如 `["profile_rounded_rect","extrude","difference"]` |
| `parts[].size` | 是 | 该件**局部**外包尺寸 `[x,y,z]`，米。→ 直接作为 `expectedDims` 回传 |
| `parts[].place.center` | 是 | 该件在**装配坐标系**下的目标 bbox 中心。→ 推导摆位坐标 |
| `parts[].place.rpy` | 是 | 装配朝向，弧度。没有转就 `[0,0,0]` |
| `parts[].datum` | 是 | 局部原点在哪个面 / 轴上，哪个面与父件贴合。bake 存的是局部坐标，Phase 2 靠这个对位 |
| `parts[].features` | 是 | 每条一个必须做出来的特征 + 它在哪 + 多大：孔 / 腔 / 倒角 / 圆角 / 格栅 / 槽 / 筋 / 收分。这是 Phase 1 真正要建的清单 → 同时回传 `features` |
| `parts[].material` | 是 | 颜色 / 质感。Phase 2 由 `material` 上色，不烘进 mesh |
| `parts[].parent` | 是 | 父件 `id`，根件写 `"root"` |
| `parts[].primitive_reason` | 条件 | 只有路由到裸 primitive 的件才填，且必须能把这句话补完整：**「这件的真实形态就是一块 {板/杆/球/环}，没有任何切口、空腔、曲面或圆角。」** 凡是要加「但它还有个孔 / 它是圆的 / 差不多就行」，它就不是 primitive，回去改 `ops` |

### 路线变体（只加字段，骨架不变）

| route | 增加 |
|---|---|
| **A** | `parts[].joint`：`{type: "fixed"｜"revolute"｜"prismatic"｜"continuous", axis, limits}` |
| **B** | `target` 增 `building_type` / `floors` / `storey_height` / `roof`；`parts[]` 增 `level`、`openings`。**不加 `joint`**——建筑走静态路，`parent` 只表示依附支撑关系，构件各写各的绝对 `origin`。详见 [part-b-building.md](executions/part-b-building.md) |
| **C** | 拆两层：`items[]`（unique 造型，字段同 `parts[]` 但无 `place`，增 `route: "A"｜"B"` 和 `reuse`）+ `instances[]`（`item_ref` / `place` / `scale` / `material`）。`target` 增 `footprint` / `layout`（`grid`｜`street`｜`cluster`｜`scatter`） |
| **D** | 用 `bone` + `bone_parent` 取代 `joint`。父骨按解剖定：四肢各自挂中轴骨，**绝不腿挂腿** |

## 2. 计划期自检（写完 spec、动手之前自己算一遍）

这几条你自己就能算，不需要后端。**不通过就改 spec，别带着错的计划去建模**：

- **装得下**：每个 `place.center ± size/2` 都落在 `target.size` 的包围盒内。
- **不互穿**：任意两个兄弟件的 AABB 重叠体积 ≈ 0。确实要嵌进去的（门扇嵌门框、窗嵌墙洞），在该件 `features` 里写明是嵌入件。
- **落地**：应当着地的件，`min(center.z − size.z/2) ≈ 0`；不要整体埋进地里或浮在半空。
- **连通**：顺着 `parent`（D 是 `bone_parent`）往上，每个件都能走到 `root`，没有环、没有孤儿。
- **有内容**：每个件至少 1 条 `features`，否则必须填 `primitive_reason`。
- **比例**：拿两三对相邻件的 `size` 互相比一比，符合真实物件的比例直觉。

PART B 的对齐配方（洞口↔窗/门、楼板尺寸、楼梯↔楼梯井）见
[part-b-building.md](executions/part-b-building.md#对齐配方--placement-recipes对不上就是这里没做对)。

## 3. spec 怎么驱动后面两个阶段

### Phase 1 · bake 时回传，让后端替你算偏差

每件 bake 都把计划里的尺寸和特征带上：

```
model.apply({
  source,
  bake: "<shape_id>",
  expectedDims: part.size,      // 来自 spec
  features: part.features        // 来自 spec
})
```

回执 `advice.dimensionDelta` 就是**实际烘出来的尺寸减去计划尺寸**，逐轴给出。
`model.bakeBatch` 的每个 item 同样支持这两个参数。

偏差怎么处理：

- 任一轴偏差 > 计划值的 10% → 要么改 DSL 把尺寸做对，要么改 spec 并在回复里说明为什么改。
- **不许沉默放过**。`advice` 是非阻断信号，后端不会拦你，所以这一步全靠你自己认账。

### Phase 2 · 摆位是减法，不是试出来的

bake 回执给的 `bbox_min` / `bbox_max` 是该件的**局部** AABB。令局部中心

```
c_local = (bbox_min + bbox_max) / 2
```

则：

| 场景 | 公式 |
|---|---|
| B / C / D：`part` 的 origin 就是世界位姿 | `origin = place.center − c_local` |
| B 里位置只能相对父件表达的那几件（窗嵌墙洞、门框嵌墙洞、门扇挂门框） | `place_local(parent, child, offset=<洞口在父件局部系里的坐标>)`——**别自己套父件的旋转**，op 会复合 |
| A：joint origin 是相对父件的 | `joint.origin = child.place.center − parent.place.center`（父件 `rpy ≠ 0` 时先把差向量按父件旋转求逆变换） |
| 需要底面正好踩地面 | `origin.z = −bbox_min.z × sz` |

这三条把「反复手调 origin」变成一次减法。**Placement DSL 仍然是首选**——
`align_centers`（同轴 / 同心）、`place_on_face`（贴轴对齐外表面）、`place_on_surface`
（沿曲面法线贴附）表达的是**语义关系**，比硬坐标稳。当关系能用这三个 op 说清时用它们；
说不清的自由位姿才用上面的减法。

### 迭代时

`spec` 是全程的对账基准。每轮 `model.apply` 之后，拿回执里的尺寸 / bbox / QC 信号逐条对
`spec`：件的尺寸对不对、摆位对不对、`features` 里列的特征是不是真做出来了。
**单次回执干净 ≠ 完成**——还得每件都对得上它在 spec 里那一行。

`spec` 只存在于这一轮对话里，对话一旦被截断/压缩就找不回来了。定稿后（以及之后每次实质性
更新）用 `lowpoly:projects.update({ id, description: JSON.stringify({phase, spec, baked}) })`
把它落盘——这是项目元数据的原子写入，重开项目就能读回，续接任务时不必凭聊天记录复原计划。
详见 [SKILL.md](SKILL.md) §2 "断点续接"。

要改造型，回 Phase 1 重建重烘那一件；只改摆位 / 颜色的，留在 Phase 2 调。
`spec` 本身也可以改，但改了要说明，别让计划悄悄跟着结果走。

## 4. 一个够格的 part 行长什么样

上面 schema 里的 `barrel` 就是标准密度。对照反例：

```json
{ "id": "barrel", "form": "圆柱形的瓶身", "ops": ["cylinder"], "size": [0.07, 0.07, 0.18] }
```

这行**不合格**：`form` 是占位话（没说中空、没说收肩、没说底部倒圆），`ops` 直接躺平到
primitive 却没有 `primitive_reason`，没有 `features` 所以 Phase 1 什么细节都不用做，没有
`place` / `datum` 所以 Phase 2 只能靠试。这样的一行必然烘出一根光秃秃的圆管。

**spec 里每一行都要能让人只看这一行就把这件东西建出来。** 哪一行读着空泛，就在动手前
改那一行，而不是建模途中再补。
