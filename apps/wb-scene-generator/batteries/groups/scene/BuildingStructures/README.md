# BuildingStructures（建筑结构）

> templateId（传给 `POST /api/v1/group-templates/:projectId/instantiate`）：`group_1781831816652_3k380`，也可用 basename `BuildingStructures`。

在已有**建筑区域**上生成墙体/房间结构（含 `outer_door` 门子节点，供道路 POI 聚焦）。

> **Rooms 高度**：`out_1` Rooms 子节点只占用 **建筑最低 z 再往下 1 层**（`min(zRange) - 1`）的地板区域，不再贯穿整栋建筑高度；墙体/门/窗仍使用完整 `zRange`。

## 主要可见端口

| 方向 | portName | 语义 |
|---|---|---|
| IN | `in_0` | Scene 建筑区域（接 `PickOneBuilding.out_1` 或 `PickMultiBuildings.out_2`） |
| IN | `in_23` | WallAsset 墙体资产名 |
| IN | `in_24` | Seed |
| IN | `in_1` | bottomDoor（hidden 默认，按需） |
| OUT | `out_0` | Scene 含结构的建筑场景（主产物） |
| OUT | `out_1` / `out_2` | Rooms / RoomsPath |

完整端口以 `GET /api/v1/group-templates/:id?scope=templates` 为准。
