# LocalPreciseDecoration（局部精准装饰播撒）

> templateId（传给 `POST /api/v1/group-templates/:projectId/instantiate`）：`group_local_precise_decoration`，也可用 basename `LocalPreciseDecoration`。

以**兴趣点**为中心，在父区域有效格内的圆形半径内采样多个小型装饰物点位并挂树；算法核心为 scenealg **`alg_points_center_scatter`**（源自 `components/decoration/precise_decoration_scatter`）。

## 与相关模板的分工（选型）

| 模板 | 何时用 | 可挂资产 |
|---|---|---|
| **PlaceOneDecoration** | 少量、有明确位置和/或底面尺寸 | 需占格贴合的物件（优先） |
| **LocalPreciseDecoration**（本模板） | 兴趣点旁局部多颗（半径 + 数量 + 算法） | **仅**底面简单、结构简单的小物件（花草/碎石/小灌木/灯笼等） |
| **NaturalDecorationDistribution** | 全区域密度填充（无中心点） | 同上——简单植被/石块 |

本模板**无顶层 Footprint 口**。有明显宽深 + 落点 → 改用 PlaceOne。按需求选用，不必硬凑三种。

## 主要可见端口

| 方向 | portName | 语义 |
|---|---|---|
| IN | `in_1` | Scene 上游剩余空地（**必接**） |
| IN | `in_2` | Point 兴趣点 point2d（x→列、y→行） |
| IN | `in_19` | Count 采样数量 |
| IN | `in_20` | ScatterRadius 播撒半径（格数） |
| IN | `in_21` | Algorithm 采样算法：`random` / `cluster` / `ring` / `poisson` / `noise` |
| IN | `in_0` | NamePrefix 名称前缀 |
| IN | `in_5` | AssetName 装饰资产名 |
| IN | `in_3` | Seed 随机种子（**必接** `aw_m0_seed.seed`，禁止 0/悬空） |
| OUT | `out_1` | Decoration 装饰（主产物；**单份**已内部 merge 收束的 scene，不再按点 fan-out） |
| OUT | `out_2` | Rest 剩余空地 |

`in_1` 悬空会导致整组静默空跑（execute 仍 completed）。完整端口以 `GET /api/v1/group-templates/:id?scope=templates` 为准。

## 内部管线（③ 段 scenealg）

```
scene → explode → rect_grid → voxel_slice（region）
  → alg_points_center_scatter(point, count, scatterRadius, algorithm)
  → grid2node + MultiNames(NamePrefix) + ObjectAssetName(AssetName)
  → add_child；alg_region_union_all(points) → subtract → Rest
```

兴趣点不在有效格内时，scatter 电池会 BFS 吸附到最近有效格再采样。

---

## 如何用命令调用（输入侧）

> 文档标准见 [`../../_DOC_STANDARD.md`](../../_DOC_STANDARD.md)。本模板**无顶层 Footprint 口**；用 **ScatterRadius + Count** 控制局部多颗**简单小物件**的播撒范围（与 PlaceOne 单矩形 footprint 区分）。禁止挂复杂体量资产。

| 本端口 | 语义 | 怎么喂 |
|--------|------|--------|
| `in_1` | Scene Rest | **`NaturalDecorationDistribution.out_2` → `scene_focus_path`（path=`/父区域/划分子区域1/rest/rest/rest`）→ `in_1`** |
| `in_2` | Point 兴趣点 | `manual_points`，如建筑/广场中心 `{28,26}` |
| `in_19` | Count | `number_const`，验证链 **8** |
| `in_20` | ScatterRadius | `number_const`，验证链 **6**（格） |
| `in_21` | Algorithm | `text_panel`：`poisson` / `random` / `cluster` / `ring` / `noise` |
| `in_0` / `in_5` | NamePrefix / AssetName | `text_panel` |
| `in_3` | Seed | **`aw_m0_seed.seed`（必接，固定非 0）** |

---

## 已验证调用示例

| 项 | 值 |
|---|---|
| **projectId** | `p_mr4b9s3j_dycp8k` |
| **报告** | [`step-m7-localprecisedecoration.json`](../../../../../../../aw-support/battery-verify/p_mr4b9s3j_dycp8k/step-m7-localprecisedecoration.json) |
| **groupId** | `verify_lp1` |
| **restFocusPath** | `/父区域/划分子区域1/rest/rest/rest` |

```bash
PID=p_mr4b9s3j_dycp8k
curl -s -X POST "http://127.0.0.1:9557/api/v1/projects/$PID/execute/summary" \
  -H 'content-type: application/json' -H 'x-forgeax-caller-kind: workbench' \
  -d '{"narrativeLocationNames":["父区域"]}' \
  | jq '.outputs.verify_lp1.out_4.itemCount'
# 预期 ≥ 8（前缀 局部）
```

