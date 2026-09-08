# RegionCompassSqueeze（区域偏压缩）

> templateId（传给 `scene:pipeline.instantiateTemplate`）：`group_1786400000000_rcsq`，也可用 basename `RegionCompassSqueeze`。
> 内部核心 `alg_region_compass_squeeze` + 标准 scene 挂接链。实例化后返回全新运行时 `groupId`，后续连线一律用返回值。

## 功能说明

对输入 Scene 当前 focus 指向的**已有区域节点**，按其自身**八个方位**（北/东北/东/东南/南/西南/西/西北）的边界锚点做局部有符号形变，效果类似"揉面团"：每个方位可独立设置**压缩/拉伸力度**（支持负数），力度按 `Radius` 平滑衰减，多个方位重叠时自然叠加过渡。支持**异形/非凸自然边界**（不要求矩形/凸形）。

结果作为**两个新子节点**挂在原区域节点下（原节点本身不变，与 `DistanceZones`/`RegionOffset` 同一挂接方式）：`Squeezed`（形变后的主产物）与 `Rest`（原区域中被压缩掉、不再属于 `Squeezed` 的部分）互为补集——`Squeezed` 与 `Rest` 的格子数之和恒等于形变前的原区域格子数。纯拉伸（没有任何方位取正值）时不会压掉任何格子，`Rest` 是一个空场景节点（合法，但没有体素）。

> **拉伸受画布余量限制**：正值（压缩）总会生效；负值（拉伸）需要该方位在当前工作画布内本来就有背景余量才能长出去，若区域已贴满画布边缘，该方向的拉伸会被裁掉。这与 `alg_region_offset`/`RegionOffset` 的"外扩受 bbox 限制"是同一约束——需要拉伸的方向，建议上游先用 `RegionOffset`（正值内缩留边）或更大的父画布，为拉伸预留背景空间。

## 五件套输出端口

| 方向 | portName | 语义 |
|---|---|---|
| OUT | `out_0` | Scene 完整场景（输入 + 形变后子节点 + Rest 子节点） |
| OUT | `out_1` | Squeezed 形变后区域子树（主产物） |
| OUT | `out_2` | SqueezedPath 形变后子节点路径 |
| OUT | `out_3` | Rest 被压缩掉的剩余区域子树（与 `Squeezed` 互补；纯拉伸时为空） |
| OUT | `out_4` | RestPath Rest 子节点路径 |

## 主要可见输入端口

| portName | 语义 |
|---|---|
| `in_0` | Scene 上游场景，**focus 需指向待形变的区域节点**（**必接**） |
| `in_1`..`in_8` | North/NorthEast/East/SouthEast/South/SouthWest/West/NorthWest 八个方位的力度，默认 0，可为负数（拉伸）；超出 `[-64,64]` 会被静默 clamp 到边界值 |
| `in_9` | **Radius** 每个方位锚点的影响半径（格数），默认 10，范围 `[1,128]`，超出会被静默 clamp |
| `in_10` | Name 形变后子节点名称 |
| `in_11` | Asset 形变后子节点的 `asset_name` 资产标识 |

> 隐藏高级输入：`Connectivity`(4/8，默认 8)、`z`(体素切片层)、`fillValue`(rect 填充值)、`schema`/`token`/`zRange`(grid2node 高级参数)。

## 内部管线

`scene_passthrough → node_explode → rect_grid → voxel_slice`（取 focus 节点自身画布与体素）→ `alg_region_compass_squeeze`（八方位力度 → 形变后 region）→ 一路 `grid2node → AssetName(__group__) → add_child` 挂 `Squeezed`；同时 `alg_region_subtract`(a=形变前 slice, b=形变后 region) 求出被压掉的格子 → `grid2node`(name 固定 `rest`) → 第二次 `add_child` 挂 `Rest`（两次 `add_child` 串联，`Squeezed`/`Rest` 是同一父节点下的兄弟）→ `scene_focus_path` 分别聚焦两个子节点，五件套输出。

`in_0` 悬空或 focus 未指向有效区域节点会导致内部 `voxel_slice` 切出无效/空网格，`out_0` 变成非法场景值，下游只要接了 `scene_output`（或其它要求合法 `ScenePortValue` 的算子）就会让**整图 `execute` 直接返回 `status:"error"`**（不是"静默空跑"，是硬报错中断，报错节点会指向下游那个消费者而非本电池本身，容易误判成别处的问题）。完整端口以 `scene:templates.get` 为准。

---

## 如何用命令调用（输入侧）

### 通道 A · 实例化模板组

```json
{ "toolId": "scene:pipeline.instantiateTemplate",
  "args": { "projectId": "<pid>", "templateId": "RegionCompassSqueeze",
            "groupId": "<可选稳定句柄>", "position": { "x": 0, "y": 0 },
            "opts": { "actor": "ai:sino", "label": "实例化 RegionCompassSqueeze" } } }
```

> 模板组只走通道 A，不经过 applyBatch 的 opId 白名单。

### 通道 B · 必接输入（白名单 opId → 本组端口）

