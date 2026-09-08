# PickMultiBuildings（多点建筑）

> templateId（传给 `POST /api/v1/group-templates/:projectId/instantiate`）：`group_1781857569273_sw86m`，也可用 basename `PickMultiBuildings`。

一次放置**多栋**建筑（points 列表 + 各栋宽高/高度/资产）。**城镇补充散布**：读 runDir `town-building-scatter.json` 的 `supplementaryBuildings[]`，`BuildingAssets` 必须来自 catalog `itemName`，每栋 footprint ≥10×10。

**接线**：`out_2`(Buildings) → `BuildingStructures.in_0`；`out_1`(Rest) → 下一批 `in_6`(Scene) 或下一组 `AreaPartition.in_0`。

## 主要可见端口

| 方向 | portName | 语义 |
|---|---|---|
| IN | `in_6` | Scene 上游场景 |
| IN | `in_5` | points 多点列表 |
| IN | `in_0` / `in_1` | AreaWidths / AreaHeights |
| IN | `in_2` / `in_3` | BuildingHeights |
| IN | `in_4` | BuildingAssets |
| IN | `in_13` | seed |
| OUT | `out_2` | Buildings 建筑区域（主产物） |
| OUT | `out_0` | BuildingsPaths |
| OUT | `out_1` | Rest 剩余空地 |

完整端口以 `GET /api/v1/group-templates/:id?scope=templates` 为准。
