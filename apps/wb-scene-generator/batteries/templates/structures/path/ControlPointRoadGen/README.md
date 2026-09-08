# 主要功能及适用场景

给一串控制点，在上游 Scene 的可铺路足迹内生成一条**依次严格穿过每一个控制点**的平滑曲线道路（C2 曲率连续的自然三次样条，向心参数化），挂成命名的 `asset_type=tile` 子节点，并同时产出扣掉道路后的剩余空地（Rest）。

适合：已经知道道路要经过哪几个位置（村口、桥头、岔路锚点、地图边界入口）时手工规划一条主路；沿地形走势铺蜿蜒小径；多实例串 Rest 逐条加路。

不适合：只知道要连通哪些 POI、走向交由算法决定的道路网（改用同目录 `PathConnection` / `PathConnectionLink`，MST + A\* 正交寻路）；需要绕开建筑等障碍的寻路（本模板按给定控制点直接铺，不做避障）；需要随机蜿蜒河道（改用 `structures/water/RiverSpline`）。

> templateId：`group_control_point_road_gen`，也可用 basename `ControlPointRoadGen`。

# 端口介绍

## 主要端口

| 方向 | 端口 | 语义 |
|---|---|---|
| IN | Scene (`in_0`) | 上游可铺路场景（**必接**；悬空则整组静默空跑） |
| IN | RoadAsset (`in_1`) | 道路资产名，写入道路子节点名与 `asset_name`（如 `石路`） |
| IN | Points (`in_2`) | 控制点，`point2d`/`access:list`（**必填**，至少 2 个不重复点），道路依次穿过 |
| IN | RoadWidth (`in_3`) | 道路宽度（格），光栅化圆笔刷直径，默认 `2` |
| OUT | Scene (`out_0`) | 整棵场景树（输入 + 道路 + 剩余空地），接 SceneOutput 或下一模板 |
| OUT | Path (`out_1`) | 道路子树（主产物），聚焦到道路子节点；禁止接 merge |
| OUT | Rest (`out_2`) | 剩余空地（足迹减去道路），链式起点，接下一模板 `in_0` |

## 其他参数

| 方向 | 端口 | 语义 |
|---|---|---|
| IN | Tension (`in_4`) | 曲线张力 `[0,1]`，`0` 保留完整样条曲率（默认）、`1` 退化为直折线 |
| IN | Roundness (`in_13`) | 圆滑增益 `[0,2.5]`，默认 `1.3`；`1` = 标准自然样条，>1 拓宽回折处的转弯半径（道路会小幅甩出控制点连线，更接近真实道路），过大容易甩出足迹被裁断 |
| IN | SamplesPerSegment (`in_5`) | 每两个控制点之间的样条采样数，默认 `24` |
| IN | ClipToFootprint (`in_6`) | 是否把道路裁剪在上游足迹内，默认 `true` |
| IN | ReinforceJoints (`in_14`) | 是否在道路换向的台阶处补格加固接缝，默认 `true`；关掉则接缝可能只靠一格搭接 |
| OUT | PathPath (`out_3`) | 道路子节点路径句柄，配合 `scene_focus_path` 索引 |
| OUT | RestPath (`out_4`) | 剩余空地路径句柄 |

> `ReinforceJoints` 只在换向台阶处补格，连续 45° 斜路不会被加粗；实测每 3 行错一格的陡坡道路格数 +25%，纯 45° 斜路 +0%。补格受足迹裁剪约束，`Rest` 仍与 `Path` 严格互补。

> 隐藏端口 `in_7`(道路填充值) / `in_8`(基准网格填充值) / `in_9`(切片 z) / `in_10..in_12`(grid2node schema / token / zRange) 默认即可。

# 特殊规则

