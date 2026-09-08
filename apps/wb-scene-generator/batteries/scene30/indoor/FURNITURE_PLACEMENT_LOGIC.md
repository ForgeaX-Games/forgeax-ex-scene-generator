# 家具布置算法设计文档

> 本文档描述 `furniture_placer` 和 `furniture_filler` 两个电池的完整内部逻辑，  
> 适合在扩展新布置电池或修改现有逻辑时参考。

---

## 一、数据层：三张网格的职责分工

家具系统用三张同尺寸二维整数网格描述房间状态：

| 网格 | 类型 | 值含义 | 更新时机 |
|------|------|--------|----------|
| `roomGrid`（layout）| 只读输入 | `1` = 可用格，`0` = 墙/出界 | 永不修改 |
| `maskA` | 读写 | `0` = 空，非零整数 = 家具编号（effectiveRank） | 每次放置后写入 |
| `maskB` | 读写 | `0` = 空，`1` = 过道预留 | 每次放置后写入 |

**关键约定：**
- `maskA` 和 `maskB` 在放置开始前**深拷贝**，不修改原始输入
- `maskA` 非零 = 实体占用；`maskB` 非零 = 过道/操作空间占用
- 两张掩码叠加后，非零格 = 不可再放置任何家具（含过道）

---

## 二、家具编号（effectiveRank）规则

```
effectiveRank = rankOffset + item.rank
```

- **`rankOffset`**：已有家具编号的最大值，从 `oldFurnitureIndex` 中取 `max(entry.rank)`
- **`item.rank`**：当前家具在清单中的优先级编号（从 1 开始）
- **普通家具主体**（mask=1）：写入 `effectiveRank`
- **组合家具主体**（mask=1）：写入 `effectiveRank`
- **组合家具子组件**（mask=2,3,...）：写入 `effectiveRank + 10`

示例（旧家具最大编号为 7，新家具 rank=3）：
```
effectiveRank = 7 + 3 = 10
主体格写 10
子组件格写 20（10+10）
```

**填充器特殊点**：同一类填充家具所有实例共用同一 effectiveRank（rank 值固定不变，多次放置写同一数字）。

---

## 三、模板库构建与查找

### 3.1 单件家具库（singleLib）

- 来源：`simple_furniture_demo.json`
- **建库 key = `size_shape`**，如 `small_square`、`medium_rect`
- 同一 key 下有多个变体（贴边4方向，或居中若干朝向）
- 查找时：`singleLib[item.furniture_id]` → 返回变体数组

### 3.2 组合家具库（groupLib）

- 来源：`desk_chair_set.json`
- **建库 key = 基础名称**（去掉 `_edge{N}` / `_center_{suffix}` 后缀）
  - `书桌_medium_edge0` → key = `书桌_medium`
  - `餐桌_small_center_h` → key = `餐桌_small`
- 查找时：`groupLib[item.furniture_id]` → 返回变体数组（含所有方向）

### 3.3 模板过滤

```
贴边家具 → 只取 placementEdges.length > 0 的变体
居中家具 → 只取 placementEdges.length === 0 的变体
```

---

## 四、碰撞检测逻辑（isValidPlacement）

判断在锚点 `(ar, ac)` 放置模板是否合法，分两个阶段检查：

### 阶段一：家具本体格（bodyCells）

```
单件家具：mask 值 === 1 的格
组合家具：mask 值 !== 0 的格（1=主体，2/3/...=子组件）
```

**每个本体格 (ar+dr, ac+dc) 必须同时满足：**
1. 在 `roomGrid` 范围内且值为 1（不出界、不进墙）
2. `maskA[r][c] === 0`（不与已有家具实体重叠）
3. `maskB[r][c] === 0`（不与已有过道重叠）

→ 本体格不允许与任何已占用区域重叠。

### 阶段二：家具过道格（aisleCells）

```
mask 值 === 0 的格
```

**每个过道格 (ar+dr, ac+dc) 的规则：**
- 若出界（超出网格范围）：**跳过**，不检查（视为墙外，默认通过）
- 若在界内且 `roomGrid[r][c] === 1`（是有效房间格）：
  - `maskA[r][c] !== 0` → **不合法**（过道不能压实体家具）
- 过道可以压 `maskB`（已有过道区），不检查 maskB

→ 过道格允许出界（贴边时过道可悬在墙外），但不能压实体家具。

---

## 五、贴边对齐检测（isEdgeAligned）

贴边家具必须真正紧贴房间内壁，检查方式：

1. 取本体格在该边方向上**最外侧**的坐标行/列
2. 检查这些格子是否有任意一个落在**预计算的边界格集合**中

```
贴上(edge=0)：本体中 row 最小的一排，至少一格是 top 边界格
贴下(edge=2)：本体中 row 最大的一排，至少一格是 bottom 边界格
贴右(edge=1)：本体中 col 最大的一列，至少一格是 right 边界格
贴左(edge=3)：本体中 col 最小的一列，至少一格是 left 边界格
```

边界格预计算（`computeEdgeCells`）：
- 某格 `layout[r][c] === 1` 且其上方格为 0 或出界 → 属于 top 边界
- 同理推导 bottom / left / right

---

## 六、候选位置生成

### 6.1 贴边候选（generateEdgeCandidates）

策略：以边界格为基准，反推锚点，再逐列（或逐行）枚举：

```
贴上(edge=0)：
  minDr = 本体格中最小的 dr
  对每个 top 边界格 (br, _)：
    anchorR = br - minDr     ← 让本体最上行对齐边界格行
    枚举所有 anchorC（0 到 cols-1）
    验证合法性 + 贴边对齐

贴右(edge=1)：
  maxDc = 本体格中最大的 dc
  对每个 right 边界格 (_, bc)：
    anchorC = bc - maxDc    ← 让本体最右列对齐边界格列
    枚举所有 anchorR
```

