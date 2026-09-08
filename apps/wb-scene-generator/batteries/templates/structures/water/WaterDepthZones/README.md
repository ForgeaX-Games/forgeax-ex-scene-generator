# WaterDepthZones · 水域深浅分带模板

> templateId（传给 `scene:pipeline.instantiateTemplate`）：basename `WaterDepthZones`。
> 内部 3 个嵌套子组（ShallowAssetName / MidAssetName / DeepAssetName）。实例化后返回全新运行时 `groupId`，后续连线一律用返回值。

## 基本介绍

输入一片**已存在的水域节点**（如海洋、湖泊），自然地把它按到「岸/岛」的距离切成**浅水 / 中水 / 深水**三层，并各自写好 `asset_name`/`asset_type=tile`，作为三个子节点挂回原节点下。

- 内部用 `alg_field_inner_distance` 算一次距离场，再串联两次 `alg_field_threshold`（先切「浅水 / 非浅水」，再对「非浅水」切「中水 / 深水」），三层两两不重叠，并集恰好等于输入水域。
- **分界不是等距同心环**：距离场先经 `alg_field_fbm_warp` 用低频 FBM 噪声做零均值扰动，再喂给阈值电池；浅界与中界各用一次扰动（不同 seed），两条分界互不平行，形成忽宽忽窄、带海湾与岬角的自然水线。噪声零均值，阈值仍是「平均格数」的语义。把 `ShallowWaviness` / `MidWaviness` 设为 0 即退回旧的均匀等距分带。
- **自动识别外缘是否天然**：新增电池 `alg_region_border_is_rect` 检测输入区域的有效格是否把自己的外接矩形四条边完全填满。
  - **外缘是方正矩形**（如被地图边界裁切的开阔海域）→ 外缘**不是**天然海岸线，只有内部岛屿才是距离源 → 外缘一律归入**深水**。
  - **外缘凹凸不规则**（天然海岸线）→ 外缘本身也是距离源，越靠近岸/岛越浅。
  - 无需手动配置，模板内部用 `not(isRect)` 自动接到 `alg_field_inner_distance.includeOuterBoundary`。
- 与其它场景模板一致，输出「七件套」：完整 scene + 三个产物子树 + 三个产物路径字符串。

## 输入端口

| 端口 | 标签 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `in_0` | Scene | `scene` | 是 | focus 指向待分带水域节点的场景 |
| `in_1` | ShallowThreshold | `number` | 是 | 浅水分界距离（含界归入浅水）。raw 距离用整数（格数） |
| `in_2` | MidThreshold | `number` | 是 | 中水分界距离（含界归入中水，必须 ≥ ShallowThreshold） |
| `in_3` | ShallowAsset | `string` | 否 | 浅水区 `asset_name`，默认 `浅水` |
| `in_4` | MidAsset | `string` | 否 | 中水区 `asset_name`，默认 `中水` |
| `in_5` | DeepAsset | `string` | 否 | 深水区 `asset_name`，默认 `深水` |
| `in_6` | ShallowName | `string` | 否 | 浅水子节点名，默认 `Shallow` |
| `in_7` | MidName | `string` | 否 | 中水子节点名，默认 `Mid` |
| `in_8` | DeepName | `string` | 否 | 深水子节点名，默认 `Deep` |
| `in_18` | ShallowWaviness | `number` | 否 | 浅水分界的摆动幅度（格），默认 `3`；`0` = 等距同心环 |
| `in_19` | MidWaviness | `number` | 否 | 中水分界相对浅界的额外摆动幅度（格），默认 `2`。应 < `MidThreshold - ShallowThreshold`，否则中水层局部会被挤没 |
| `in_20` | FeatureScale | `number` | 否 | 水线波动频率，默认 `0.07`；越小海湾越大，推荐 0.03~0.15 |
| `in_21` | Seed | `number` | 否 | 水线随机种子，默认 `1337`；`0` = 每次随机 |