1. **`in_0` 与 `in_2` 必接。** 任一悬空整组静默空跑（`execute` 仍报 `completed`）。验收判据：`out_1` 非空、图层里出现 RoadAsset 命名的 tile。
2. **控制点是格坐标 `[col,row]`，且必须落在上游足迹内。** 落在足迹外的曲线段会被 `ClipToFootprint` 裁掉；控制点全在足迹外时道路为空。`in_2` 是 `point2d`/`access:list`，两种接法都行：画布上用多个 `pt2_construct` → `tree_merge` 汇成点集（推荐，可视化调点）；或直接接 `text_panel` 填 JSON 字符串（如 `[[4,4],[14,30],[26,8],[35,34]]`），也接受 `[{x,y},...]`。
3. **顺序即走向，不做重排。** 曲线按给定顺序穿点，支持回折路线；这一点与 `river_spline`（会随机扰动并按 x 重排）不同。
4. **无 Seed，完全确定性。** 内部电池 `polyline_road_spline` 不含随机成分，同输入必得同输出；想改走向就改控制点或 `Tension` / `Roundness`。
5. **平滑度上限由控制点决定。** 曲线严格穿点，所以控制点若构成近 180° 回折，该点处必然急转——只能靠 `Roundness` 把转弯半径拓宽，无法变成大弧；想要更缓的走向就减少或移动控制点。
6. **`Path` 与 `Rest` 恰好互补。** 道路格数 + 剩余格数 = 上游足迹格数（实测 40×40 全 1 足迹、`RoadWidth=3`：道路 252 + 剩余 1348 = 1600）。
7. **道路只占一层。** 内部取上游体素的顶层切片做基准网格，道路与剩余空地都写在该层。

# 使用示例

完整 graph JSON（`nodes` + `edges`）。`ControlPointRoadGen` 是模板组（`__group__`），需先用 basename `ControlPointRoadGen` 调 `instantiateTemplate`，把返回的运行时 groupId 替换掉下面的 `cpr`，再按 `edges` 接线。

```json
{
  "nodes": [
    { "id": "ground", "opId": "grid2node", "position": { "x": 0, "y": 0 }, "params": { "name": "空地", "grid": [[1, 1], [1, 1]] } },
    { "id": "road_name", "opId": "text_panel", "position": { "x": 0, "y": 120 }, "params": { "text": "石路" } },
    { "id": "road_pts", "opId": "text_panel", "position": { "x": 0, "y": 240 }, "params": { "text": "[[4,4],[14,30],[26,8],[35,34]]" } },
    { "id": "road_w", "opId": "number_const", "position": { "x": 0, "y": 360 }, "params": { "value": 3 } },
    {
      "id": "cpr",
      "opId": "__group__",
      "name": "ControlPointRoadGen",
      "position": { "x": 500, "y": 0 },
      "params": {
        "groupId": "cpr",
        "__groupIsTemplate": true,
        "__groupSourceGroupId": "group_control_point_road_gen",
        "__groupSourceCategory": "structures",
        "__groupSourceBatteryName": "ControlPointRoadGen"
      }
    }
  ],
  "edges": [
    { "id": "e_scene", "source": { "nodeId": "ground", "port": "scene" }, "target": { "nodeId": "cpr", "port": "in_0" } },
    { "id": "e_name", "source": { "nodeId": "road_name", "port": "output" }, "target": { "nodeId": "cpr", "port": "in_1" } },
    { "id": "e_pts", "source": { "nodeId": "road_pts", "port": "output" }, "target": { "nodeId": "cpr", "port": "in_2" } },
    { "id": "e_w", "source": { "nodeId": "road_w", "port": "value" }, "target": { "nodeId": "cpr", "port": "in_3" } }
  ]
}
```

> 上例中 `ground` 的 `grid` 用真实足迹网格替换（示例里写成 2×2 仅为占位）。执行后预期：`out_1` 聚焦到名为 `石路`、`asset_type=tile` 的道路子节点，`out_3` = `/空地/石路`，`out_4` = `/空地/rest`。继续施工时把 `out_2`（Rest）接到下一模板的 `in_0`。
