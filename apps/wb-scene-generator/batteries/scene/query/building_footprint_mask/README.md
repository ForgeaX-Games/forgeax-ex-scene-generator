# building_footprint_mask — 建筑占地掩码

从 **focus 在建筑节点上** 的 scene 输入提取占地掩码 grid。

## 适用范围（读前先分清）

| 场景 | 是否用本电池 |
|------|----------------|
| 要为 **一栋房子/建筑生成贴图/资产**（含手动放的装饰建筑；Scene footprint → 2D PART C `dechouse_gen`） | ✅ **房子默认走这条** |
| **纯结构化盖楼**用引擎内置墙材渲染、不要单独房子贴图 | ❌ |
| 小物件 **object** / **tile** 贴图（树、道具、地块） | ❌ → PART A / PART B |

本电池是 **房子贴图链** 的 Scene 侧第一步：要给房子出贴图就从这里取占地掩码。

## 输入

| 端口 | 说明 |
|------|------|
| `scene` | **focus 必须落在单栋建筑**（或该建筑子树根）的 scene；需先用 `scene_focus_path` 设好 path，再接入本电池 |
| `z` | 可选；指定则只统计 `voxel.z === z`，缺省为列投影（任意高度） |
| `doorNames` | 门子节点名，逗号分隔；默认 `outer_door` |

### path 从哪来（Sino 必读）

1. **必须先跑 `ArchitectureStructures`** — `outer_door` 只在该模板组跑完后才存在；仅 `ArchitectureRegions` 不够。
2. **path 前缀用 `ArchitectureRegions.out_1`(BuildingPath)** — 运行时句柄（形如 `/architecture_0`），与 PathConnection POI 进阶档同一来源；**不是** AddBaseGrid 的 BaseName。
3. **典型接法**：
   - `ArchitectureRegions.out_1` → `scene_focus_path.path`
   - `ArchitectureStructures.out_0` → `scene_focus_path.scene`
   - `scene_focus_path.out` → 本电池 `scene`（单栋）
   - 或多栋：`scene_focus_path` → `scene_focus_children` → 本电池（DataTree 批量）

典型上游：`scene_focus_path`（单栋）或 `scene_focus_children`（扇出后每栋一个 focus scene）。

## 输出 grid 语义

| 值 | 含义 |
|----|------|
| 0 | 空 |
| 1 | 占地（已使用区域） |
| 2 | 门（`doorNames` 子树体素；覆盖同坐标的 1） |

**尺寸**：按子树体素并集的**最小包围盒**裁剪，**不是**节点 `bounds` 画布或整块区域尺寸。

另输出 `width`/`height`、`originX`/`originY`（父坐标系下包围盒左上角）、`cellCount`、`doorCount`。

## 参考电池

- `node_explode` — 读 focus 节点体素与子节点
- `voxel_slice` — 体素 → 2D grid 切片
- `grid_size` — 非零包围盒尺寸

## 示例管线片段（Scene → 2D 对齐）

**顺序**：`ArchitectureRegions`（拿 BuildingPath）→ **`ArchitectureStructures`**（生成门）→ path 聚焦 → 掩码 → JSON

```
ArchitectureRegions.out_1 (BuildingPath) ──→ scene_focus_path.path
ArchitectureStructures.out_0 ──────────────→ scene_focus_path.scene
scene_focus_path.out
  → building_footprint_mask（单栋；或多栋时先 scene_focus_children 扇出）
  → grid_to_json
  → … contract / 2D house_template.spec …
```

### 掩码契约（与 2D 侧对齐）

| 值 | Scene（本电池） | 2D（`house_template.spec`） |
|----|-----------------|------------------------------|
| 0 | 空 | 空 |
| 1 | 占地 | 房顶/footprint |
| 2 | 门（`doorNames` 子树） | **预设门位**（不再随机 `AddDoors`） |

当 spec **不含 2** 时，`house_template.doorCount` 仍按旧逻辑随机分配门。

### Sino 对接要点

1. **Scene 侧**：`building_footprint_mask` → `grid_to_json` 得到 `json` 字符串。
2. **同一份 `json`** 同时作为 `house_template.spec`、`house_footprint.spec`、`grid_json_to_size.json` 的输入（保证尺寸与门位一致）。
3. **`height` / `imageSize`**：从 `grid_json_to_size` 或 scene 输出的 `width`/`height` 推导，两 workbench 使用相同数值。
4. **批量**：DataTree 扇出后每栋建筑一条 mask JSON；2D 侧可用三维数组 `[[[...]], [[...]]]` 或多次 execute。

