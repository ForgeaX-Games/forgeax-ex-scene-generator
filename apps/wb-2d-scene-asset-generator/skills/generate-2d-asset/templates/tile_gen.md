# 模板 · tile_gen（地形瓦片 / Autotile atlas）

> [SKILL.md](../SKILL.md) 路由到此。通用操作流程见 SKILL.md 第二节。**端口以 `asset2d:groups.get` 为准。**

适用：可无缝平铺的**地形瓦片 / Wang-Autotile atlas**。模板内部：生大块目标纹理 → TerrainExtract 提取 → AtlasCompose 用内置 4×N 模版合成 atlas → 入库。

## 暴露输入（连到 `<groupId>.端口`，喂未 hidden 的）

| 端口 | 含义 | 类型 | 喂什么 |
|---|---|---|---|
| `in_12` | name | string | 瓦片入库显示名（如 `草地瓦片`） |
| `in_13` | tile | string（下拉） | 瓦片种类，**决定内部用哪张模版合成 → 直接决定 atlas 尺寸与对应的 autotileKind**。**别照字面材质名选**，按下面〈① tile 类型怎么选〉用目标 `autotileKind` 反查。最常踩坑：无缝整片地面要选 **`tilemap`**（≠ `floor`！） |
| `in_14` | description | string | 目标纹理描述提示词（强调铺满、俯视、无主体物件、无阴影） |
| `in_2` | imageSize | string | image_gen 生成档位 |

> 🎨 **参考图（风格统一）**：`in_1`（image）是 **hidden 的参考图高级口**——成套出资产时，把调度给的「基准参考图」alias 经 `image_source` 显式连到 `in_1` 做图生图，让地形瓦片与全场景风格统一（颗粒度/配色/光照）。单独出瓦片、无需对齐整套时可不连。

## ① tile 类型怎么选（关键 · 含历史遗留命名坑）

`tile`（`in_13`）的取值**不是按"地表是草/雪/石"这种材质来选的**，而是按你要产出的 **autotile 规则（`autotileKind`）** 来选——它决定内部套哪张模版、从而决定 atlas 的最终尺寸。**先看契约里的 `autotileKind`，再用下表反查该填哪个 `tile` 值**：

| 目标 `autotileKind` | 该填的 `tile` 值 | 合成 atlas 尺寸 | 说明 |
|---|---|---|---|
| **`common_16`** | **`tilemap`** | **64×80**（或基础 64×64） | 最常用：可四向无缝平铺的**整片地面**（草地/雪地/石板地…）。**要 common_16 就必须选 `tilemap`** |
| `flower_bed_11` | `flower_bed` | 64×64 | 花圃类 11 态 |
| `slope_9` | `slope` | 48×48 | 斜坡 9 态 |
| `wall_outer_16` | `wall` | 64×80 | 外墙 16 态 |
| `floor_1` | `floor` | **16×16（单格）** | ⚠️ **见下方命名坑**：这是"单格地砖"，不是无缝大地面 |

> ⚠️ **历史遗留命名坑（务必记牢）**：下拉里的 **`floor` 不是"地面/地板材质"的意思**——它对应规则 `floor_1`，产出的就是**一张 16×16 的单格瓦片**。所以：
> - 用户/契约说"草地地面、雪地地面、要无缝铺满整片地" → 这是 **`common_16` 整片地面 → 选 `tilemap`**，**绝不是 `floor`**。
> - 只有明确要"单格地砖"时才选 `floor`。
> - 选错（把整片地面选成 `floor`）→ 你只会得到一张 16×16 单格，发布成 `common_16` 时**后端会因尺寸不符直接拒绝**。

> 选定后：`tile` 值用 `text_panel` 填到 `in_13`；发布时 `publishToGame` 的 `autotileKind` 必须与上表一致（`tilemap`→`common_16`、`floor`→`floor_1`…），三者（tile 值 / atlas 尺寸 / autotileKind）对齐才算对。

## Run（runButtons：**一个 image_gen**）
对该 image_gen 的 `nodeId` 调一次 `generation.generateImage`（生**大面积目标纹理**）。下游 TerrainExtract/AtlasCompose 是普通电池，`execute` 时执行。

## 暴露输出

| 端口 | 含义 | 类型 | 说明 |
|---|---|---|---|
| `out_3` | image | image | 合成的瓦片 atlas（与内置模版同分辨率） |
| `out_2` | error | string | 错误汇总 |

> 发布 tile：`asset2d:publishToGame` 传 `autotileKind`（如 `common_16`）；后端会校验 atlas 尺寸与该 rule 匹配。

## 自检 / 验收（发布前逐项过）

发布前对照下列条目逐项核对（看 `assets.get` 的尺寸/字节 + `out_2` error，不靠截图）；任意一条不过，**只重出这块瓦片**再发布，不动同批其它瓦片。

- **atlas 尺寸 = 目标规则尺寸**（**唯一的硬判据，按宽×高像素核对，不要看字节数**）：
  - `common_16`（`tile=tilemap`）→ **64×80** 或 64×64；
  - `floor_1`（`tile=floor`）→ **16×16 单格**；`flower_bed_11`→64×64；`slope_9`→48×48；`wall_outer_16`→64×80。
  - 尺寸对上即合格，发布端也按这个尺寸校验。**尺寸不对（最常见：本该 64×80 的 common_16 却得到 16×16）= 你 `tile` 类型选错了**（多半把整片地面错选成 `floor`），回〈① tile 类型怎么选〉改成 `tilemap` 重出，**不是去查图为什么"空"**。
- 🚫 **不要用字节数判空图**：atlas 是小尺寸 PNG，**字节数本来就很小**——`floor_1` 的 16×16 只有两三百字节是**完全正常**的，`common_16` 的 64×80 也就几 KB。看到「207 字节」别脑补成"空 atlas"去反复取证、反复重生成，那是浪费轮次。判空只看 `out_2` error 与 `assets.get` 的尺寸/字节；尺寸正确 + 无 error 就过。
- **无缝可平铺**：相邻边可拼接，无明显接缝、无突兀的重复缝感。
- **俯视铺满**：纯地形纹理铺满画布，**无主体物件、无投影阴影、无构图主角**。
- **不透明**：瓦片是实心地表（**与 object 相反，不抠背景、不保留透明**）。
- **种类相符**：纹理内容与传入 `tile` 种类一致。
