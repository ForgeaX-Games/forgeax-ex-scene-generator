# PathConnectionLink（道路连接·连连看）

> templateId（传给 `POST /api/v1/group-templates/:projectId/instantiate`）：`group_1782300000000_pclnk`，也可用 basename `PathConnectionLink`。
> 实例化后返回全新运行时 `groupId`，后续连线一律用返回值。

## 这是什么

`PathConnection` 系列的**连连看（link）变体**。骨架、输入/输出端口与 `PathConnectionRandomWalk` **完全一致**，唯一区别是中间的连点算子：

| 模板 | 核心算子 | 路网风格 |
|---|---|---|
| **PathConnectionRandomWalk** | `alg_topology_connect_points` | Prim MST + 正交 A* 寻路，路线更自然 |
| **PathConnectionLink**（本组） | `road_connect_link` | Prim MST + 连连看折线（最多 2 次转弯，0=直线/1=L形/2=Z/S形），障碍过密时降级 A* 兜底，路线更规整整洁 |

两者输入同一套 POI 点集 + 上游可铺路空间，输出同样的 Path / Rest 两块。需要规整、转弯清晰的棋盘格/田园路网时用本组；要更自然随机的走向时用 RandomWalk 版。

## 输入端口（IN）

| portName | 类型 | 语义 | 必接 | 怎么喂 |
|---|---|---|---|---|
| `in_2` | scene | 上游可铺路空间 | **是** | 上一组 **Rest** |
| `in_3` | point2d (list) | POI 点列表（要被道路连接的点） | **是** | `tree_merge`(item) ← 多个点 |
| `in_0` | string | RoadName（道路图层名） | 建议 | `text_panel` |
| `in_1` | string | RoadAsset（道路资产名，如 `石路`） | 建议 | `text_panel` |
| `in_15` | scene (tree) | **Obstacles** 道路需绕开的障碍场景 | 否 | 任意 Scene（建筑/水体等）→ `in_15`；不接时与原行为一致 |

> 隐藏高级端口：`roadWidth`(in_4)/`roadValue`(in_5) 等默认即可。
> `in_15`(Obstacles) 可选：接入的场景切片成障碍网格后与内部"非可铺路区"求并喂给寻路，道路据此绕行；悬空则无额外障碍。`coverPoi` 由内置 toggle 控制（默认覆盖 POI）。
> `road_connect_link` 另有 `maxTurns`（连连看最大转弯次数，默认 2）参数，模板内取默认值。

## 输出端口（OUT）

| portName | 语义 | 典型去向 |
|---|---|---|
| `out_1` | **Path** 道路领域产物 | 后续道路细化，禁止接 merge |
| `out_2` | **Rest** 非道路/剩余区域 | → 下一组 `in_2`（链式给湖/田/植被） |
| `out_0` | **Scene** 整树汇总口 | `{ "label":"Scene", "portName":"out_0" }` → `appendMergeItem` |
| `out_3`/`out_4` | PathPath / RestPath 路径句柄 | 一般不接 |

## 与 RandomWalk 版互换

因为 `road_connect_link` 已重写为与 `alg_topology_connect_points` 完全一致的 datatree/item I/O（`poiGrid`/`obstacle` 进、`topology` 出、含 `coverPoi`），两个模板可直接互换：把图里的 PathConnectionRandomWalk 换成本组即可得到连连看风格路网，连线无需改动。

> **文档路由说明**：`construction-task-builder.ts` 把 `PathConnectionRandomWalk`（basename `PathConnection`）与 `PathConnectionLink`（本组）两个 templateId **都指向本文档**。也就是说，无论 agent 实例化哪一个，实际接线依据都以本文档为准；`PathConnection/README.md` 已标记 deprecated，仅作历史参考。

---

## 单步独立：最小可跑示例（agent 模仿用）

> 与完整九步链不同：本节**不依赖** M2/M3 具体的建筑/门洞（`outer_door`），用一个全新的独立 20×20 Demo Scene 直接当"可铺路空间"，只验证本模板「Scene + POI 点列表 → 连通道路」的端口语义。完整 M0→M8 九步链（含真实门洞 POI 推理）见 [`battery-chain-template-demo/`](../../../../../../../../aw-support/examples/battery-chain-template-demo/README.md)；agent 模仿总览见 [`agent-imitate.md`](../../../../../../../../aw-support/examples/battery-chain-template-demo/agent-imitate.md)。

### 前置：造一个独立 Demo Scene（可跨模板复用的固定写法）

```json
{ "method":"POST","path":"/api/v1/group-templates/<projectId>/instantiate","caller":{"kind":"workbench"},
  "args":{ "templateId":"AddBaseGrid", "groupId":"demo_abg", "position":{"x":-800,"y":0},
           "opts":{"actor":"ai:sino","label":"实例化 AddBaseGrid（独立 demo scene）"} } }
```