隐藏高级输入：`connectivity`(4/8)、`normalize`、`voxel z`、`rect fillValue`、三个子节点的 `schema`/`token`/`zRange`、中水扰动的 `featureScale`/`seed`（`in_22`/`in_23`，默认 `0.1`/`4211`）。

外缘是否天然（`includeOuterBoundary`）**不对外暴露**——由模板自动检测，无需手填。

## 输出端口

| 端口 | 标签 | 类型 | 说明 |
| --- | --- | --- | --- |
| `out_0` | Scene | `scene` | 挂入三个子节点后的完整场景（focus 不变） |
| `out_1` | Shallow | `scene` | focus 指向「浅水」子节点的场景 |
| `out_2` | Mid | `scene` | focus 指向「中水」子节点的场景 |
| `out_3` | Deep | `scene` | focus 指向「深水」子节点的场景 |
| `out_4` | ShallowPath | `string` | 浅水子节点的绝对路径 |
| `out_5` | MidPath | `string` | 中水子节点的绝对路径 |
| `out_6` | DeepPath | `string` | 深水子节点的绝对路径 |

## 内部流程（6 段范式 + 自动检测）

1. **输入归一**：`scene_passthrough` 接入，`node_explode` 取 focus 节点的 bbox 与体素。
2. **取区域掩码**：`rect_grid`(填 1) + `voxel_slice` → 得到该节点自身的占位掩码 `slice`。
3. **自动识别外缘**：`alg_region_border_is_rect`(region=slice) → `isRect` → `not` → `includeOuterBoundary`。
4. **算法**：`alg_field_inner_distance`(region=slice, includeOuterBoundary) → 距离场 → `WarpShallow`(`alg_field_fbm_warp`, seed 1337) 扰动后喂 `ThresholdShallow`(near=浅水, far=非浅水)；扰动结果再经 `WarpMid`(seed 4211) 二次扰动后，对 far 跑 `ThresholdMid`(near=中水, far=深水)。链式扰动保证中界始终在浅界之外（只要 `MidWaviness < MidThreshold - ShallowThreshold`），同时两条水线互不平行。
5. **网格转节点 + 赋属性**：浅/中/深各经 `grid2node` 落成节点（默认名 `Shallow`/`Mid`/`Deep`），再经内嵌组 `*AssetName`（`scene_set_attribute` 写 `asset_name` / `asset_type=tile`）。
6. **产物挂树 + 标准输出**：三个 `add_child` 依次挂到 focus 节点下 → `scene_merge_subtrees` 汇总 → 三路 `scene_focus_path` 分别 focus 浅/中/深节点 → `scene_passthrough` 出 `Scene/Shallow/Mid/Deep`，三个 `type_string` 出对应 `*Path`。

## 校验要点

- 输入 scene 的 focus 必须落在一个**已存在且占位非空**的水域节点上。
- `MidThreshold` 应 ≥ `ShallowThreshold`；若相等则中水层为空（浅/深二分）。
- 距离单位与距离场一致：未归一化时为「格数」。阈值是**平均**距离——实际分界在 ±`Waviness` 内摆动。
- 小水域（阈值只有 1~2 格）请把 `ShallowWaviness`/`MidWaviness` 调小到 0.5~1，否则摆动会淹没分层。
- 同 `Seed` 结果确定；`Seed=0` 走时间戳，每次不同。
- 已用「开阔海域中央有岛」（外缘矩形）与「天然海岸线 + 内部岛屿」（外缘不规则）两种网格实测：三层并集恰好等于输入水域格数，且外缘矩形场景下外缘四角恒为深水。

## 如何用命令调用（输入侧）

> 文档标准见 [`../../../../../docs/templates/_DOC_STANDARD.md`](../../../../../docs/templates/_DOC_STANDARD.md)。Sino 双通道：模板组走**通道 A** `instantiateTemplate`；接线走**通道 B** `applyBatch`（仅白名单工具电池 + `connect`）。

### 通道 A · 实例化

