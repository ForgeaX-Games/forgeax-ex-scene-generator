# 主要功能及适用场景

在上游 Scene（空地 / Rest）的底面区域内，按规则随机散布兴趣点（POI），每个点挂成独立的 1×1 场景子节点并写入 `asset_name`，同时产出剩余空地（Rest）。

适合：洞穴 / 营火 / 草木等点状地标的随机落点；一组内混放多种资产；多实例 Rest 串联逐层加 POI。

不适合：需要改写周边地形足迹的布置（下游另接足迹写回）；大片背景植被填充（改用 `NaturalDecorationDistribution`）。

> templateId：`group_1782200000002_poisc`，也可用 basename `PoiScatter`。

# 端口介绍

## 主要端口

| 方向 | 端口 | 语义 |
|---|---|---|
| IN | Scene (`in_0`) | 上游可放置区域（**必接**；悬空则整组静默空跑） |
| IN | AssetName (`in_1`) | POI 资产名，单个或列表；写入各 POI 节点的 `asset_name` |
| IN | PoiRules (`in_2`) | POI 规则，单条或列表；值格式 `targetValue:count:minDistance` |
| OUT | Scene (`out_0`) | 整棵场景树（主输出，接 SceneOutput） |
| OUT | Poi (`out_1`) | POI 层（主产物；N 个 1×1 子节点 `poi0…`） |
| OUT | Rest (`out_2`) | 剩余空地；可接下一实例 `Scene` |

## 其他参数

| 方向 | 端口 | 语义 |
|---|---|---|
| IN | Seed (`in_3`) | 随机种子；不接则内部默认 |
| OUT | PoiPath (`out_3`) | POI 层路径句柄 |
| OUT | RestPath (`out_4`) | 剩余空地路径句柄 |

# 特殊规则

1. **单条 / 批量同一端口，直接接 Panel，无需 `str_to_list`。**

   | 用法 | PoiRules | AssetName |
   |---|---|---|
   | 单独 | `樱花树:1:6:4` 或 `{"樱花树":"1:6:4"}` | `樱花树` |
   | 批量 | `浮萍:1:6:4;水草:1:6:4;…` 或 JSON 数组 | `浮萍,水草,…`（`，` `；` `[a,b]` 均可） |

2. **规则与资产按下标对应。** 第 i 条规则用第 i 个资产名；只给一个资产名则广播到全部规则；AssetName 悬空则用规则名当资产名。规则之间用分号 / 换行，规则内部 `targetValue:count:minDistance` 用冒号或逗号。

3. **逐点成节点。** `Poi` 下是 N 个 1×1 子节点，不是一个占 N 格的节点。Asset 视图对 `asset_type=object` 整层只画一张贴图，合节点只会显示一个物件。

4. **POI 落在地面之上一层。** 内部 `zRange = [voxel_slice.z + 1]`，避免与地面同层时 object 贴图下半截被立面盖掉。

5. **多实例串联。** `Rest` → 下一实例 `Scene`。

# 使用方法

与同目录 `usage.png` 一致的完整 graph JSON（`nodes` + `edges`）。可直接作为 `kernel-graph-v1` 外层图读取；`AddBaseGrid` / `PoiScatter` 为模板组（`__group__`），需先 `instantiateTemplate`（basename `AddBaseGrid` / `PoiScatter`）再按下列边接线，或导入时附带对应 `groups`。

```json
{
  "nodes": [
    { "id": "empty", "opId": "empty_scene", "position": { "x": 0, "y": 0 }, "params": {} },
    {
      "id": "abg",
      "opId": "__group__",
      "name": "AddBaseGrid",
      "position": { "x": 260, "y": 0 },
      "params": {
        "groupId": "abg",
        "__groupIsTemplate": true,
        "__groupSourceGroupId": "group_1781266146700_dm7xl",
        "__groupSourceCategory": "general",
        "__groupSourceBatteryName": "AddBaseGrid"
      }
    },
    { "id": "bname", "opId": "text_panel", "position": { "x": 0, "y": 90 }, "params": { "text": "test" } },
    { "id": "bw", "opId": "number_const", "position": { "x": 0, "y": 170 }, "params": { "value": 32 } },
    { "id": "bh", "opId": "number_const", "position": { "x": 0, "y": 230 }, "params": { "value": 20 } },
    { "id": "basset", "opId": "text_panel", "position": { "x": 0, "y": 290 }, "params": { "text": "青草地" } },
    {
      "id": "ps",
      "opId": "__group__",
      "name": "PoiScatter",
      "position": { "x": 670, "y": 120 },
      "params": {
        "groupId": "ps",
        "__groupIsTemplate": true,
        "__groupSourceGroupId": "group_1782200000002_poisc",
        "__groupSourceCategory": "structures",
        "__groupSourceBatteryName": "PoiScatter"
      }
    },
    { "id": "asset", "opId": "text_panel", "position": { "x": 320, "y": 200 }, "params": { "text": "浮萍,水草,白曼陀罗草,秧苗" } },
    { "id": "rules", "opId": "text_panel", "position": { "x": 280, "y": 290 }, "params": { "text": "浮萍:1:6:4;水草:1:6:4;白曼陀罗草:1:6:4;秧苗:1:6:4;" } }
  ],
  "edges": [
    { "id": "e_empty_abg", "source": { "nodeId": "empty", "port": "scene" }, "target": { "nodeId": "abg", "port": "in_0" } },
    { "id": "e_bname", "source": { "nodeId": "bname", "port": "output" }, "target": { "nodeId": "abg", "port": "in_1" } },
    { "id": "e_bw", "source": { "nodeId": "bw", "port": "value" }, "target": { "nodeId": "abg", "port": "in_2" } },
    { "id": "e_bh", "source": { "nodeId": "bh", "port": "value" }, "target": { "nodeId": "abg", "port": "in_3" } },
    { "id": "e_basset", "source": { "nodeId": "basset", "port": "output" }, "target": { "nodeId": "abg", "port": "in_4" } },
    { "id": "e_abg_ps", "source": { "nodeId": "abg", "port": "out_1" }, "target": { "nodeId": "ps", "port": "in_0" } },
    { "id": "e_asset", "source": { "nodeId": "asset", "port": "output" }, "target": { "nodeId": "ps", "port": "in_1" } },
    { "id": "e_rules", "source": { "nodeId": "rules", "port": "output" }, "target": { "nodeId": "ps", "port": "in_2" } }
  ]
}
```
