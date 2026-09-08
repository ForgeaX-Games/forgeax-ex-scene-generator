# IslandRegions（指定锚点岛屿区域）

> templateId（传给 `POST /api/v1/group-templates/:projectId/instantiate`）：`group_1783100010000_isld1`，也可用 basename `IslandRegions`。
> 内部 19 个节点 + 1 个嵌套子组（TileAssetName）。核心算法节点为 **`new_island_region_gen`**（位于 `scene30/aw_mountain/`）。实例化后返回全新运行时 `groupId`，后续连线一律用返回值。

## 功能说明

在一片上游空地（scene）上，按 **传入的 point 列表** 作为锚点（每点一岛），生成有机形状的**岛屿区域**，并把岛屿合并为一个陆地节点挂回场景树；同时产出**剩余区域（Rest）**供下游继续铺设。

生成算法**完全复用** `island_poisson_gen` 的内部算法（子种子散布 → 竞争 BFS 膨胀 → 去碎片 → 多数投票平滑），仅把「泊松盘随机锚点」替换为「point 列表指定锚点」，因此岛屿出现在**指定位置**。

数据流（标准六段流水线，对标 PickOneBuilding）：

```
Scene ─ scene_passthrough ─ node_explode → rect_grid → voxel_slice ── mask ──┐
Points ─────────────────────────────────────────┐                            │
IslandSizes ─────────────────┐                   ↓                            │
                       new_island_region_gen(grid=mask, points, islandSizes, radiusVar, seed)
                       ├─ islandGrid → grid2node(IslandName) → TileAssetName(asset_type=tile) → add_child(parent=Scene)
                       └─ alg_region_subtract(a=mask, b=islandGrid) → grid2node("rest") → add_child
                                          → scene_merge_subtrees → scene_focus_path ×2 / passthrough ×3 / type_string ×2
```

## 输入端口（IN）

| portName | portType | access | 语义 | 是否必接 | 怎么喂 |
|---|---|---|---|---|---|
| `in_0` | scene | tree | **Scene** 上游空地（挂接父场景） | **必接** | 上游 `AddBaseGrid.out_1`(BaseNode) 或上一层 `out_2`(Rest) |
| `in_1` | point2d | list | **Points** 各岛中心锚点（每点一岛） | **必接** | `manual_points` → `tree_merge`(item) → `in_1` |
| `in_2` | number | list | **IslandSizes** 各岛膨胀半径（与 Points 对应，不足复用末值） | 建议接 | `number_const` / `range_list` → `in_2` |
| `in_3` | string | item | **IslandName** 岛屿节点名 | 建议接 | `text_panel.output` → `in_3` |
| `in_4` | string(tree) | tree | **IslandAsset** 岛屿底图资产名（tile） | 可选（推荐） | `text_panel.output` → `in_4` |
| `in_5` | number | item | **Seed** 随机种子 | **必接** | **`aw_m0_seed.seed`（全局固定非 0）** → `in_5`；禁止悬空/`seed:0`（0=每次 execute 用 `Date.now()` 重抽） |

> 隐藏高级端口：`in_6`(RadiusVar)、`in_7`(SliceZ)、`in_8`(FillValue)、`in_9`(schema)、`in_10`(token)、`in_11`(zRange)——默认即可，日常不接。

## 输出端口（OUT）

| portName | 类型 | 语义 | 典型去向 |
|---|---|---|---|
| `out_1` | scene | **Island**（岛屿陆地节点，focus 已聚焦） | 在岛上继续布置（领域细化），禁止接 merge |
| `out_2` | scene | **Rest**（剩余区域 = mask − 岛屿，含水面与未占空地） | → 下一层模板 `in_0`/Scene 串联，记录 `restAnchor` |
| `out_0` | scene | **Scene**（整棵合并后场景树） | `{ "label":"Scene", "portName":"out_0" }` → `appendMergeItem` 汇总根 |
| `out_3` | string | **IslandPath**（岛屿节点路径句柄） | 下游 `string_concat` 等 |
| `out_4` | string | **RestPath**（剩余区域路径句柄） | 下游 |

