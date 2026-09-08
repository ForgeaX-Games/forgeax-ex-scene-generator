# 模板 · dechouse_gen（指定形状的装饰房屋贴图）

> [SKILL.md](../SKILL.md) 路由到此。通用操作流程见 SKILL.md 第二节。**端口以 `asset2d:groups.get` 为准。**

适用：**一张覆盖整栋建筑**的装饰房屋贴图（billboard object），形状由房顶占地掩码控制；模板内部把掩码渲成灰度底图后图生图，并同出底面碰撞图。

## 暴露输入（连到 `<groupId>.端口`，喂未 hidden 的）

| 端口 | 含义 | 类型 | 喂什么 |
|---|---|---|---|
| `in_4` | item_name | string | 房屋语义名（入库名 + 提示词主体） |
| `in_0` | json_mask | string | **房顶占地掩码 JSON 字符串**（`0`=空 / `1`=占地 / `2`=预设门位；与 Scene `building_footprint_mask` 对齐）。**必须**来自 Scene：`building_footprint_mask` → `grid_to_json` 的 `json` 输出，原样贴入 `text_panel.params.text` 再连进端口；**禁止手拼矩形** |
| `in_1` | height | number | 房高（装饰房常用 1–2，最多 3–4） |
| `in_15` | roofType | string（下拉） | `flat`=平屋顶 / `pitched`=坡屋顶（按设定/风格选） |
| `in_3` | referenced_scene | image | 可选场景风格参考图（把其像素风格迁到灰度图上）；不连即纯灰度图生图 |
| `in_5` | imageSize | string | image_gen 生成档位 |

## Run（runButtons：**一个 image_gen**）
对该 image_gen 的 `nodeId` 调一次 `generation.generateImage`。模板内部已用强约束提示词（严守灰度形状 + 纯色背景），并按 `height`/`roofType` 渲灰度底图。

## 发布 alias 来源（**禁止用 generateImage 返回值**）

`generation.generateImage` 返回的是 **image_gen 原始 JPEG**（白底、未抠图），**不能**直接 `publishToGame`。

正确流程（与 [SKILL.md](../SKILL.md) 第 3→5 步一致）：

1. `execute({})` 预热 → `generateImage` → **`execute({})` 跑后处理**（抠图 / despeckle / 缩放）
2. 对该组 `pipeline.execute({ nodeId: <groupId> })`，从摘要 `outputs[<groupId>].out_3` 读取 **`image_despeckle` 的 PNG alias**（透明底成品）
3. 用 **out_3 的 alias** 调 `publishToGame`（见下节 geometry）；`out_4` 为底面碰撞图，**必须**参与几何计算。

## 暴露输出

| 端口 | 含义 | 类型 | 说明 |
|---|---|---|---|
| `out_3` | image | image | **房屋成品贴图**（`image_despeckle`，透明底 PNG，**发布用这个**） |
| `out_4` | collision | image | 与房屋逐像素对齐的底面碰撞图 |
| `out_0` | error | string | 错误汇总 |

> **与 `asset_generation` 的差异**：本模板**不**直接输出 `geometry_json` 字符串；`out_4` 是碰撞**图**，需再跑 `image_object_geometry`（`image`=out_3、`mask`=out_4）得到 `geometry_json` + `anchor_x`/`anchor_y`，再随 `publishToGame` 入库。**禁止**只传 `anchorX/Y=0.5/1.0` 而省略 geometry——渲染器靠 `geometryJson.collision_mask` 对齐 footprint。

## 发布（进场景沙箱，object）

1. 读 `out_3`（贴图 alias）与 `out_4`（碰撞 alias）。
2. 临时连 `image_object_geometry`：`image`←out_3、`mask`←out_4 → `execute` → 读 `geometry_json`、`anchor_x`、`anchor_y`。
3. `asset2d:publishToGame`：`assetType:"object"`、`assetName`=建筑名、`alias`=out_3 alias、`geometryJson`、对应 `anchorX/Y`；**不传** `autotileKind`。

参考脚本：`scripts/run-623-regen-buildings.mjs` 中 `computeObjectGeometry` + `publish`。

## Scene → 2D 对接（footprint 来源）

1. Scene 布局跑通后，对每栋目标建筑：`PickOneBuilding.out_1` → `building_footprint_mask` → `grid_to_json`。
2. 读取 `grid_to_json.json`，**不做改写**，连到本模板 `in_0`。
3. `in_4`（item_name）= 建筑语义名，与 Scene `BuildingName` / `publishToGame.assetName` 一致。
4. `in_1`（height）= Scene 侧 `BuildingHeight`。
5. 详见 Scene 侧 [asset-collaboration.md §二A](../../../../wb-scene-generator/skills/compose-sino-scene/instructions/asset-collaboration.md)。

## 自检 / 验收（发布前逐项过）

发布前对照下列条目逐项核对（看 `assets.get` 的尺寸/字节 + `out` 字段/error，不靠截图）；任意一条不过，**只重出这一栋**再发布，不动同批其它建筑。

- **建筑立面而非平面**：iso 45° billboard 立面，能看到屋顶 + 至少一面墙；**绝不是俯视户型图 / 平面图 / 纯色块**。
- **轮廓贴合掩码**：成品占地形状与输入 `json_mask`（房顶占地掩码）一致，门位（值 `2`）方向合理。
- **屋顶类型匹配**：`flat` 出平屋顶、`pitched` 出坡屋顶，与传入 `roofType` 一致。
- **透明背景 + 底面碰撞 + 几何**：透明底 PNG；`out_4` collision 与房屋逐像素对齐；`image_object_geometry` 产出非空 `geometry_json`（发布必带）。
- **尺寸映射**：按 `footprint{w,d}` 非正方映射（宽、进深分别 ×16），房高体现 `height`。
- **同批风格统一**：同一场景多栋建筑的配色 / 笔触 / 像素颗粒度一致，可成套使用。
