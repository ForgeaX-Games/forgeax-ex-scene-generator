# ParkGenerator（公园生成）

> templateId（传给 `POST /api/v1/group-templates/:projectId/instantiate`）：`group_park_generator`，也可用 basename `ParkGenerator`。

把上游场景的足迹切片为区域掩码网格，用 `park_generator` 电池生成公园布局（有机曲线 / 几何对称 / 放射形，含草坪/小径/花圃/树木/池塘多值网格），按值拆分后逐张建为命名场景子节点；输出与其它结构模板一致的五个固定端口。

## 五个固定输出端口（结构契约）

| 方向 | portName | 语义 |
|---|---|---|
| OUT | `out_0` | Scene 完整场景（输入 + 公园子树） |
| OUT | `out_1` | Park 公园子树（主产物，1=草坪/2=小径/3=花圃/4=树木/5=池塘） |
| OUT | `out_2` | Rest 剩余空地（掩码减去公园覆盖） |
| OUT | `out_3` | ParkPath 公园子节点路径 |
| OUT | `out_4` | RestPath 剩余子节点路径 |

## 主要可见输入端口

| portName | 语义 |
|---|---|
| `in_0` | Scene 上游场景（**必接**） |
| `in_1` | AssetName 资产名 |
| `in_2` | Seed 随机种子 |
| `in_3` | Algorithm 布局算法（organic / geometric / radial） |
| `in_4` | PathWidth 小径宽度（笔触半径） |
| `in_5` | TreeCount 树木数量 |
| `in_6` | SpokeCount 辐射数量（radial 模式） |

> `fillValue / z / schema / token / zRange` 等管线参数默认隐藏。

## 内部管线

`scene_passthrough → node_explode → rect_grid → voxel_slice`（取顶层切片做掩码）→ `park_generator`（多值公园网格）→ `grid_split_by_value` → `grid2node`（按 `AssetName` 命名，挂 `asset_type=tile`）→ `add_child`；同时 `alg_region_subtract`（掩码 − 公园）得到 Rest 子树。最后 `scene_merge_subtrees` 合并并 `scene_focus_path` 分别聚焦，导出五个固定端口。

`in_0` 悬空会导致整组静默空跑（execute 仍 completed）。完整端口以 `GET /api/v1/group-templates/:id?scope=templates` 为准。
