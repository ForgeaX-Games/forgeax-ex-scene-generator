# BuildingStructures（建筑结构）

> templateId（传给 `POST /api/v1/group-templates/:projectId/instantiate`）：`group_1781831816652_3k380`，也可用 basename `BuildingStructures`。

在已有**建筑区域**上生成墙体/房间结构（含 `outer_door` 门子节点，供道路 POI 聚焦）。

> **Rooms 高度**：`out_1` Rooms 子节点只占用 **建筑最低 z 再往下 1 层**（`min(zRange) - 1`）的地板区域，不再贯穿整栋建筑高度；墙体/门/窗仍使用完整 `zRange`。  
> **上游墙高**：zRange 来自 `PickOneBuilding.in_2`（BuildingHeight）。叙事内构须 **≤3（默认 3）**；过高请回改 PickOne，不要在本组抬高。

## 主要可见端口

| 方向 | portName | 语义 |
|---|---|---|
| IN | `in_0` | Scene 建筑区域（接 `PickOneBuilding.out_1` 或 `PickMultiBuildings.out_2`） |
| IN | `in_23` | WallAsset 墙体资产名 |
| IN | `in_24` | Seed（**必接** `aw_m0_seed.seed`，禁止 0/悬空；以 instantiate 返回的 `label:"Seed"` 口为准） |
| IN | `in_1` | bottomDoor — **叙事内构默认 true**（门位于建筑下侧；Sino checklist `structureParams.bottomDoor`） |
| OUT | `out_0` | Scene 含结构的建筑场景（主产物） |
| OUT | `out_1` / `out_2` | Rooms / RoomsPath |

完整端口以 `GET /api/v1/group-templates/:id?scope=templates` 为准。

> **实测端口（验证链 `p_mr4b9s3j_dycp8k/step-m3-buildingstructures.json`）**：本模板真正必接只有 `in_0`（Scene 建筑区域）与 `in_1`（Seed），其余 `in_23`/`in_24` 等 hidden 参数用默认即可，无需额外接线。

---

## 单步独立：最小可跑示例（agent 模仿用）

> 本模板语义依赖「已有建筑区域」，无法真正零依赖独立；因此最小前置是 **2 步**（AddBaseGrid → PickOneBuilding），而不是完整九步链的具体命名。完整 M0→M8 九步链见 [`battery-chain-template-demo/`](../../../../../../../../aw-support/examples/battery-chain-template-demo/README.md)；agent 模仿总览见 [`agent-imitate.md`](../../../../../../../../aw-support/examples/battery-chain-template-demo/agent-imitate.md)。

### 前置：造一栋独立 Demo 建筑（AddBaseGrid → PickOneBuilding）

```json
{ "method":"POST","path":"/api/v1/group-templates/<projectId>/instantiate","caller":{"kind":"workbench"},
  "args":{ "templateId":"AddBaseGrid", "groupId":"demo_abg", "position":{"x":-800,"y":0},
           "opts":{"actor":"ai:sino","label":"实例化 AddBaseGrid（独立 demo scene）"} } }
{ "method":"POST","path":"/api/v1/group-templates/<projectId>/instantiate","caller":{"kind":"workbench"},
  "args":{ "templateId":"PickOneBuilding", "groupId":"demo_pk", "position":{"x":-400,"y":600},
           "opts":{"actor":"ai:sino","label":"实例化 PickOneBuilding"} } }
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
{ "type":"connect","edgeId":"e_demo_asset","source":{"nodeId":"demo_asset","port":"output"},"target":{"nodeId":"demo_abg","port":"in_4"} },
{ "type":"createNode","nodeId":"pk_name",  "opId":"text_panel","params":{"text":"demo_building"} },
{ "type":"createNode","nodeId":"pk_asset", "opId":"text_panel","params":{"text":"草地"} },
{ "type":"createNode","nodeId":"pk_pt",    "opId":"manual_points","params":{"x":10,"y":10} },
{ "type":"createNode","nodeId":"pk_w",     "opId":"number_const","params":{"value":6} },
{ "type":"createNode","nodeId":"pk_h",     "opId":"number_const","params":{"value":6} },
{ "type":"createNode","nodeId":"pk_height","opId":"number_const","params":{"value":3} },
{ "type":"createNode","nodeId":"pk_seed",  "opId":"seed_control","params":{"seed":42} },
{ "type":"connect","edgeId":"e_pk_scene","source":{"nodeId":"demo_abg","port":"out_1"},"target":{"nodeId":"demo_pk","port":"in_1"} },
{ "type":"connect","edgeId":"e_pk_name", "source":{"nodeId":"pk_name","port":"output"},"target":{"nodeId":"demo_pk","port":"in_0"} },
{ "type":"connect","edgeId":"e_pk_asset","source":{"nodeId":"pk_asset","port":"output"},"target":{"nodeId":"demo_pk","port":"in_4"} },
{ "type":"connect","edgeId":"e_pk_pt",   "source":{"nodeId":"pk_pt","port":"point"},"target":{"nodeId":"demo_pk","port":"in_3"} },
{ "type":"connect","edgeId":"e_pk_w",    "source":{"nodeId":"pk_w","port":"value"},"target":{"nodeId":"demo_pk","port":"in_5"} },
{ "type":"connect","edgeId":"e_pk_h",    "source":{"nodeId":"pk_h","port":"value"},"target":{"nodeId":"demo_pk","port":"in_6"} },
{ "type":"connect","edgeId":"e_pk_height","source":{"nodeId":"pk_height","port":"value"},"target":{"nodeId":"demo_pk","port":"in_2"} },
{ "type":"connect","edgeId":"e_pk_seed", "source":{"nodeId":"pk_seed","port":"seed"},"target":{"nodeId":"demo_pk","port":"in_14"} }
```

`demo_pk.out_1`（Building 建筑区域）即为下面 BuildingStructures 的 `in_0`。

### 端口 → opId → 默认参数（模式化生成依据）

| in_* 端口 | 白名单 opId | 必接 | 默认值/示例 | 备注 |
|---|---|---|---|---|
| `in_0` | 上游 `out_*` | 必接 | `demo_pk.out_1` | 已有的建筑区域（Building） |
| `in_1` | `seed_control` | 必接 | `42` | 实测该端口即为 Seed（与全局 seed 扇出一致），无需额外拆分 bottomDoor |

其余 hidden 参数（`in_23` WallAsset 等）不接则用组内默认。

### applyBatch 片段（可直接照抄）

```json
{ "method":"POST","path":"/api/v1/group-templates/<projectId>/instantiate","caller":{"kind":"workbench"},
  "args":{ "templateId":"BuildingStructures", "groupId":"demo_bs", "position":{"x":-400,"y":900},
           "opts":{"actor":"ai:sino","label":"实例化 BuildingStructures"} } }
```

```jsonc
{ "type":"connect","edgeId":"e_bs_in",  "source":{"nodeId":"demo_pk","port":"out_1"},"target":{"nodeId":"demo_bs","port":"in_0"} },
{ "type":"connect","edgeId":"e_bs_seed","source":{"nodeId":"pk_seed","port":"seed"},"target":{"nodeId":"demo_bs","port":"in_1"} }
```

**验收**：execute 后 `demo_bs.out_0` 子树应含 `outer_door`、`outer_wall`、`inner_wall`、`room_0` 等结构节点；`out_1` Rooms 子节点应存在。
