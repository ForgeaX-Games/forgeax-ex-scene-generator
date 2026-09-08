# RoomLayoutPlacer（室内布局放置）

> templateId（传给 `POST /api/v1/group-templates/:projectId/instantiate`）：`group_room_layout_placer`，也可用 basename `RoomLayoutPlacer`。

把上游场景的足迹切片为房间掩码网格，用 `room_layout_placer` 电池以四种布局模式（grid / nested / symmetric / one_open）放置家具，输出家具实体网格；按值拆分后逐张建为命名场景子节点；输出与其它结构模板一致的五个固定端口。

## 五个固定输出端口（结构契约）

| 方向 | portName | 语义 |
|---|---|---|
| OUT | `out_0` | Scene 完整场景（输入 + 家具子树） |
| OUT | `out_1` | Furniture 家具子树（主产物） |
| OUT | `out_2` | Rest 剩余空地（房间掩码减去家具覆盖） |
| OUT | `out_3` | FurniturePath 家具子节点路径 |
| OUT | `out_4` | RestPath 剩余子节点路径 |

## 主要可见输入端口

| portName | 语义 |
|---|---|
| `in_0` | Scene 上游场景（**必接**） |
| `in_1` | AssetName 资产名 |
| `in_2` | Seed 随机种子 |
| `in_3` | DoorGrid 门位置网格（可选，留空则不预留过道） |
| `in_4` | FurnitureList 家具清单（rank 1-7 主家具，rank 8-9 填充家具；**不接则无家具**） |
| `in_5` | LayoutMode 布局模式（grid / nested / symmetric / one_open） |
| `in_6` | LayoutConfig 模式专属配置 JSON 字符串 |

> `roomGrid` 由内部 `voxel_slice` 切片自动提供；`fillValue / z / schema / token / zRange` 等管线参数默认隐藏。

## 内部管线

`scene_passthrough → node_explode → rect_grid → voxel_slice`（取顶层切片做房间掩码）→ `room_layout_placer`（四模式布局，输出 `outputGrid`）→ `grid_split_by_value` → `grid2node`（按 `AssetName` 命名，挂 `asset_type=tile`）→ `add_child`；同时 `alg_region_subtract`（掩码 − 家具）得到 Rest 子树。最后 `scene_merge_subtrees` 合并并 `scene_focus_path` 分别聚焦，导出五个固定端口。

> 说明：本电池输出的去重 `nameList` 受限于现有命名算子，模板内仍按 `AssetName` 统一命名子节点。

`in_0` 悬空会导致整组静默空跑（execute 仍 completed）。完整端口以 `GET /api/v1/group-templates/:id?scope=templates` 为准。
