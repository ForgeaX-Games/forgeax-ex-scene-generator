# INDOOR_LAYOUT_SKILL — 游戏室内布局电池选用指南

本 Skill 帮助 AI 在进行游戏室内场景布局时，**判断当前情况该选用哪个电池**，以及如何正确配置它。

---

## 两个可用电池一览

| 电池 ID | 中文名 | 核心定位 |
|---------|--------|---------|
| `adaptive_room_furniture_placer` | 自适应逐房间家具放置器 | **批量**处理多个房间，自动识别连通区域，按面积分档放置 |
| `room_layout_placer` | 室内布局放置器 | **单个**房间的专属风格化布局，四种模式可选 |

---

## 第一步：判断选哪个电池

**核心判断标准是房间的用途和重要性，而不是 grid 里有几个房间。**

```
地图里的每个房间，逐一问自己：
        │
        ├─── 这个房间有特定功能/主题/氛围要求吗？
        │    （神庙、教室、Boss 房、宫殿宝库、工作坊……）
        │         ↓
        │    → 重要房间：单独拆出来，用 room_layout_placer
        │      选择对应的 layoutMode（grid / nested / symmetric / one_open）
        │
        └─── 这个房间是普通的、可批量处理的吗？
             （地牢小屋、民居、走廊侧室、仓库……）
                  ↓
             → 普通房间：保留在 roomGrid 里，用 adaptive_room_furniture_placer 批量处理
```

### 关键推论：一个 grid 里可以同时有两类房间

当地图中**既有重要房间又有普通房间**时，不能把整张 grid 交给某一个电池处理，正确做法是：

```
原始 roomGrid（含全部房间）
        │
        ├─── 提取重要房间的 mask → 逐个用 room_layout_placer 单独布置
        │    （每个重要房间单独一路管线，各自选 layoutMode）
        │
        └─── 从 roomGrid 中去掉重要房间区域 → 剩余部分交给
             adaptive_room_furniture_placer 批量布置
        │
        └─── 最后合并所有输出的家具网格 → fill_sort → render_preprocess
```

**如何提取重要房间的 mask？**
- 如果重要房间在地图生成阶段有独立标记（如分区 id），直接用 `mask_filter_by_value` 或 `grid_split_by_value` 提取
- 如果没有标记，手动写一个只包含该房间格子的 grid 数据（用 `text_panel` 直接输入）
- 去掉重要房间后的剩余 grid 用 `mask_subtract` 生成

---

## 第二步：两个电池的详细对比

### `adaptive_room_furniture_placer` — 自适应逐房间放置器

**最适合的场景：**
- 地牢地图，大量连通但独立的小房间
- 民居/村落，多间功能相似的房屋
- 楼层平面图，多个格间
- 不需要为每个房间设计独特风格时

**核心特性：**
- 自动用 BFS 找出所有独立连通区域，每个区域独立放置
- 按面积自动分三档：
  - 小房间（面积 ≤ 10）→ 只放 `small_xxx` 家具
  - 中房间（10 < 面积 < 40）→ 放 `small/medium` 家具
  - 大房间（面积 ≥ 40）→ 放所有尺寸
- 过小的区域（面积 < 6）自动跳过，不放家具
- 不需要 `layoutConfig`，只需一份家具清单

**局限：**
- 所有房间使用同一套家具清单，风格不能逐房间差异化
- 无法指定布局模式（网格/对称/嵌套/留空），只有自由贴边+居中模式
- 不适合有强烈叙事主题的核心房间

---

### `room_layout_placer` — 单房间特殊布局放置器

**最适合的场景：**
- 有强烈功能主题的重要房间（神庙、教室、宫殿宝库、工作坊）
- 需要特定空间感的房间（对称仪式感、整齐阵列、一侧留白）
- 地图中的 Boss 房、功能核心区、剧情触发点

**四种 layoutMode 速查：**

| 模式 | 关键词 | 典型房间 |
|------|--------|---------|
| `grid` | 整齐阵列、行列排布 | 教室、餐厅、酒馆、办公室、图书馆、祈祷室座位 |
| `nested` | 核心区+外围、主次分明 | 宫殿宝库、大堂枢纽厅、核心机房 |
| `symmetric` | 对称、仪式感、庄重 | 神庙、礼堂、地牢 Boss 房、圣殿 |
| `one_open` | 一侧留白、功能分区 | 庭院展厅、工作坊（操作前区留空）、玄关 |

