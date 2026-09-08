# 模板 · asset_generation（单个物件贴图 + 碰撞 + 几何）

> [SKILL.md](../SKILL.md) 路由到此。通用操作流程（发现组 → 喂入参 → 触发 image_gen → execute → 读产出）见 SKILL.md 第二节。
> **端口名/类型/runButtons 一律以 `asset2d:groups.get` 返回为准**，下表是导航。

适用：单个物件 / 贴图（文生图或图生图）。**默认一次同出三样**：物体贴图 + 底部碰撞 mask + 放置几何（`geometry_json`），用户明确不要碰撞/几何时才忽略相应输出。

## 暴露输入（连到 `<groupId>.端口`，喂未 hidden 的）

| 端口 | 含义 | 类型 | 喂什么 |
|---|---|---|---|
| `in_2` | item_name | string | 物件语义名：同时作为**入库显示名**与提示词主体（如 `棕榈树`/`palm_tree`） |
| `in_1` | width | number | 目标像素宽（如 48；16 PPU 下 = 米数×16） |
| `in_0` | height | number | 目标像素高（`0` = 按宽等比） |
| `in_10` | reference1 | image | 可选参考图（图生图）；不连即文生图 |
| `in_11` | reference2 | image | 可选第二参考图 |
| `in_25` | image_size | string | **仅作用于①物体贴图** image_gen 的生成档位（`512`/`1K`/`2K`/`4K`，默 `2K`）。②碰撞/剪影 mask 那颗已在模板内**固定为 `512`**，不随此端口变。 |

其余像素修复/抠图容差/几何阈值等端口为 `hidden`，默认即可。

## Run（runButtons：**两个 image_gen**）

`asset_generation` 组内有**两个** `image_gen`：**①物体贴图**、**②底部碰撞 mask**（碰撞那颗以贴图那颗的输出作 `image` 参考）。

- **顺序铁律：先跑“贴图”image_gen，再跑“碰撞”image_gen**（碰撞要参考已生成的贴图，贴图没先出来碰撞会对不上）。
- **必须串行：等贴图那张真正生成完（`generateImage` 返回成功）再点碰撞那张**。两张连点/并发 = 碰撞 gen 拿不到贴图作参考 → **失败**。
- 用 `groups.get` 的 `nodes`/`edges` 辨别两颗：**`image` 入边来自另一个 image_gen 输出的那颗 = 碰撞 gen**；另一颗 = 贴图 gen。
- 各调一次 `generation.generateImage({ nodeId })`：① 贴图 gen → 等成功 → ② 碰撞 gen。
- **②碰撞/剪影 gen 的 `imageSize` 固定 `512`**（模板内 `params` 写死，不接外部 size）——剪影只需轮廓、不吃高分辨率，固定 512 省额度更稳；`in_25` 只调①贴图。

## 暴露输出

| 端口 | 含义 | 类型 | 说明 |
|---|---|---|---|
| `out_4` | image | image | 物体贴图（已抠图/像素修复/缩放） |
| `out_5` | collision | image | 底部碰撞 mask（与贴图同尺寸） |
| `out_7` | geometry_json | string | 放置几何（anchor/collision_mask/object_height），直接喂 `publishToGame.geometryJson` |
| `out_6` | error | string | 错误汇总 |

## 发布（进场景沙箱，object）

`asset2d:publishToGame`：`assetType:"object"`、`assetName=item_name`、`geometryJson=<out.geometry_json>` + 对应 `anchorX/anchorY`；**不传** `autotileKind`。

## 自检 / 验收（发布前逐项过）

发布前对照下列条目逐项核对（看 `assets.get` 的尺寸/字节 + `out` 字段/error，不靠截图）；任意一条不过，**只重出这一项**（重跑 `generateImage` → `execute({})`）再发布，不动同批其它资产。

- **三样齐全**：`out_4` image / `out_5` collision / `out_7` geometry_json 都非空（用户明确不要碰撞/几何时才允许缺对应项）。
- **透明背景**：物体贴图为透明底 PNG，无白底、无矩形底色块、无残留杂边。
- **尺寸对齐**：贴图按 `width`/`height`（= footprint 格数 × 16 PPU）等比，主体填满画布不留大片空白。
- **透视正确**：物件是 iso / topBillboard 站立姿态，**不是俯视平铺、不是整张场景图**。
- **碰撞贴合**：`collision` mask 与贴图同尺寸，覆盖底面接地轮廓、不偏移。
- **非废图**：不是糊版 / 纯色块（产出体积明显大于 ~1KB 的纯色块阈值，能看出物件形态）。
