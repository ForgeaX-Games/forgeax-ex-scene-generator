# PickOneBuilding（单点建筑）

> templateId（传给 `POST /api/v1/group-templates/:projectId/instantiate`）：`group_1781806910509_ac8a1`，也可用 basename `PickOneBuilding`。

在指定坐标放置**一栋**建筑区域（点位 + 宽高 + 资产名）。与 `PickMultiBuildings`（多点批量）互补。

**尺寸**：`layoutMode=narrative_interior` 时 AreaWidth/AreaHeight **≥15×15**（与 catalog footprint 取 max）；装饰外观 ≥10×10。接 `BuildingStructures` 前须 execute 验证 footprint。  
**高度**：`in_2` BuildingHeight（竖向格数）— **叙事内构默认 `3` 且不得超过 `3`**（游戏性：可进入建筑墙不宜过高）；勿与 AreaHeight（占地纵深）混淆。

## 主要可见端口

| 方向 | portName | 语义 |
|---|---|---|
| IN | `in_3` | Point 点位（`manual_points` → point） |
| IN | `in_1` | Scene 上游场景 |
| IN | `in_5` / `in_6` | AreaWidth / AreaHeight |
| IN | `in_0` / `in_4` | BuildingName / BuildingAsset |
| IN | `in_2` | BuildingHeight |
| OUT | `out_1` | Building 建筑区域（主产物） |
| OUT | `out_3` | BuildingPath 路径句柄 |
| OUT | `out_2` | Rest 剩余空地 |

其余 `in_*` 为 hidden 高级参数，默认即可。完整端口以 `GET /api/v1/group-templates/:id?scope=templates` 为准。

---

## 如何用命令调用（输入侧）

> 文档标准见 [`../_DOC_STANDARD.md`](../_DOC_STANDARD.md)。人类/Workbench 可从 Templates 面板拖入，再通过编辑器接线。

### 通道 A · 实例化

```json
{ "method": "POST", "path": "/api/v1/group-templates/<projectId>/instantiate", "caller": { "kind": "workbench" },
  "args": { "projectId": "<pid>", "templateId": "PickOneBuilding", "groupId": "verify_pk1",
            "position": { "x": -400, "y": 600 },
            "opts": { "actor": "ai:sino", "label": "实例化 PickOneBuilding" } } }
```

### 通道 B · 必接输入（白名单 opId → 本组端口）

| 本端口 | 白名单上游 | 怎么喂 |
|--------|-----------|--------|
| `in_1` | 上游 Scene / Rest 暴露口 | **默认**上一组 `{ label:"Rest" }` 或任务 `sceneAnchor` **直接**接本口（组壳对组壳）。仅当必须按**命名路径**取某一子区（非 Rest 口）时，才在组外用 `scene_focus_path`。禁止挖本组内部找 focus/manual_points。 |
| `in_0` | `text_panel` | **BuildingName**（叙事名，如 `望江客栈`）— **不是** `in_2` |
| `in_4` | `text_panel` | BuildingAsset（catalog object/tile 名） |
| `in_3` | `manual_points` | Point `{x,y}`，子区内偏南示例 `{28,24}` |
| `in_5` / `in_6` | `number_const` | AreaWidth × AreaHeight，叙事内构 **≥15×15**；验证链用 **18×16**（故意非正方形） |
| `in_2` | `number_const` | BuildingHeight（竖向格）；**叙事内构 ≤3，默认 3** |
| `in_14` | `seed_control` / **`aw_m0_seed.seed`** | **必接**全局固定非 0 Seed（禁止悬空/`seed:0`） |

完整 ops 见验证报告 `aw-support/battery-verify/<projectId>/step-m2-pickonebuilding.json`。

---

## 如何用命令消费输出（输出侧）

