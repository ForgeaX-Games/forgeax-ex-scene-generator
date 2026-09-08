# NaturalDecorationDistribution（自然装饰散布）

> templateId（传给 `POST /api/v1/group-templates/:projectId/instantiate`）：`group_1782117984754_5oqi1`，也可用 basename `NaturalDecorationDistribution`。

在剩余空地上按密度散布自然装饰。接上一组的 Rest/Non-Path 场景。

**选型**：本模板做大片 Rest **背景填充**，**仅**挂底面简单、结构简单的植被/石块等。例如山石散布用「小假山」1×1；「假山」4×1 等大体积资产 → **改用 `PlaceOneDecoration`**（唯一可控 footprint）。`LocalPreciseDecoration` 负责兴趣点旁简单小物件簇。按需求选用，不必硬凑三种；本模板**无**单颗 footprint 口。

## 主要可见端口

| 方向 | portName | 语义 |
|---|---|---|
| IN | `in_1` | Scene 上游剩余空地（**必接**） |
| IN | `in_0` | NamePrefix 名称前缀 |
| IN | `in_5` | AssetName 装饰资产名 |
| IN | `in_2` | Density 密度 |
| IN | `in_3` | Seed（**必接** `aw_m0_seed.seed`，禁止 0/悬空） |
| IN | `in_4` | zHeight（可选） |
| OUT | `out_1` | Decoration 装饰（主产物；**单份**已内部 `scene_merge_subtrees` 收束的 scene，不再按装饰点 fan-out 成 N 份整树） |
| OUT | `out_2` | Rest 剩余空地 |

`in_1` 悬空会导致整组静默空跑（execute 仍 completed）。完整端口以 `GET /api/v1/group-templates/:id?scope=templates` 为准。

---

## 如何用命令调用（输入侧）

> 文档标准见 [`../../_DOC_STANDARD.md`](../../_DOC_STANDARD.md)。

### 通道 B · 必接输入（**端口勿接反**）

| 本端口 | 语义 | 怎么喂 |
|--------|------|--------|
| `in_1` | Scene Rest | **`PlaceOneDecoration.out_2` → `scene_focus_path`（path=`/父区域/划分子区域1/rest/rest`）→ `in_1`** |
| `in_0` | NamePrefix | `text_panel`，如 `自然` → 子节点名 `自然0`、`自然1`… |
| **`in_5`** | **AssetName** | `text_panel`，如 `树` — **不是 `in_2`** |
| **`in_2`** | **Density** | 优先按 `目标量级 × 丰富度系数 ÷ Rest有效格数`；系数：稀疏 1.0、正常 1.5、丰富 2.0–2.5；计算结果直接使用，**仅限制在概率范围 0–1，禁止截断到 0.01**。面积未知时兜底：树 0.01–0.04 · 灌木/石 0.02–0.06 · 草 0.04–0.12。验证链曾用 0.012 |
| `in_3` | Seed | **`aw_m0_seed.seed`（必接，固定非 0）** |

每组**一种** asset + **各自 density**；草/灌木/树等**推荐**多层多品种（多实例 + Rest 串联），勿只象征性放一种或全层同一密度。

---

## 如何用命令消费输出（输出侧）

| 本端口 | 典型下游 |
|--------|---------|
| `out_1` | Decoration scene → merge |
| `out_2` | Rest → 下一装饰 / LocalPrecise |
| `out_4` | 散布路径列表（headless 验收用） |

---

## 已验证调用示例

| 项 | 值 |
|---|---|
| **projectId** | `p_mr4b9s3j_dycp8k` |
| **报告** | [`step-m6-naturaldecoration.json`](../../../../../../../aw-support/battery-verify/p_mr4b9s3j_dycp8k/step-m6-naturaldecoration.json) |
| **groupId** | `verify_nd1` |
| **restFocusPath** | `/父区域/划分子区域1/rest/rest` |
| **density** | `0.012`；asset `树` → **`in_5`** |

