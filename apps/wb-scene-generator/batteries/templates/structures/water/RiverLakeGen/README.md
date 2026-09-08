# RiverLakeGen（河流湖泊生成）

> templateId（传给 `POST /api/v1/group-templates/:projectId/instantiate`）：`group_river_lake_gen`，也可用 basename `RiverLakeGen`。

把上游场景的足迹切片为基准网格，用 `river_lake_gen` 电池生成河流湖泊系统（河岸/浅水/中水/深水多层 + 可选水中物品多值网格），按值拆分后逐张建为命名场景子节点；输出与其它结构模板一致的五个固定端口。

## 五个固定输出端口（结构契约）

| 方向 | portName | 语义 |
|---|---|---|
| OUT | `out_0` | Scene 完整场景（输入 + 水域子树） |
| OUT | `out_1` | Water 水域子树（主产物，多层深度 + 物品） |
| OUT | `out_2` | Rest 剩余空地（基准减去水域覆盖） |
| OUT | `out_3` | WaterPath 水域子节点路径 |
| OUT | `out_4` | RestPath 剩余子节点路径 |

## 主要可见输入端口

| portName | 语义 |
|---|---|
| `in_0` | Scene 上游场景（**必接**） |
| `in_1` | AssetName 资产名 |
| `in_2` | Seed 随机种子 |
| `in_3` | RiverCount 河流数量 |
| `in_4` | Algorithm 生成算法（straight / meandering / branching / random） |
| `in_5` | MinWidth 最小河宽 |
| `in_6` | MaxWidth 最大河宽 |
| `in_7` | LakeCount 湖泊数量 |
| `in_8` | WaterItems 水中物品清单（如 `["荷叶","浮萍"]`） |

> 输入名称清单 `inputNameList` 默认隐藏（缺省 `[]`）。

## 内部管线

`scene_passthrough → node_explode → rect_grid → voxel_slice`（取顶层切片做基准）→ `river_lake_gen`（水域多值网格，输出端口 `waterGrid`）→ `grid_split_by_value` → `grid2node`（按 `AssetName` 命名，挂 `asset_type=tile`）→ `add_child`；同时 `alg_region_subtract`（基准 − 水域）得到 Rest 子树。最后 `scene_merge_subtrees` 合并并 `scene_focus_path` 分别聚焦，导出五个固定端口。

`in_0` 悬空会导致整组静默空跑（execute 仍 completed）。完整端口以 `GET /api/v1/group-templates/:id?scope=templates` 为准。