| 本端口 | 怎么喂 |
|---|---|
| `in_0` | 上游模板"聚焦到具体区域节点"的那个输出（例如 `IslandRegions.out_1`，**不是**未 focus 的 `out_0`），必接，否则整图 execute 报错 |
| `in_1`..`in_8` | 各接一个 `number_const`（或直接编辑端口默认值），正=压缩，负=拉伸，范围 `[-64,64]` |
| `in_9` | `number_const` → 影响半径（格数），范围 `[1,128]` |
| `in_10` | `text_panel` → 子节点名称 |
| `in_11` | `text_panel` → 资产名 |

**最小可跑示例（一条 applyBatch，仅接 Scene + 东侧压缩 + 名称/资产）：**

```json
{
  "projectId": "<pid>",
  "opts": { "actor": "ai:sino", "label": "RegionCompassSqueeze wiring" },
  "ops": [
    { "type": "createNode", "nodeId": "rcs_east", "opId": "number_const", "params": { "value": 6 } },
    { "type": "createNode", "nodeId": "rcs_name", "opId": "text_panel", "params": { "text": "偏压缩区域" } },
    { "type": "createNode", "nodeId": "rcs_asset", "opId": "text_panel", "params": { "text": "草地" } },
    { "type": "connect", "edgeId": "e_scene2rcs", "source": { "nodeId": "<UPSTREAM>", "port": "out_1" },
      "target": { "nodeId": "<G_RCS>", "port": "in_0" } },
    { "type": "connect", "edgeId": "e_east2rcs", "source": { "nodeId": "rcs_east", "port": "value" },
      "target": { "nodeId": "<G_RCS>", "port": "in_3" } },
    { "type": "connect", "edgeId": "e_name2rcs", "source": { "nodeId": "rcs_name", "port": "output" },
      "target": { "nodeId": "<G_RCS>", "port": "in_10" } },
    { "type": "connect", "edgeId": "e_asset2rcs", "source": { "nodeId": "rcs_asset", "port": "output" },
      "target": { "nodeId": "<G_RCS>", "port": "in_11" } }
  ]
}
```

### 读回验证（execute 后 jq）

```bash
curl -s …/execute -d '{}' | jq '.outputs.<G_RCS>.out_0[0].items[0].tree.children[].name'
# 预期出现 Name 命名的形变子节点，及固定名 "rest" 的剩余子节点
```

> ⚠️ 禁止整体 dump `outputs`（含全 voxel，会爆上下文）。

---

## 如何用命令消费输出（输出侧）

| 本端口 | 语义 | 下游接法 | 允许的白名单 opId |
|---|---|---|---|
| `out_0` | 完整 Scene（含 Squeezed + Rest） | 直传下一模板 `in_0`，或 `tree_merge`(tree,scene) 汇总 Preview | `tree_merge`, `scene_merge_subtrees`, `scene_output` |
| `out_1` | Squeezed 形变后区域（主产物） | 需要「只有形变结果、没有父壳」时直传 | 同上 |
| `out_2` | SqueezedPath | 配合 `scene_focus_path` 索引形变子节点 | `text_panel`, `scene_focus_path` |
| `out_3` | Rest 被压缩掉的剩余区域（与 Squeezed 互补） | 需要"让出来的地方"单独接下游铺别的资产时直传 | 同上 |
| `out_4` | RestPath | 配合 `scene_focus_path` 索引 Rest 子节点 | `text_panel`, `scene_focus_path` |

### 常见消费模式

- **直传**：`<G_RCS>.out_0` → `connect` → 下一模板 `in_0`，继续叠加多轮形变（可反复实例化以在同一区域上叠加多次"揉压"）。
- **汇总**：各组 `out_0` → 根 `tree_merge`(`inferredAccess:"tree"`) → `scene_merge_subtrees` → `scene_output`。
- **利用 Rest**：`<G_RCS>.out_3` → 下一个区域模板 `in_0`（例如让被压缩掉的区域改铺另一种地表）。纯拉伸场景下 `out_3` 为空场景，下游按空输入处理即可，不会报错。

### 输出侧禁止

- 把未 focus 的 `out_0` 当装饰链入口——形变前的父节点仍在里面，只要形变结果请用 `out_1`/`out_3`。

> `icon.png` 暂借用 `RegionOffset` 的图标占位（同属"区域局部形变"视觉隐喻）；`template-icons-live.mjs` 需要跑起来的 backend+浏览器实时截图，未在此环境执行，后续如需专属缩略图再补采。

## 报错排查

- **现象**：整图 `execute` 返回 `status:"error"`，报错节点是下游的 `scene_output`（或其它 scene 消费者），提示 `scene is required and must be a ScenePortValue`。
- **根因**：`in_0` 接的是未 focus 的合并 Scene（例如某上游模板的 `out_0`），本电池内部依赖 focus 才能切出有效网格。
- **修复**：把 `in_0` 改接上游"聚焦到具体区域节点"的输出端口（如 `IslandRegions.out_1`）。
- **验证**：接一个非空区域 + 至少一个方位力度非 0 → execute → 父节点下应出现 `Name` 子节点与 `rest` 子节点，二者体素数之和等于形变前父区域体素数。