```jsonc
{ "type":"createNode","nodeId":"demo_empty","opId":"empty_scene","params":{} },
{ "type":"createNode","nodeId":"demo_name", "opId":"text_panel","params":{"text":"demo_ground"} },
{ "type":"createNode","nodeId":"demo_w",    "opId":"number_const","params":{"value":20} },
{ "type":"createNode","nodeId":"demo_h",    "opId":"number_const","params":{"value":20} },
{ "type":"createNode","nodeId":"demo_asset","opId":"text_panel","params":{"text":"草地"} },
{ "type":"connect","edgeId":"e_demo_scene","source":{"nodeId":"demo_empty","port":"scene"}, "target":{"nodeId":"demo_abg","port":"in_0"} },
{ "type":"connect","edgeId":"e_demo_name", "source":{"nodeId":"demo_name","port":"output"}, "target":{"nodeId":"demo_abg","port":"in_1"} },
{ "type":"connect","edgeId":"e_demo_w",    "source":{"nodeId":"demo_w","port":"value"},     "target":{"nodeId":"demo_abg","port":"in_2"} },
{ "type":"connect","edgeId":"e_demo_h",    "source":{"nodeId":"demo_h","port":"value"},     "target":{"nodeId":"demo_abg","port":"in_3"} },
{ "type":"connect","edgeId":"e_demo_asset","source":{"nodeId":"demo_asset","port":"output"},"target":{"nodeId":"demo_abg","port":"in_4"} }
```

`demo_abg.out_1`（单分支，无需 `tree_flatten`）即为下面 PathConnection 的 `in_2`。

### 端口 → opId → 默认参数（模式化生成依据）

| in_* 端口 | 白名单 opId | 必接 | 默认值/示例 | 备注 |
|---|---|---|---|---|
| `in_2` | 上游 `out_*` | 必接 | `demo_abg.out_1` | 可铺路空间；单分支场景可直连，无需 `scene_focus_path` |
| `in_3` | `manual_points`×N → `tree_merge`(item,point2d,N) | 必接 | `{5,5}` `{15,15}` | POI 点列表，须落在 20×20 内 |
| `in_0` | `text_panel` | 建议 | `"demo_road"` | RoadName |
| `in_1` | `text_panel` | 建议 | `"石路"` | RoadAsset（图层名即用此值渲染） |
| `in_15` | 上游 `out_*` | 可选 | 不接 | Obstacles，独立示例无建筑可绕，留空 |

### applyBatch 片段（可直接照抄）

```json
{ "method":"POST","path":"/api/v1/group-templates/<projectId>/instantiate","caller":{"kind":"workbench"},
  "args":{ "templateId":"PathConnectionLink", "groupId":"demo_path", "position":{"x":-400,"y":1200},
           "opts":{"actor":"ai:sino","label":"实例化 PathConnectionLink"} } }
```

```jsonc
{ "type":"createNode","nodeId":"path_name",  "opId":"text_panel","params":{"text":"demo_road"} },
{ "type":"createNode","nodeId":"path_asset", "opId":"text_panel","params":{"text":"石路"} },
{ "type":"createNode","nodeId":"path_pt_1",  "opId":"manual_points","params":{"x":5,"y":5} },
{ "type":"createNode","nodeId":"path_pt_2",  "opId":"manual_points","params":{"x":15,"y":15} },
{ "type":"createNode","nodeId":"path_poi_merge","opId":"tree_merge","params":{"inferredAccess":"item","inferredType":"point2d","portCount":2} },
{ "type":"connect","edgeId":"e_path_scene","source":{"nodeId":"demo_abg","port":"out_1"},"target":{"nodeId":"demo_path","port":"in_2"} },
{ "type":"connect","edgeId":"e_path_name", "source":{"nodeId":"path_name","port":"output"},"target":{"nodeId":"demo_path","port":"in_0"} },
{ "type":"connect","edgeId":"e_path_asset","source":{"nodeId":"path_asset","port":"output"},"target":{"nodeId":"demo_path","port":"in_1"} },
{ "type":"connect","edgeId":"e_path_pt1",  "source":{"nodeId":"path_pt_1","port":"point"},"target":{"nodeId":"path_poi_merge","port":"item_0"} },
{ "type":"connect","edgeId":"e_path_pt2",  "source":{"nodeId":"path_pt_2","port":"point"},"target":{"nodeId":"path_poi_merge","port":"item_1"} },
{ "type":"connect","edgeId":"e_path_pois", "source":{"nodeId":"path_poi_merge","port":"tree"},"target":{"nodeId":"demo_path","port":"in_3"} }
```

**验收**：execute 后 `demo_path.out_1`（Path）非空，图层出现 `石路`；`demo_path.out_2`（Rest）为剩余非道路区域。
