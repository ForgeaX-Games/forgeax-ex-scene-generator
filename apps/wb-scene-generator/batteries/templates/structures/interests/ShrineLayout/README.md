# ShrineLayout（祭坛）

> templateId（传给 `POST /api/v1/group-templates/:projectId/instantiate`）：`group_shrine_layout`，也可用 basename `ShrineLayout`。

把上游场景的足迹切片为区域掩码网格，用 `shrine_layout` 电池生成神殿/空地/竞技场布局（多值网格），按值拆分后逐张建为命名场景子节点；输出与其它结构模板一致的五个固定端口。

## 五个固定输出端口（结构契约）

| 方向 | portName | 语义 |
|---|---|---|
| OUT | `out_0` | Scene 完整场景（输入 + 祭坛子树） |
| OUT | `out_1` | Shrine 祭坛子树（主产物，1=外围墙/2=地板/3=中心焦点/4=神坛/5=装饰位） |
| OUT | `out_2` | Rest 剩余空地（掩码减去祭坛覆盖） |
| OUT | `out_3` | ShrinePath 祭坛子节点路径 |
| OUT | `out_4` | RestPath 剩余子节点路径 |

## 主要可见输入端口

| portName | 语义 |
|---|---|
| `in_0` | Scene 上游场景（**必接**） |
| `in_1` | AssetName 资产名 |
| `in_2` | Seed 随机种子（控制祭坛朝向） |
| `in_3` | Algorithm 布局类型（clearing / cruciform / arena） |
| `in_4` | DecorCount 装饰点数量（clearing / arena 模式） |
| `in_5` | PathWidth 墙体厚度（cruciform 模式） |

> `fillValue / z / schema / token / zRange` 等管线参数默认隐藏。

## 内部管线

`scene_passthrough → node_explode → rect_grid → voxel_slice`（取顶层切片做掩码）→ `shrine_layout`（多值布局网格）→ `grid_split_by_value` → `grid2node`（按 `AssetName` 命名，挂 `asset_type=tile`）→ `add_child`；同时 `alg_region_subtract`（掩码 − 祭坛）得到 Rest 子树。最后 `scene_merge_subtrees` 合并并 `scene_focus_path` 分别聚焦，导出五个固定端口。

`in_0` 悬空会导致整组静默空跑（execute 仍 completed）。完整端口以 `GET /api/v1/group-templates/:id?scope=templates` 为准。
