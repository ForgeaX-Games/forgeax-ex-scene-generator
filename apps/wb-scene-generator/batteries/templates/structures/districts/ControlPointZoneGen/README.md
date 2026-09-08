# ControlPointZoneGen（控制点区域生成）

> templateId（传给 `scene:pipeline.instantiateTemplate`）：`group_control_point_zone_gen`，也可用 basename `ControlPointZoneGen`。

把一串折线控制点连成一条自然弯曲的控制线，再按指定**宽度**把控制线光栅化为一片区域（内部复用 [`RiverSpline`](../../../structures/water/RiverSpline/README.md) 同款的 `river_spline` 电池——该电池本身只做「控制点→自然曲线→按宽度光栅化」，与河流/水面无关，此处按通用分区语义复用，未改动电池代码）。上游场景足迹先切成基准网格，光栅化后按值拆分、逐张建为命名场景子节点；输出与其它结构模板一致的五个固定端口。

## 五个固定输出端口（结构契约）

| 方向 | portName | 语义 |
|---|---|---|
| OUT | `out_0` | Scene 完整场景（输入 + 区域子树） |
| OUT | `out_1` | Zone 区域子树（主产物） |
| OUT | `out_2` | Rest 剩余空地（掩码减去区域覆盖） |
| OUT | `out_3` | ZonePath 区域子节点路径 |
| OUT | `out_4` | RestPath 剩余子节点路径 |

## 主要可见输入端口

| portName | 语义 |
|---|---|
| `in_0` | Scene 上游场景（**必接**） |
| `in_1` | AssetName 资产名 |
| `in_2` | Seed 随机种子 |
| `in_3` | Points 控制点 `[[col,row],...]`（**必填否则无产物**，至少 2 个点） |
| `in_4` | Algorithm 平滑算法（noise / bezier / cubic_spline / moving_avg / gaussian） |
| `in_5` | **Width** 区域宽度（格，光栅化笔刷直径——即"能控制区域宽度"的核心参数） |
| `in_6` | NumMidPoints 内部扰动点数（越大越"不规则"，0=不扰动，贴近原始折线） |
| `in_7` | OffsetMin 法线偏移最小值（格） |
| `in_8` | OffsetMax 法线偏移最大值（格） |
| `in_9` | SegmentUniformity 扰动均匀度（0~1，1=等距，0=随机） |

> 算法专用参数 `WindowSize`(moving_avg) / `Sigma`(gaussian) / `BezierDegree`(bezier) 默认隐藏，按需在组内恢复。

## 内部管线

`scene_passthrough → node_explode → rect_grid → voxel_slice`（取顶层切片做基准）→ `river_spline`（控制点→自然曲线→按 Width 光栅化的区域掩码）→ `grid_split_by_value` → `grid2node`（按 `AssetName` 命名，挂 `asset_type=tile`）→ `add_child`；同时 `alg_region_subtract`（基准 − 区域）得到 Rest 子树。最后 `scene_merge_subtrees` 合并并 `scene_focus_path` 分别聚焦，导出五个固定端口。

`in_0` 悬空会导致整组静默空跑（execute 仍 completed）；`Points` 少于 2 个则不生成任何区域。完整端口以 `scene:templates.get` 为准。

---

## 如何用命令调用（输入侧）

### 通道 A · 实例化模板组

```json
{ "toolId": "scene:pipeline.instantiateTemplate",
  "args": { "projectId": "<pid>", "templateId": "ControlPointZoneGen",
            "groupId": "<可选稳定句柄>", "position": { "x": 0, "y": 0 },
            "opts": { "actor": "ai:sino", "label": "实例化 ControlPointZoneGen" } } }
```

> 模板组只走通道 A，不经过 applyBatch 的 opId 白名单。

### 通道 B · 必接输入（白名单 opId → 本组端口）

| 本端口 | 怎么喂 |
|---|---|
| `in_0` | 上游模板 `out_*`（Scene，必接，否则整组静默空跑） |
| `in_1` | `text_panel` → AssetName |
| `in_2` | 全局 `seed_control` / `aw_m0_seed` |
| `in_3` | `text_panel` 直填 JSON 字符串（如 `[[5,20],[20,10],[40,25],[55,15]]`）或组内直接编辑该端口默认值 |
| `in_5` | `number_const`（或直接编辑端口默认值）→ 控制区域宽度（格） |

**最小可跑示例（一条 applyBatch，Points/Width 用组内默认值编辑，仅接 Scene + AssetName）：**

```json
{
  "projectId": "<pid>",
  "opts": { "actor": "ai:sino", "label": "ControlPointZoneGen wiring" },
  "ops": [
    { "type": "createNode", "nodeId": "cpz_name", "opId": "text_panel", "params": { "text": "草地" } },
    { "type": "connect", "edgeId": "e_scene2cpz", "source": { "nodeId": "<UPSTREAM>", "port": "out_1" },
      "target": { "nodeId": "<G_CPZ>", "port": "in_0" } },
    { "type": "connect", "edgeId": "e_name2cpz", "source": { "nodeId": "cpz_name", "port": "output" },
      "target": { "nodeId": "<G_CPZ>", "port": "in_1" } }
  ]
}
```

### 读回验证（execute 后 jq）

```bash
curl -s …/execute -d '{}' | jq '.outputs.<G_CPZ>.out_0[0].items[0].tree.children[].name'
# 预期出现 AssetName 命名的区域子节点；Points 少于 2 个点时不应出现
```

> ⚠️ 禁止整体 dump `outputs`（含全 voxel，会爆上下文）。

---

## 如何用命令消费输出（输出侧）

| 本端口 | 语义 | 下游接法 | 允许的白名单 opId |
|---|---|---|---|
| `out_0` | 完整 Scene | 直传下一模板 `in_0`，或 `tree_merge`(tree,scene) 汇总 Preview | `tree_merge`, `scene_merge_subtrees`, `scene_output` |
| `out_1` | Zone 区域子树（主产物） | 需要「只有区域、没有父壳」时直传；禁止接 merge | 同上 |
| `out_2` | Rest 剩余空地 | 链式起点，接下一模板 `in_0` 继续施工 | 同上 |
| `out_3` | ZonePath | 配合 `scene_focus_path` 索引区域子节点 | `text_panel`, `scene_focus_path` |
| `out_4` | RestPath | 配合 `scene_focus_path` 索引剩余子节点 | `text_panel`, `scene_focus_path` |

### 常见消费模式

- **直传**：`<G_CPZ>.out_0`（或 `out_2` Rest）→ `connect` → 下一模板 `in_0`。
- **汇总**：各组 `out_0` → 根 `tree_merge`(`inferredAccess:"tree"`) → `scene_merge_subtrees` → `scene_output`。
- **路径索引区域子节点**：`out_3`（ZonePath）+ `text_panel` 绝对路径 → `scene_focus_path`(scene=`out_0`) → 下一组 `in_0`。

### 输出侧禁止

- 引用已删除端口（无 —— 五个固定端口均保留）
- 把未 focus 的 `out_0`（含 Scene 全树）当装饰链入口时，注意其中同时含区域与剩余空地，若只要区域请用 `out_1`
