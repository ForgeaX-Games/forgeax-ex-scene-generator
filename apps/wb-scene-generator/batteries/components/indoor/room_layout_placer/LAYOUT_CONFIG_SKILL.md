# LAYOUT_CONFIG_SKILL — room_layout_placer 布局配置构造指南

本 Skill 指导 AI 为 `room_layout_placer` 电池构造 `layoutConfig` 字符串，并正确组装 `furnitureList`。

---

## 电池接口总览

| 端口 | 类型 | 说明 |
|------|------|------|
| `roomGrid` | grid | 房间可用格网格 |
| `doorGrid` | grid | 门网格（可选） |
| `furnitureList` | array | 全量家具清单（含 rank，内置拆分） |
| `layoutMode` | string | `"grid"`、`"nested"` 或 `"symmetric"` |
| `layoutConfig` | string | JSON 字符串，模式专属参数 |
| `seed` | number | 随机种子，0=每次随机 |

---

## furnitureList 格式

每个元素为：
```json
{
  "rank": 1,
  "name": "家具名称",
  "furniture_id": "{size}_{shape} 或 组合ID",
  "type": "single",
  "placement": "edge"
}
```

**rank 拆分规则（电池内部自动执行）：**
- rank 1–7 → 主家具（furniture_placer 放置）
- rank 8–9 → 填充家具（furniture_filler 反复散布填充，直到空间不足）

**rank 分配规则（恰好 9 件）：**
- rank 1：定义房间功能与叙事的核心家具（卧室→床，牢房→囚笼，祭坛室→祭坛）
- rank 2–3：配合核心家具、强化功能的必要家具
- rank 4–5：增加细节与可探索性的次要贴边家具（书架、储物柜、工作台等），placement `"edge"`
- rank 6–7：居中家具，摆于中央不靠墙（地毯、雕塑、咨询台、展示台），placement `"center"`
- rank 8：贴边填充，一种适合沿墙反复摆放的小型家具，`small_square` 或 `small_rect`，placement `"edge"`
- rank 9：居中填充，一种适合在房间中央点缀的小型装饰，`small_square`，placement `"center"`

**家具 ID 规则：**

普通家具 ID 格式：`{size}_{shape}`，type 填 `"single"`

| size | 说明 |
|------|------|
| small | 占 1-2 格（床头柜、单人床、小储物架） |
| medium | 占 3-4 格（双人床、宝箱、沙发） |
| large | 占 5+ 格（祭坛、王座；房间面积 >100 格时使用） |

| shape | 说明 |
|-------|------|
| square | 长宽接近正方形（双人床、雕塑台、圆形地毯） |
| rect | 明显长方形（单人床、书架、长条地毯） |

家具组 ID，type 填 `"group"`（语义匹配时必须使用，不得用普通 ID 代替）：

| 语义 | 可选 furniture_id |
|------|-------------------|
| 书桌、办公桌、写字台、工作台（含椅） | `书桌_small` / `书桌_medium` |
| 餐桌、饭桌、会议桌（含椅） | `餐桌_small` / `餐桌_medium` |

**椅类限制：** 禁止单独输出普通椅子。椅子通过组合 ID 隐含输出。允许输出有独立叙事意义的特殊座具（王座、宝座、审讯椅、祭祀座等）。

**placement 取值：** `"edge"`（靠墙）| `"center"`（中心区域）

---

## layoutMode = "grid" 的 layoutConfig

### 字段说明

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `gridFurnitureName` | string | `"课桌"` | 网格主体家具名称（对应 furnitureList 中的 name） |
| `gridUnitW` | number | `2` | 单个网格家具的格宽（列方向） |
| `gridUnitH` | number | `1` | 单个网格家具的格高（行方向） |
| `topFurnitureName` | string | `"讲台"` | 顶部贴墙单件家具名称 |
| `topUnitW` | number | 自动 | 顶部家具格宽（不填 = 自动对齐网格总宽） |
| `topUnitH` | number | `1` | 顶部家具格高 |

行列数由房间尺寸自动推算，无需手动指定。

### 场景示例

**教室（课桌 + 讲台）：**
```json
{
  "gridFurnitureName": "课桌",
  "gridUnitW": 2,
  "gridUnitH": 1,
  "topFurnitureName": "讲台",
  "topUnitH": 1
}
```

**餐厅（餐桌 + 吧台）：**
```json
{
  "gridFurnitureName": "餐桌",
  "gridUnitW": 2,
  "gridUnitH": 2,
  "topFurnitureName": "吧台",
  "topUnitH": 1
}
```

**办公室（工位 + 前台）：**
```json
{
  "gridFurnitureName": "工位",
  "gridUnitW": 2,
  "gridUnitH": 1,
  "topFurnitureName": "前台",
  "topUnitW": 6,
  "topUnitH": 2
}
```

**图书馆（书架竖排 + 服务台）：**
```json
{
  "gridFurnitureName": "书架",
  "gridUnitW": 1,
  "gridUnitH": 3,
  "topFurnitureName": "服务台",
  "topUnitW": 4,
  "topUnitH": 1
}
```

---

## layoutMode = "nested" 的 layoutConfig

### 字段说明

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `nestedZoneRatio` | number | `0.4` | 子区域占总可用面积的比例（0.1–0.7） |
| `zoneFurnitureList` | array | 回退到总 furnitureList | 子区域专属家具清单（格式同 furnitureList，内部同样做 rankSplit） |

**逻辑：**
- 子区域（贴某角落的矩形）：使用 `zoneFurnitureList` 的 main/fill
- 剩余空间：使用总 `furnitureList` 的 main/fill

**zoneFurnitureList 构造规则**

