# 规则装饰物 (decoration_border)

接收单张基准网格，在其周围按规则摆放 1×1 装饰物，输出仅含装饰物的多值网格与名称清单。支持随机/间距随机/等距/顺序填充，以及正负偏移距离。

## 数据格式（DataTree）

输入 `inputGrid` 与输出 `outputGrid` 均为 `grid` / `access:item`：每次只处理单张网格，网格列表由引擎自动逐张 fanout / 重组。多种装饰物各占一个递增填充值（从本网格 `max+1` 起），合并在同一张多值网格中输出；`nameList` 给出每个填充值对应的名称，下游可按值拆分（`grid_split_by_value`）再分别命名。

## 功能特点

1. **单网格处理**：每次处理一张基准网格，列表由 DataTree 引擎负责
2. **偏移距离控制**：有符号偏移——正值在外围、0 在边界层、负值在内侧（Chebyshev 距离度量）
3. **四种填充方式**：随机（random）、间距随机（spaced_random）、等距（equidistant）、顺序（sequential）
4. **多装饰物**：`decorationName` 支持单名称、多名称（轮转分配）或 `[{名称:数量}]` 对象数组（各自独立数量）
5. **可复现结果**：固定随机种子可获得完全一致的输出

## 输入参数

| 参数名 | 类型 | access | 默认值 | 说明 |
|--------|------|--------|--------|------|
| inputGrid | grid | item | — | 单张基准网格，非零区域作为参考边界 |
| decorationName | string | — | "" | 装饰物规格：单名称 / 多名称（逗号等分隔）/ `[{名称:数量}]` |
| count | number | item | 20 | 摆放装饰物数量，超出可用位置时取全部 |
| rotate | bool | item | false | 保留参数（1×1 装饰物旋转无效果） |
| fillMode | string | item | "random" | random / spaced_random / equidistant / sequential |
| offset | number | item | 1 | 偏移格数：正数=外围，0=边界层，负数=内侧 |
| startCount | number | item | 4 | sequential 模式专用：随机起始点数量 |
| itemSpacing | number | item | 8 | sequential 模式专用：相邻装饰物边缘间距 |
| seed | number | item | 0 | 随机种子，0 使用当前时间戳 |

## 输出参数

| 参数名 | 类型 | access | 说明 |
|--------|------|--------|------|
| outputGrid | grid | item | 仅含装饰物的单张多值网格，每种装饰物一个递增填充值（从 max+1 起） |
| nameList | array | item | 名称清单 `[{id, name, type:'asset'}]`，仅含实际出现的装饰物条目 |

## 偏移距离说明

偏移使用 Chebyshev（棋盘）距离：`1`=外围第 1 圈空格，`2`=外围第 2 圈，`0`=边界层（最外一圈非零格），`-1`=内侧第 1 圈，`-2`=内侧第 2 圈。

## 注意事项

1. 多种装饰物合并在一张多值网格里输出；要分别成节点时下游先 `grid_split_by_value` 再 `grid2node`
2. `equidistant` 以所有边界点质心为基准计算角度，适合凸形单连通区域；复杂形状建议 `random`
3. 固定 seed 且输入不变时输出一致；seed=0 每次运行结果不同