```json
{ "toolId": "scene:pipeline.instantiateTemplate", "caller": { "kind": "ai" },
  "args": { "projectId": "<pid>", "templateId": "WaterDepthZones", "groupId": "<G>",
            "position": { "x": 400, "y": 0 },
            "opts": { "actor": "ai:sino", "label": "实例化 WaterDepthZones" } } }
```

### 通道 B · 接线（白名单 opId → 本组端口）

| 本端口 | 白名单上游 opId | 怎么喂 |
|--------|-----------------|--------|
| `in_0` | 上游模板 `out_*`（focus 在水域节点上的 scene） | `connect` 直接接 |
| `in_1` | `number_const` | 浅水阈值，如 `3` |
| `in_2` | `number_const` | 中水阈值，如 `6`（≥ `in_1`） |
| `in_3`–`in_5` | `text_panel`（不接则用组内默认 浅水/中水/深水） | 资产名 |
| `in_6`–`in_8` | `text_panel`（不接则用组内默认 Shallow/Mid/Deep） | 子节点名 |

```json
{
  "projectId": "<pid>",
  "opts": { "actor": "ai:sino", "label": "WaterDepthZones wiring" },
  "ops": [
    { "type": "createNode", "nodeId": "wdz_thr_shallow", "opId": "number_const", "params": { "value": 3 } },
    { "type": "createNode", "nodeId": "wdz_thr_mid", "opId": "number_const", "params": { "value": 6 } },
    { "type": "connect", "edgeId": "e_wdz_scene", "source": { "nodeId": "<UpstreamOut>", "port": "out_0" },
      "target": { "nodeId": "<G>", "port": "in_0" } },
    { "type": "connect", "edgeId": "e_wdz_thr1", "source": { "nodeId": "wdz_thr_shallow", "port": "value" },
      "target": { "nodeId": "<G>", "port": "in_1" } },
    { "type": "connect", "edgeId": "e_wdz_thr2", "source": { "nodeId": "wdz_thr_mid", "port": "value" },
      "target": { "nodeId": "<G>", "port": "in_2" } }
  ]
}
```

### 读回验证（execute 后 jq）

```bash
curl -s …/execute -d '{}' | jq '.outputs.<G>.out_0[0].items[0].graph | to_entries | map(select(.value.name=="Shallow" or .value.name=="Mid" or .value.name=="Deep")) | map(.value.name)'
```

> ⚠️ 禁止整体 dump `outputs`（含全体素，会爆上下文）。

## 如何用命令消费输出（输出侧）

| 本端口 | 语义 | 下游接法 | 允许的工具电池（白名单 opId） |
|--------|------|----------|-------------------------------|
| `out_0` | 挂好三层子节点的完整水域 scene | 直接 → 下一组 `in_0` / `tree_merge` 汇总 | `tree_merge`, `scene_merge_subtrees`, `scene_output` |
| `out_1`/`out_2`/`out_3` | 单独 focus 浅/中/深其中一层 | 需要**只对某一层**再细化贴图/摆放时接下一组 `in_0` | `tree_merge`, `scene_merge_subtrees`, `scene_output` |
| `out_4`/`out_5`/`out_6` | 浅/中/深子节点绝对路径 | 配合 `scene_focus_path` 索引单层 | `text_panel`, `string_concat`, `scene_focus_path` |

### 常见消费模式

| 模式 | 何时用 | 命令链 |
|------|--------|--------|
| **直传** | 整片水域（含三层）交给下一模板 | `<G>.out_0` → `connect` → `<Next>.in_0` |
| **单层再细化** | 只想再处理深水（如加暗纹/涟漪） | `<G>.out_3` → `connect` → `<Next>.in_0` |
| **路径索引** | 之后用绝对路径再定位某一层 | `<G>.out_6`（DeepPath） → `scene_focus_path`(scene=`<G>.out_0`, path) |

### 输出侧禁止

- 把 `out_0`（三层未拆分的整体）误当某一层用；单层请用 `out_1`/`out_2`/`out_3`。
- 引用不存在的第四层（本模板固定三层：浅/中/深，无 Rest）。