```bash
PID=p_mr4b9s3j_dycp8k
curl -s -X POST "http://127.0.0.1:9557/api/v1/projects/$PID/execute/summary" \
  -H 'content-type: application/json' -H 'x-forgeax-caller-kind: workbench' \
  -d '{"narrativeLocationNames":["父区域"]}' \
  | jq '.outputs.verify_nd1.out_4.itemCount'
# 预期 ≥ 3（含前缀 自然）
```

---

## 单步独立：最小可跑示例（agent 模仿用）

> 与上文「已验证调用示例」不同：本节**不依赖** M5 具体的 PlaceOne Rest，用一个全新的独立 20×20 Demo Scene 直接当"剩余空地"，只验证本模板「Density → 随机散布」的端口语义。完整 M0→M8 九步链见 [`battery-chain-template-demo/`](../../../../../../../../../aw-support/examples/battery-chain-template-demo/README.md)；agent 模仿总览见 [`agent-imitate.md`](../../../../../../../../../aw-support/examples/battery-chain-template-demo/agent-imitate.md)。

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

`demo_abg.out_1`（BaseNode）即为下面 NaturalDecorationDistribution 的 `in_1`。

### 端口 → opId → 默认参数（模式化生成依据）

| in_* 端口 | 白名单 opId | 必接 | 默认值/示例 | 备注 |
|---|---|---|---|---|
| `in_1` | 上游 `out_*` | 必接 | `demo_abg.out_1` | 剩余空地场景 |
| `in_0` | `text_panel` | 建议 | `"自然"` | NamePrefix |
| `in_5` | `text_panel` | 建议 | `"树"` | AssetName（**不是 `in_2`**） |
| `in_2` | `number_const` | 建议 | `0.03`（面积未知时的树木参考；已知面积时按公式计算） | Density |
| `in_3` | `seed_control` / `aw_m0_seed` | **必接** | `42`（非 0） | 生产接全局 `aw_m0_seed` |

### applyBatch 片段（可直接照抄）

```json
{ "method":"POST","path":"/api/v1/group-templates/<projectId>/instantiate","caller":{"kind":"workbench"},
  "args":{ "templateId":"NaturalDecorationDistribution", "groupId":"demo_nd", "position":{"x":-400,"y":1800},
           "opts":{"actor":"ai:sino","label":"实例化 NaturalDecorationDistribution"} } }
```

```jsonc
{ "type":"createNode","nodeId":"nd_prefix", "opId":"text_panel","params":{"text":"自然"} },
{ "type":"createNode","nodeId":"nd_asset",  "opId":"text_panel","params":{"text":"树"} },
{ "type":"createNode","nodeId":"nd_density","opId":"number_const","params":{"value":0.03} },
{ "type":"createNode","nodeId":"nd_seed",   "opId":"seed_control","params":{"seed":42} },
{ "type":"connect","edgeId":"e_nd_rest",   "source":{"nodeId":"demo_abg","port":"out_1"},"target":{"nodeId":"demo_nd","port":"in_1"} },
{ "type":"connect","edgeId":"e_nd_prefix", "source":{"nodeId":"nd_prefix","port":"output"},"target":{"nodeId":"demo_nd","port":"in_0"} },
{ "type":"connect","edgeId":"e_nd_asset",  "source":{"nodeId":"nd_asset","port":"output"},"target":{"nodeId":"demo_nd","port":"in_5"} },
{ "type":"connect","edgeId":"e_nd_density","source":{"nodeId":"nd_density","port":"value"},"target":{"nodeId":"demo_nd","port":"in_2"} },
{ "type":"connect","edgeId":"e_nd_seed",   "source":{"nodeId":"nd_seed","port":"seed"},"target":{"nodeId":"demo_nd","port":"in_3"} }
```

**验收**：execute 后 `demo_nd.out_1` 为 **itemCount=1** 的 scene（子节点名含 `自然0`、`自然1`…）；`out_4` 仍为装饰路径列表；`out_2`（Rest）为剩余未散布区域。