| 本端口 | 典型下游 | 白名单 opId | 禁止 |
|--------|---------|-------------|------|
| `out_1` | BuildingStructures | `connect` → `BuildingStructures.in_0` | **禁止**接 Rest 或 Path `in_2` |
| `out_2` | PathConnection / 下一栋 | `connect` → Path `in_2` 或下一 Pick `in_1` | 禁止对 `out_2` 再 instantiate 模板 |
| `out_3` | 门洞 POI 链 | `string_concat` + `scene_focus_path` + `node_explode` | 禁止手拍 `/outer_door` 坐标 |

---

## 已验证调用示例

| 项 | 值 |
|---|---|
| **projectId** | `p_mr4b9s3j_dycp8k` |
| **报告** | [`step-m2-pickonebuilding.json`](../../../../../../aw-support/battery-verify/p_mr4b9s3j_dycp8k/step-m2-pickonebuilding.json) |
| **groupId** | `verify_pk1` |
| **参数** | 子区 `/父区域/划分子区域1`；点 `{28,24}`；**18×16**；名 `望江客栈` |

**headless 验收（execute 后）：**

```bash
PID=p_mr4b9s3j_dycp8k
curl -s -X POST "http://127.0.0.1:9557/api/v1/projects/$PID/execute" \
  -H 'content-type: application/json' -H 'x-forgeax-caller-kind: workbench' \
  -d '{"narrativeLocationNames":["父区域","望江客栈"]}' \
  | jq '.outputs.verify_pk1.out_1[0].items[0].tree.children[].name'
# 预期含：望江客栈
```

单链顺序：M0 AddBaseGrid → M1 AreaPartition → **M2 PickOneBuilding** → M3 BuildingStructures → …

---

## 单步独立：最小可跑示例（agent 模仿用）

> 与上文「已验证调用示例」不同：本节**不依赖** M0/M1 具体的父区域/子区命名，用一个全新的独立 20×20 Demo Scene 起步，只验证本模板「点+宽高+资产→放一栋建筑」的端口语义。完整 M0→M8 九步链见 [`battery-chain-template-demo/`](../../../../../../../../aw-support/examples/battery-chain-template-demo/README.md)；agent 模仿总览见 [`agent-imitate.md`](../../../../../../../../aw-support/examples/battery-chain-template-demo/agent-imitate.md)。

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

`demo_abg.out_1`（BaseNode）即为下面 PickOneBuilding 的 `in_1`。

### 端口 → opId → 默认参数（模式化生成依据）

| in_* 端口 | 白名单 opId | 必接 | 默认值/示例 | 备注 |
|---|---|---|---|---|
| `in_1` | 上游 `out_*` | 必接 | `demo_abg.out_1` | 承载建筑的场景 |
| `in_0` | `text_panel` | 必接 | `"demo_building"` | BuildingName（**不是** `in_2`） |
| `in_4` | `text_panel` | 建议 | `"草地"` | BuildingAsset（catalog 名） |
| `in_3` | `manual_points` | 必接 | `{"x":10,"y":10}` | Point 点位，需落在 20×20 内 |
| `in_5` / `in_6` | `number_const` | 建议 | `6` / `6` | AreaWidth × AreaHeight（独立示例用 6×6，小于叙事最小值 15×15，仅验证端口语义） |
| `in_2` | `number_const` | 建议 | `3` | BuildingHeight（竖向格；叙事内构 **≤3**） |
| `in_14` | `seed_control` / `aw_m0_seed` | **必接** | `42`（非 0） | 生产接 `aw_m0_seed.seed`；独立 demo 可自建 `seed_control` |

### applyBatch 片段（可直接照抄）

```json
{ "method":"POST","path":"/api/v1/group-templates/<projectId>/instantiate","caller":{"kind":"workbench"},
  "args":{ "templateId":"PickOneBuilding", "groupId":"demo_pk", "position":{"x":-400,"y":600},
           "opts":{"actor":"ai:sino","label":"实例化 PickOneBuilding"} } }
```

```jsonc
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

**验收**：execute 后 `demo_pk.out_1` 的子节点名应含 `demo_building`。
