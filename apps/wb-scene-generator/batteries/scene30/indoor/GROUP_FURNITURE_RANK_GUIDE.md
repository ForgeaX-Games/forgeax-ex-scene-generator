# 组合家具编号偏移规则

> 本文档描述 `furniture_placer` 中组合家具（group）的编号分配与 rank 平移机制，
> 适合在扩展家具电池或修改编号逻辑时参考。

---

## 一、背景：为什么需要编号偏移

旧版本中，group 家具的所有子组件统一写入 `effectiveRank + 10`，不同子组件共享同一个编号，无法区分。

新机制中，group 家具的每个子组件占据一个**独立的连续编号槽**，从而支持：

- 按编号精确识别每个子组件（如区分"桌"和"椅"）
- 通过 `furnitureIndex` 还原每个编号对应的家具名称和类型

---

## 二、核心概念

### 2.1 groupSlots（编号槽数）

```
groupSlots = mask 中的最大值
```

例如，mask 中出现了 `1`、`2`、`3`，则 `groupSlots = 3`，该组合家具占用 3 个连续编号。

单件家具（single）的 mask 只有 `0` 和 `1`，`groupSlots = 1`。

### 2.2 effectiveRank（有效编号）

```
effectiveRank = rankOffset + item.rank + rankShift
```

| 变量 | 含义 |
|------|------|
| `rankOffset` | 旧家具列表（`oldFurnitureIndex`）中的最大 rank，保证新旧编号不重叠 |
| `item.rank` | 当前家具在清单中的优先级编号（1-based，清单顺序固定） |
| `rankShift` | 当前家具之前的所有 group 家具多占用的编号数之和（初始为 0，逐次累加） |

### 2.3 maskValue 与编号的对应关系

| mask 值 | 写入 maskA 的编号 | 含义 |
|---------|-----------------|------|
| 1 | `effectiveRank` | 家具主体（第 1 个组件） |
| 2 | `effectiveRank + 1` | 第 2 个组件（如椅子） |
| 3 | `effectiveRank + 2` | 第 3 个组件 |
| k | `effectiveRank + (k-1)` | 第 k 个组件 |
| 0 | 不写 maskA，写 maskB=1 | 过道预留格 |

---

## 三、rankShift 的累加规则

`rankShift` 在放置循环中动态维护：

```
初始：rankShift = 0

每放置一件家具后：
  if isGroup 且 groupSlots > 1:
    rankShift += groupSlots - 1
```

**含义**：group 家具比单件家具"多占"了 `groupSlots - 1` 个编号槽，后续所有家具的 effectiveRank 需要整体向后平移相同数量，避免编号冲突。

---

## 四、完整示例

**初始条件：**
- 旧家具列表最大编号 `rankOffset = 5`
- furnitureList（按 rank 排序）：

| item.rank | 名称 | 类型 | groupSlots（取决于实际放置的模板） |
|-----------|------|------|----------------------------------|
| 1 | 书桌 | group | 2（mask 有 1、2） |
| 2 | 衣柜 | single | 1 |
| 3 | 餐桌 | group | 3（mask 有 1、2、3） |
| 4 | 盆栽 | single | 1 |

**逐步计算：**

```
初始：rankShift = 0

放置 书桌（rank=1）：
  effectiveRank = 5 + 1 + 0 = 6
  mask=1 → maskA 写 6（书桌_桌）
  mask=2 → maskA 写 7（书桌_椅）
  groupSlots=2，rankShift += (2-1) = 1
  → rankShift = 1

放置 衣柜（rank=2）：
  effectiveRank = 5 + 2 + 1 = 8
  mask=1 → maskA 写 8（衣柜）
  groupSlots=1，rankShift 不变
  → rankShift = 1

放置 餐桌（rank=3）：
  effectiveRank = 5 + 3 + 1 = 9
  mask=1 → maskA 写 9（餐桌_桌）
  mask=2 → maskA 写 10（餐桌_椅）
  mask=3 → maskA 写 11（餐桌_椅2）
  groupSlots=3，rankShift += (3-1) = 2
  → rankShift = 3

放置 盆栽（rank=4）：
  effectiveRank = 5 + 4 + 3 = 12
  mask=1 → maskA 写 12（盆栽）
  groupSlots=1，rankShift 不变
```

**最终 furnitureIndex：**

| rank（maskA 中的值） | name |
|--------------------|------|
| 6 | 书桌_桌 |
| 7 | 书桌_椅 |
| 8 | 衣柜 |
| 9 | 餐桌_桌 |
| 10 | 餐桌_椅 |
| 11 | 餐桌_椅2 |
| 12 | 盆栽 |

编号连续，无跳空，每个 maskA 非零值都能在 furnitureIndex 中找到对应条目。

---

## 五、子组件命名规则

子组件名称来自模板 JSON 的 `components` 字段：

```json
{
  "id": "书桌_small_edge0",
  "components": {"1": "桌", "2": "椅"}
}
```

拼接规则：

```
name = 家具名 + "_" + components[maskKey]
```

例：家具名为"书桌"，`components["1"]="桌"`，`components["2"]="椅"`
→ 生成 `书桌_桌`、`书桌_椅`

**兜底规则**（当 components 中没有对应 key 时）：
- `i=0`（maskValue=1）：直接使用家具名
- `i>0`（maskValue>1）：使用 `家具名_组件i`

---

## 六、关键约束

1. **furnitureList 必须按 rank 升序处理**：rankShift 是顺序累加的，乱序处理会导致编号错乱
2. **rankShift 仅跨家具间平移，不影响同一 group 内部的子组件编号**：子组件始终是 `effectiveRank + (k-1)`
3. **放置失败的家具不累加 rankShift**：只有成功放置后才更新 rankShift，保证清单和网格一致
4. **furnitureIndex 的 rank 字段 = maskA 中实际写入的值**：两者严格对应，可通过 furnitureIndex 还原每个网格格子的含义