## 推荐参数

- **Points（`in_1`）**：岛屿中心坐标列表，坐标按 base 网格的 `(x→列, y→行)`。落在 base 范围外的点会被忽略。
- **IslandSizes（`in_2`）**：各岛膨胀半径（格），建议 6~20。与 Points 数量不一致时短则复用末值、长则截断。
- **IslandAsset（`in_4`）**：岛屿渲染底图图层名（tile），推荐 `island` / `land` / `grassland` 等。
- **Seed（`in_5`）**：**必须**接全局 `aw_m0_seed.seed`（或等价固定非 0）；`0`/悬空 = 每次不同。Task Viewer 基建已创建 `aw_m0_seed`。

## 使用示例（applyBatch ops，可照抄）

先实例化本组拿回 `<G_ISLAND>`：

```json
{ "method":"POST","path":"/api/v1/group-templates/<projectId>/instantiate","caller":{"kind":"workbench"},
  "args":{ "templateId":"IslandRegions", "position":{"x":0,"y":0},
           "opts":{"actor":"ai:sino","label":"实例化 IslandRegions"} } }
```

把返回 groupId 替换进 `<G_ISLAND>`，再提交（Scene 接上游 BaseNode、Points 接锚点列表、IslandSizes/Name/Asset/Seed）：

```jsonc
// in_0=Scene；in_1=Points；in_2=IslandSizes；in_3=IslandName；in_4=IslandAsset；in_5=Seed（必接全局固定 seed）
{ "type":"connect","edgeId":"e_isl_scene","source":{"nodeId":"<G_BASE>","port":"out_1"},      "target":{"nodeId":"<G_ISLAND>","port":"in_0"} },
{ "type":"connect","edgeId":"e_isl_pts",  "source":{"nodeId":"<pts_merge>","port":"tree"},     "target":{"nodeId":"<G_ISLAND>","port":"in_1"} },
{ "type":"connect","edgeId":"e_isl_size", "source":{"nodeId":"<sizes>","port":"value"},        "target":{"nodeId":"<G_ISLAND>","port":"in_2"} },
{ "type":"connect","edgeId":"e_isl_name", "source":{"nodeId":"<isl_name>","port":"output"},    "target":{"nodeId":"<G_ISLAND>","port":"in_3"} },
{ "type":"connect","edgeId":"e_isl_asset","source":{"nodeId":"<isl_asset>","port":"output"},   "target":{"nodeId":"<G_ISLAND>","port":"in_4"} },
{ "type":"connect","edgeId":"e_isl_seed", "source":{"nodeId":"aw_m0_seed","port":"seed"},      "target":{"nodeId":"<G_ISLAND>","port":"in_5"} }
```

独立 demo 若无基建，可先 `createNode` `seed_control`（`params.seed` 非 0，如 `42`）再接到 `in_5`。

> 多层串联：本组 `out_2`(Rest) → 下一层模板的 Scene 输入（如再叠一层装饰 / 湖泊）。

## 验证要点

- `pipeline.get` 核对 `<G_ISLAND>` 的 `in_0`/`in_1` 真的接上了边（防"ok 却空"）；`in_1` Points 悬空会**静默空跑**（无岛屿输出）。
- `pipeline.execute` 应 `status:completed` 零错误。

### 读回端口内容验证

```bash
# 岛屿节点（out_1）的子树——用实例化返回的真实 groupId 替换 <G_ISLAND>
forgeax pipeline execute --batteries $BATT $G \
  | jq '.result.outputs["<G_ISLAND>"]["out_1"][0].items[0].tree.children[].name'
# Rest（out_2）剩余区域
forgeax pipeline execute --batteries $BATT $G \
  | jq '.result.outputs["<G_ISLAND>"]["out_2"][0].items[0].tree.children[].name'
```

预期：`out_1` 子树出现以 **IslandName** 命名、带 **IslandAsset** tile 的岛屿节点；`out_2` 出现 `rest` 节点。

> ⚠️ 绝不要整体打印 `outputs`（含全 voxel 网格，会爆上下文）；必须用 jq 投影到具体 `nodeId.portName`。
