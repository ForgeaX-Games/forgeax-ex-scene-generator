# 精准装饰物播撒 (precise_decoration_scatter)

以指定坐标为中心，在单张网格的目标区域内播撒一片自然装饰物。若中心坐标不在目标区域内，自动 BFS 就近吸附到最近的目标格，再从该落点向外播撒。

> **DataTree 数据格式**：`inputGrid` / `outputGrid` 均为 `grid`（`access: item`）。本电池每次只处理单张网格，网格列表由引擎按 DataTree 自动逐张 fanout / 重组。

## 功能特点

1. **精准中心定位**：用户指定 `[x, y]` 坐标作为播撒原点，适合有明确位置意图的场景布置。
2. **BFS 自动吸附**：若指定坐标不在目标区域内（值不等于 targetValue），全图 BFS 搜索最近合法格并以其为新中心，保证必定能播撒。
3. **多种装饰物**：装饰物清单支持多种类型，按列表顺序依次占用剩余目标格，前一种装饰物占用后剩余格子由后续使用。
4. **5 种播撒算法**：random（均匀）、cluster（中心密）、ring（环形）、poisson（间距均匀）、noise（噪声斑块），适应不同自然场景风格。
5. **多值网格输出**：每种装饰物一个递增 id 写入同一张 `outputGrid`，配合 `outputNameList` 可接 `grid_split_by_value` 拆分。

## 适用情况

- 已有场景设计意图（如"在水潭周围撒一圈芦苇"）时使用，比全区域随机散布更可控。
- 配合 AI Agent 根据描述生成带坐标的装饰物规则，再精确落位。
- 不适合大范围全区域散布场景，那种情况请用「自然装饰填充」电池。

## 基本使用方法

1. 将上游地形网格接入 `inputGrid` 端口。
2. 在 `center` 端口输入坐标 `[x, y]`（列号, 行号）；不填则从目标区域随机选点。
3. 在 `decorations` 端口输入装饰物清单，格式见下方说明。
4. 选择 `algorithm` 和调节 `scatterRadius`，按需设置 `seed`。

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| inputGrid | grid | - | 单张输入网格 `number[][]`（DataTree 逐张处理，目标值自动取最大值） |
| decorations | array | - | 装饰物清单，见下方格式说明 |
| center | array | - | 播撒中心坐标 `[x, y]`，不填则随机；支持数组或 JSON 字符串 |
| algorithm | string | "random" | 播撒算法：random / cluster / ring / poisson / noise |
| scatterRadius | number | 12 | 播撒半径（格子数），只有在此范围内的目标格才会参与 |
| seed | number | 0 | 随机种子，0 = 每次不同 |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| outputGrid | grid | 单张多值网格：每种装饰物一个递增 id，未放置处为 0 |
| outputNameList | array | 网格中实际出现的装饰物清单：`[{id, name, type}]`，type 固定为 asset |
| placedCount | number | 实际放置的装饰物格子总数 |

## 装饰物清单格式

```json
[
  { "decoration": "芦苇", "count": 20 },
  { "decoration": "野花", "count": 15 },
  { "decoration": "蘑菇", "count": 8 }
]
```

| 字段 | 类型 | 说明 |
|------|------|------|
| decoration | string | 装饰物名称，同名共享同一掩码 ID |
| count | number | 想放置的格子数量，实际数量不超过可用格子数 |

> 装饰物按列表顺序依次占用候选格：第二种装饰物只能放在第一种未占用的剩余格里。

## 播撒算法说明

| 算法 | 效果 | 适用场景 |
|------|------|---------|
| `random` | 在半径内均匀随机分布 | 通用，自然散乱 |
| `cluster` | 中心附近密集，边缘稀疏 | 灌木丛、花坛中心 |
| `ring` | 集中在约半径 55% 的环形区域 | 围绕水潭/建筑的装饰圈 |
| `poisson` | 泊松盘采样，间距均匀不扎堆 | 树林、石头等需要间隔的装饰 |
| `noise` | 基于空间噪声，产生自然斑块纹理 | 苔藓、草地等有机感强的场景 |

## BFS 吸附逻辑

```
输入坐标 (x, y)
    │
    └─ grid[y][x] == targetValue?
           ├─ 是 → 直接以 (x, y) 为中心播撒
           └─ 否 → BFS 全图搜索（无半径限制）
                      │
                      └─ 找到最近的 targetValue 格
                             │
                             └─ 以该格为新中心，播撒半径内的所有目标格
```

## 使用示例

### 输入示例

```json
{
  "inputGrid": "...",
  "center": [64, 32],
  "decorations": [
    { "decoration": "树木", "count": 25 },
    { "decoration": "灌木", "count": 15 }
  ],
  "algorithm": "cluster",
  "scatterRadius": 10,
  "seed": 42
}
```

### 输出示例

```json
{
  "outputGrid": "...",
  "outputNameList": [
    { "id": 5, "name": "树木", "type": "asset" },
    { "id": 6, "name": "灌木", "type": "asset" }
  ],
  "placedCount": 38
}
```

## 注意事项

1. **坐标从 0 起始**：`x` 是列号，`y` 是行号，均从 0 开始。
2. **目标值自动推断**：目标区域值自动取网格当前最大值，适合大多数流水线场景。
3. **装饰物 ID 顺延**：新装饰物 ID 从 `gridMax + 1` 开始递增，不会与现有掩码冲突。
4. **半径不足时**：若目标区域内可用格子少于 `count`，已有多少放多少，不会报错。
5. **DataTree 逐张处理**：网格列表由引擎自动逐张 fanout，相同 `center` 与装饰物清单应用于每张网格。
