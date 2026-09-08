# FenceFarm（栅栏农场）

> templateId（传给 `POST /api/v1/group-templates/:projectId/instantiate`）：`group_fence_farm`，也可用 basename `FenceFarm`。

把上游场景的足迹切片为区域掩码网格，用 `fence_farm` 电池生成农场栅栏布局（外围围栏 / 分区围栏 / 独立围栏，含栅栏门，多值网格），按值拆分后逐张建为命名场景子节点；输出与其它结构模板一致的五个固定端口。

## 五个固定输出端口（结构契约）

| 方向 | portName | 语义 |
|---|---|---|
| OUT | `out_0` | Scene 完整场景（输入 + 栅栏子树） |
| OUT | `out_1` | Fence 栅栏子树（主产物，1=内部地面/2=栅栏/3=栅栏门） |
| OUT | `out_2` | Rest 剩余空地（掩码减去栅栏覆盖） |
| OUT | `out_3` | FencePath 栅栏子节点路径 |
| OUT | `out_4` | RestPath 剩余子节点路径 |

## 主要可见输入端口

| portName | 语义 |
|---|---|
| `in_0` | Scene 上游场景（**必接**） |
| `in_1` | AssetName 资产名 |
| `in_2` | Seed 随机种子 |
| `in_3` | FenceMode 栅栏形式（border / sections / plots） |
| `in_4` | GateCount 栅栏门数量（border 模式） |
| `in_5` | SectionCount 分区数量（sections 模式） |
| `in_6` | GateWidth 栅栏门宽度（sections 模式） |
| `in_7` | PlotWidth 围栏地块宽度（plots 模式） |
| `in_8` | PlotHeight 围栏地块高度（plots 模式） |

> `fillValue / z / schema / token / zRange` 等管线参数默认隐藏。

## 内部管线

`scene_passthrough → node_explode → rect_grid → voxel_slice`（取顶层切片做掩码）→ `fence_farm`（多值栅栏网格）→ `grid_split_by_value` → `grid2node`（按 `AssetName` 命名，挂 `asset_type=tile`）→ `add_child`；同时 `alg_region_subtract`（掩码 − 栅栏）得到 Rest 子树。最后 `scene_merge_subtrees` 合并并 `scene_focus_path` 分别聚焦，导出五个固定端口。

`in_0` 悬空会导致整组静默空跑（execute 仍 completed）。完整端口以 `GET /api/v1/group-templates/:id?scope=templates` 为准。
