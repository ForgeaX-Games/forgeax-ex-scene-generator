# 模板电池 README 文档标准（SSOT）

每个 `batteries/templates/**/<BatteryName>/README.md` **必须**包含以下两大块（与功能说明、端口表并列，不可省略）：

---

## 1. 如何用命令调用（输入侧）

说明 **Workbench / UI / HTTP** 如何把数据喂进本模板。AI 场景编排使用
Scene Script，不调用模板 catalog 或 raw graph mutation API。

### 通道 A · 实例化模板组

```json
{ "method": "POST",
  "path": "/api/v1/group-templates/<projectId>/instantiate",
  "body": { "templateId": "<Basename>",
            "groupId": "<可选稳定句柄>", "position": { "x": 0, "y": 0 },
            "opts": { "actor": "workbench", "label": "实例化 <Basename>" } } }
```

> 这是人类/Workbench HTTP 路径；UI Templates 面板提供等价拖放操作。

### 通道 B · Workbench 接线

对每个 **必接 / 建议接** 的 `in_*`，给出可照抄的 `createNode` + `connect` ops：

| 本端口 | 上游 opId | connect 示例 |
|--------|-------------|--------------|
| `in_0` | … | `{ "type":"connect", "source":{…}, "target":{ "nodeId":"<G>", "port":"in_0" } }` |

**常见错误：**

- 顶层 `createNode` 使用 `alg_*` / `rect_grid` / `grid2node` / `add_child` 等模板内部 opId
- `manual_points` 输出端口名写错（正确是 **`point`**，不是 `points`）
- `tree_merge` 缺 `params.inferredAccess` / `inferredType` / `portCount`

### 等价 CLI（人类操作，可选）

与 applyBatch **同一套 op schema**，用 `forgeax node create` / `forgeax node connect` 或 `forgeax pipeline apply --ops '[…]'`。

### 读回验证（execute 后 jq）

```bash
curl -s …/execute -d '{}' | jq '.outputs.<G>.out_0[0].items[0].tree.children[].name'
```

> ⚠️ 禁止整体 dump `outputs`（含全 voxel，会爆上下文）。

---

## 2. 如何用命令消费输出（输出侧）

对每个 **`out_*`**，说明下游如何接：

| 本端口 | 语义 | 下游接法 | 常用工具电池 |
|--------|------|----------|-------------------------------|
| `out_0` | … | 直接 → 下一组 `in_0` / `tree_merge` | `tree_merge`, `scene_merge_subtrees`, `scene_output` |
| `out_1` | … | … | … |

### 常见消费模式（按场景选用）

| 模式 | 何时用 | Workbench 命令链 |
|------|--------|------------------------|
| **直传** | 整棵产物给下一模板 | `<G>.out_N` → `connect` → `<Next>.in_0` |
| **汇总** | 多组 Scene 视图合并 Preview | 各组 `{ label:"Scene", portName:"out_N" }` → 根 `tree_merge` → `tree_flatten` → `scene_merge_subtrees` → `scene_output`；领域口/Rest 禁止接 merge |
| **路径索引单个子节点** | 只要某一个子区/子建筑 | `text_panel`(绝对 path) 或 `string_concat` → `scene_focus_path`(scene+path) → 下一组 `in_0` |
| **扇出全部子节点** | 对每个子区并行施工 | `scene_focus_children`(scene) → `tree_merge`(item,scene) 或逐 branch 接线 |
| **读属性** | 读 focus 节点 metadata | `scene_get_attribute`（人类/Workbench） |

**路径格式：** 绝对路径，以 `/` 开头，如 `/父区域/划分子区域1`。须与 `in_3` 子区名、父节点 BaseName 一致。

### 输出侧禁止

- 引用已删除端口（模板 CHANGELOG 须同步）
- 把 **`out_0`（未 focus 的 raw grid）** 当装饰链入口（若模板区分 focus / raw）
- 对 **list/tree 端口** 用错 `tree_merge.inferredAccess`（scene=tree，point2d/number/string 列表=item）

---

## 3. 文档维护

- 新增模板：README 从本标准复制骨架，填端口表 + 两节命令示例 + **已验证 projectId**（可选）。
- 改 exposedPorts：同步更新 README 和 `TEMPLATES_INDEX.md`。

## 4. 参考范例

| 模板 | 输入命令完整度 | 输出消费完整度 |
|------|----------------|----------------|
| **AddBaseGrid** | ★★★ | ★★（待补输出消费表） |
| **AreaPartition** | ★★★ | ★★★（含 path 索引 + 扇出） |
| **PathConnection** | ★★★ | ★★（POI 进阶档 + Rest 链） |