家具 ID、type、placement、size/shape、组合 ID、椅类限制等通用规则与 `furnitureList` 完全一致，详见同目录下的 **`FURNITURE_LIST_SKILL.md`**。

以下是 `zoneFurnitureList` 相对于 `furnitureList` 的**差异点**：

- **件数与格式完全相同**：同样恰好 9 件，rank 1–9 各一条，字段格式完全一致
- **家具内容必须差异化**：`zoneFurnitureList` 与 `furnitureList` 中选用的家具**不应重复**——子区域放置高价值、叙事核心物品（宝箱、神坛、铸造台、壁炉等），剩余空间的 `furnitureList` 放置配套的普通散布家具，两者共同构成完整的房间叙事
- **rank 1 语义不同**：`furnitureList` 的 rank 1 定义整个房间功能，`zoneFurnitureList` 的 rank 1 定义子区域的核心物品
- **rank 8/9 也应差异化**：子区域的填充家具应与整体房间的填充家具不同，体现两个区域各自的主题


---

## 如何在管线中连接

1. 用 `text_panel` 电池填写 `layoutConfig` JSON 字符串（可直接粘贴上面的示例），连到 `room_layout_placer.layoutConfig` 端口
2. 用 `text_panel` 填写 `furnitureList` JSON 数组字符串，经 `str_to_list` 或 `furniture_list_split` 解析后连到 `furnitureList` 端口
3. `layoutMode` 用 `text_panel` 写 `"grid"` 或 `"nested"`，连到 `layoutMode` 端口

### 典型管线连接图

```
[json__room_data] → str_to_dict → dict_get_by_key(grid) → roomGrid
[json__door_data] → str_to_dict → dict_get_by_key(grid) → doorGrid
[text_panel: furnitureList JSON] → str_to_list → furnitureList
[text_panel: "grid"/"nested"/"symmetric"/"one_open"] → layoutMode
[text_panel: layoutConfig JSON]               → layoutConfig
[text_panel: seed 数字]                        → seed
                                         ↓
                              room_layout_placer
                                         ↓
                         outputGrid → merge → fill_sort → render_preprocess
                         nameList   → merge ↗
```

---

---

## layoutMode = "symmetric" 的 layoutConfig

### 对称规则

所有主家具（rank 1-7）按以下方式放置：
- 在房间"半区"内随机找到一个无碰撞位置
- 自动在对称位置放置同名家具的镜像件
- 若恰好落在对称轴上，只放一件（不镜像）
- 双轴对称时，在房间中心额外放置最后一件主家具作为焦点

填充家具（rank 8-9）同样做对称填充：在半区随机找位后自动镜像，反复放置直到空间不足。

```
纵轴对称（左右）:     横轴对称（上下）:     双轴对称:
┌────┬────┐           ┌─────────┐           ┌────┬────┐
│ 书架│书架│           │  书架   │           │书架│书架│
│    │    │           ├─────────┤           ├────┼────┤
│ 沙发│沙发│           │  书架   │           │书架│书架│
└────┴────┘           └─────────┘           └────┴────┘
```

### 字段说明

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `symmetryV` | boolean | `true` | 纵轴对称（左右镜像） |
| `symmetryH` | boolean | `false` | 横轴对称（上下镜像） |

---

## layoutMode = "one_open" 的 layoutConfig

### 逻辑

将房间指定一侧按比例划出矩形空余区，该区域内**禁止放置任何家具**（视觉上形成留白/庭院/过道）。其余可放置区按普通 `furniturePlacer` + `furnitureFiller` 流程放置主家具和填充家具。

```
openSide="top", openRatio=0.3:        openSide="left", openRatio=0.4:

┌─────────────────┐                   ┌────────┬────────────┐
│   ░░ 空余区 ░░  │  ← 上侧 30%       │        │  □ □ 家具  │
├─────────────────┤                   │空余区  ├────────────┤
│  □ □ □ □ 家具  │                   │ 40%   │  □ □ □     │
│  □ □ □ □ 家具  │                   │        │  □ 填充     │
└─────────────────┘                   └────────┴────────────┘
```

### 字段说明

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `openSide` | string | `"top"` | 空余区所在侧：`"top"` / `"bottom"` / `"left"` / `"right"` |
| `openRatio` | number | `0.3` | 空余区占总可用面积的比例（0.1–0.9） |

**选取建议：**
- `openSide`：对应房间里需要留空的方向（如庭院在上方则选 `"top"`，过道在左侧则选 `"left"`）
- `openRatio`：留空比例越大，可放家具的区域越小；一般 0.2–0.4 比较合适，超过 0.6 家具区会很拥挤

---

## 快速决策：选哪种模式？

| 场景特征 | 推荐模式 |
|----------|----------|
| 规则排列的主体（教室/餐厅/办公室/图书馆） | grid |
| 有一个特殊核心区 + 普通散布（宫殿/神庙/酒馆） | nested |
| 大型仓库/展览馆，分区明显 | nested (zoneRatio=0.5) |
| 小房间（<10×10），家具不多 | grid（行列数自动缩减） |
| 宗教/礼仪场所，需要庄重对称感（神庙/圣殿/礼堂） | symmetric |
| 左右对称的宫廷/大厅 | symmetric (symmetryV=true) |
| 上下对称的走廊/通道型空间 | symmetric (symmetryH=true) |
| 四象限完全对称（祭祀厅/镜厅） | symmetric (symmetryV=true, symmetryH=true) |
| 一侧需要大面积留白（庭院、过道、展示区、舞台前区） | one_open |
| 入口处留出缓冲空间（玄关/门厅） | one_open (openSide="bottom", openRatio=0.25) |
| 侧翼留走廊或陈列通道 | one_open (openSide="left"/"right", openRatio=0.3) |