枚举后去重（Set 去掉重复锚点）。

### 6.2 居中候选（generateCenterCandidates）

全房间枚举所有 `(r, c)`，对每个点做 `isValidPlacement`，合法则加入列表。

### 6.3 候选采样上限（MAX_CANDIDATES = 30）

两种候选函数均在返回前执行采样截断：

```
若合法候选数 <= 30：直接返回所有候选
若合法候选数 > 30 ：用 PRNG 做无放回随机采样，返回恰好 30 个
```

采样函数 `sampleCandidates(candidates, rand)` 使用已有的 mulberry32 PRNG，保证同 seed 下采样结果可复现。

**为什么是 30：**  
大房间/简单家具时候选可超过数百，20 个房间并发若全量枚举评分，计算量随房间复杂度线性增长。固定上限 30 后，单件家具的候选评分次数恒为 O(30)，总计算量与房间大小无关，并发 20 个房间也不会成为瓶颈。  
代价：极少情况下可能错过全局最优位置，但评分机制已保证采样范围内的局部最优，实际布局质量影响极小。

---

## 七、评分函数（scorePlacement）

对每个候选锚点打分，取最高分放置，规则如下：

### 7.1 分散度（全部家具通用）

```
与已放置家具重心的距离，越远越好
score += min(dist, 8) × 1.5
```

上限 8 格，防止极端值。

### 7.2 边界均衡（仅贴边家具）

```
score += (最多使用边 - 当前边使用次数) × 2
```

优先选择使用次数少的边，让四面墙均衡分布家具。

### 7.3 靠墙惩罚（仅居中家具）

```
若距最近边界格 < 3 格：
  score -= (3 - 距离) × 2
```

居中家具应远离墙壁。

### 7.4 靠近中心加分（仅居中家具）

```
score += max(0, 4 - 距房间中心的距离) × 2
```

### 7.5 聚集惩罚（全部家具通用）

```
若与最近已放置家具距离 < 2 格：
  score -= (2 - 距离) × 3
```

防止家具扎堆。

---

## 八、放置写入（applyPlacement）

确定最优锚点后，遍历模板 mask 的每个格子写入两张掩码：

```
mask[r][c] === 1  → maskA[ar+r][ac+c] = effectiveRank
mask[r][c] > 1    → maskA[ar+r][ac+c] = effectiveRank + 10  （组合子组件）
mask[r][c] === 0  → 若在界内且 roomGrid 为 1：maskB[ar+r][ac+c] = 1
```

**过道写入条件**：过道格必须在 roomGrid 内（不出界），且必须是有效房间格（不是墙），才写 maskB。若过道格出界（贴边家具背对墙的情况），静默跳过。

---

## 九、填充器的额外逻辑

`furniture_filler` 在上述基础上增加了**循环放置**机制：

### 9.1 停止条件（两者满足任意一个停止）

```
条件1：连续 MAX_FAIL（5）次找不到合法位置
条件2：房间占用率 >= 上限
         贴边填充上限：65%
         居中填充上限：80%
```

### 9.2 占用率计算

```
占用率 = (maskA非零格数 + maskB非零格数) / roomGrid中值为1的总格数
```

注意：分子不是两者之和（同一格可能既有实体又有过道，但实际不会重叠），而是对每个房间格检查 `maskA!==0 || maskB!==0`。

### 9.3 每轮循环流程

```
while failCount < MAX_FAIL:
  if 占用率 >= 上限: break
  生成所有候选 → shuffle → 评分 → 取最优
  if 无合法位置: failCount++; continue
  放置 → 写掩码 → failCount = 0 → placedCount++
```

---

## 十、随机性机制

两个电池均使用 **mulberry32 PRNG**（纯整数运算，可复现）：

```typescript
function makePrng(seed: number): () => number { ... }
```

随机性作用在两处：
1. **模板列表 shuffle**：同一家具有多个方向变体时，随机打乱尝试顺序
2. **候选位置采样**：合法锚点超过 30 个时，用 PRNG 随机采样 30 个参与评分（≤30 时全量参与）

评分机制本身不变，随机性只影响**候选子集的选择**和**模板探索顺序**，不破坏布局质量。

---

## 十一、常见错误与排查

| 现象 | 原因 | 排查方法 |
|------|------|----------|
| 全部家具显示"无合法位置" | `roomGrid` 尺寸太小（如传入了 doorGrid 而非 roomGrid） | 查看 diagnostics 中"边界格数" |
| 某件家具显示"找不到模板" | `furniture_id` 与库 key 不匹配 | 查看 diagnostics 中"单件库/组合库 keys" |
| 家具全部贴同一面墙 | `isEdgeAligned` 未通过，其他边找不到位置 | 检查房间 layout，确认四面都有边界格 |
| 填充器放置数量为0 | 占用率在运行前已超上限，或 maskA/maskB 尺寸与 roomGrid 不一致 | 确认三张网格尺寸相同，检查初始占用率 |

---

## 十二、扩展新布置电池的建议

若需要开发新的布置逻辑（如行列规律摆放、区域划分摆放等），可复用以下函数：

- `buildSingleLibrary` / `buildGroupLibrary`：模板库构建
- `computeEdgeCells`：边界预计算
- `isValidPlacement`：碰撞检测（核心，建议直接复用）
- `applyPlacement`：掩码写入（固定格式，不应修改）

评分函数和候选生成函数可根据新逻辑完全替换。