**需要额外配置：** 必须同时提供 `layoutMode` 和 `layoutConfig`。
详见：[LAYOUT_CONFIG_SKILL.md](./room_layout_placer/LAYOUT_CONFIG_SKILL.md)

---

## 第三步：家具清单（两个电池通用）

**两个电池的 `furnitureList` 端口格式完全相同。**

完整格式规则、rank 分配、家具 ID 说明见：
**[FURNITURE_LIST_SKILL.md](./room_layout_placer/FURNITURE_LIST_SKILL.md)**

---

## 第四步：管线连接方式

### `adaptive_room_furniture_placer` 的典型连接

```
[roomGrid 来源]                          → roomGrid
[doorGrid 来源]                          → doorGrid
[text_panel: furnitureList JSON] → str_to_list → furnitureList
[number_const: 种子]                     → seed
                        ↓
          adaptive_room_furniture_placer
                        ↓
                   outputGrid（家具网格）
                   nameList（家具名称清单）
```

### `room_layout_placer` 的典型连接

```
[roomGrid 来源]                                      → roomGrid
[doorGrid 来源]                                      → doorGrid
[text_panel: furnitureList JSON] → str_to_list       → furnitureList
[text_panel: "grid"/"nested"/"symmetric"/"one_open"] → layoutMode
[text_panel: layoutConfig JSON]                      → layoutConfig
[number_const: 种子]                                 → seed
                        ↓
                 room_layout_placer
                        ↓
                   outputGrid（家具网格）
                   nameList（家具名称清单）
```

---

## 典型工程示例

### 示例 A：地牢地图（多房间批量）

```
地牢 roomGrid（含 20 个独立房间）
    ↓
adaptive_room_furniture_placer
    furnitureList: [武器架, 铁链架, 储物柜, 牢笼, 火炬架,
                    地漏, 铁链, 小箱子, 蜡烛]
    seed: 42
    ↓
统一输出所有房间的家具网格
```

### 示例 B：重要的神庙大厅（单间特殊布局）

```
神庙 roomGrid（单个连通区域）
    ↓
room_layout_placer
    layoutMode: "symmetric"
    layoutConfig: {"symmetryV": true, "symmetryH": false}
    furnitureList: [祭坛, 神像台, 香炉, 供台, 烛架,
                    圣火盆, 地毯, 蜡烛台, 花供]
    seed: 0
    ↓
对称庄重的神庙家具布局
```

### 示例 C：混合场景（地牢普通房间 + Boss 房 + 神庙）

地图里有三类房间：大量普通地牢小房间、一个 Boss 房、一个神庙。

**第一步：识别哪些是重要房间**
- Boss 房：重要，需要 `nested` 模式（核心区放 Boss 相关道具）
- 神庙：重要，需要 `symmetric` 模式（对称仪式感）
- 其余所有小房间：普通，批量处理

**第二步：拆分 grid**
```
原始 roomGrid
    ├── mask_filter(Boss房区域)   → bossMask
    ├── mask_filter(神庙区域)     → templeMask
    └── mask_subtract(原始 - Boss - 神庙) → dungeonMask（剩余普通房间）
```

**第三步：三路并联布置**
```
bossMask   → room_layout_placer(nested, Boss专属家具清单)   → bossGrid + bossNameList
templeMask → room_layout_placer(symmetric, 神庙家具清单)    → templeGrid + templeNameList
dungeonMask→ adaptive_room_furniture_placer(通用地牢家具)   → dungeonGrid + dungeonNameList
```

**第四步：合并输出**
```
bossGrid + templeGrid + dungeonGrid
    → 各自经 merge(grid + nameList) 后
    → fill_sort(多路输入)
    → render_preprocess
```

---

## 参考文件

- 家具清单构造：[FURNITURE_LIST_SKILL.md](./room_layout_placer/FURNITURE_LIST_SKILL.md)
- 单间布局配置：[LAYOUT_CONFIG_SKILL.md](./room_layout_placer/LAYOUT_CONFIG_SKILL.md)