---

## 单步独立：最小可跑示例（agent 模仿用）

> 与上文「已验证调用示例」不同：本节**不依赖** M6 具体的 Natural Rest，用一个全新的独立 20×20 Demo Scene 直接当"剩余空地"，只验证本模板「Point + Count + ScatterRadius + Algorithm → 局部多颗」的端口语义。完整 M0→M8 九步链见 [`battery-chain-template-demo/`](../../../../../../../../../aw-support/examples/battery-chain-template-demo/README.md)；agent 模仿总览见 [`agent-imitate.md`](../../../../../../../../../aw-support/examples/battery-chain-template-demo/agent-imitate.md)。

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

`demo_abg.out_1`（BaseNode）即为下面 LocalPreciseDecoration 的 `in_1`。

### 端口 → opId → 默认参数（模式化生成依据）

| in_* 端口 | 白名单 opId | 必接 | 默认值/示例 | 备注 |
|---|---|---|---|---|
| `in_1` | 上游 `out_*` | 必接 | `demo_abg.out_1` | 剩余空地场景 |
| `in_2` | `manual_points` | 必接 | `{"x":10,"y":10}` | 兴趣点 |
| `in_19` | `number_const` | 建议 | `8` | Count 采样数量 |
| `in_20` | `number_const` | 建议 | `6` | ScatterRadius（格） |
| `in_21` | `text_panel` | 建议 | `"poisson"` | Algorithm：`random`/`cluster`/`ring`/`poisson`/`noise` |
| `in_0` / `in_5` | `text_panel` | 建议 | `"局部"` / `"草地"` | NamePrefix / AssetName |
| `in_3` | `seed_control` / `aw_m0_seed` | **必接** | `42`（非 0） | 生产接全局 `aw_m0_seed` |

### applyBatch 片段（可直接照抄）

```json
{ "method":"POST","path":"/api/v1/group-templates/<projectId>/instantiate","caller":{"kind":"workbench"},
  "args":{ "templateId":"LocalPreciseDecoration", "groupId":"demo_lp", "position":{"x":-400,"y":2100},
           "opts":{"actor":"ai:sino","label":"实例化 LocalPreciseDecoration"} } }
```

```jsonc
{ "type":"createNode","nodeId":"lp_prefix","opId":"text_panel","params":{"text":"局部"} },
{ "type":"createNode","nodeId":"lp_asset", "opId":"text_panel","params":{"text":"草地"} },
{ "type":"createNode","nodeId":"lp_pt",    "opId":"manual_points","params":{"x":10,"y":10} },
{ "type":"createNode","nodeId":"lp_count", "opId":"number_const","params":{"value":8} },
{ "type":"createNode","nodeId":"lp_radius","opId":"number_const","params":{"value":6} },
{ "type":"createNode","nodeId":"lp_algo",  "opId":"text_panel","params":{"text":"poisson"} },
{ "type":"createNode","nodeId":"lp_seed",  "opId":"seed_control","params":{"seed":42} },
{ "type":"connect","edgeId":"e_lp_rest",  "source":{"nodeId":"demo_abg","port":"out_1"},"target":{"nodeId":"demo_lp","port":"in_1"} },
{ "type":"connect","edgeId":"e_lp_prefix","source":{"nodeId":"lp_prefix","port":"output"},"target":{"nodeId":"demo_lp","port":"in_0"} },
{ "type":"connect","edgeId":"e_lp_asset", "source":{"nodeId":"lp_asset","port":"output"},"target":{"nodeId":"demo_lp","port":"in_5"} },
{ "type":"connect","edgeId":"e_lp_pt",    "source":{"nodeId":"lp_pt","port":"point"},"target":{"nodeId":"demo_lp","port":"in_2"} },
{ "type":"connect","edgeId":"e_lp_count", "source":{"nodeId":"lp_count","port":"value"},"target":{"nodeId":"demo_lp","port":"in_19"} },
{ "type":"connect","edgeId":"e_lp_radius","source":{"nodeId":"lp_radius","port":"value"},"target":{"nodeId":"demo_lp","port":"in_20"} },
{ "type":"connect","edgeId":"e_lp_algo",  "source":{"nodeId":"lp_algo","port":"output"},"target":{"nodeId":"demo_lp","port":"in_21"} },
{ "type":"connect","edgeId":"e_lp_seed",  "source":{"nodeId":"lp_seed","port":"seed"},"target":{"nodeId":"demo_lp","port":"in_3"} }
```

**验收**：execute 后 `demo_lp.out_1` 为 **itemCount=1**；子节点名含 `局部0`…`局部7`；`out_2`（Rest）为扣除采样点后的剩余区域。
