# 自然装饰填充 (natural_decoration)

将单张输入网格所有非零格子视为目标区域，按装饰物清单多轮散布装饰物；输出单张多值网格（每种装饰物一个递增 id，其余为 0）与名称清单。

## 数据格式（DataTree）

输入 `inputGrid` 与输出 `outputGrid` 均为 `grid` / `access:item`：每次只处理单张网格，网格列表由引擎自动逐张 fanout / 重组。多种装饰物合并在同一张多值网格中输出（每轮在上一轮剩余格子中继续填充，互不重叠），下游可 `grid_split_by_value` 按值拆分后分别命名。

## 填充算法

`random` 均匀随机 / `cluster` 簇状聚集 / `edge` 边缘优先 / `noise` 噪声分布 / `poisson` 泊松盘（间距均匀）。

## 输入参数

| 参数名 | 类型 | access | 默认值 | 说明 |
|--------|------|--------|--------|------|
| inputGrid | grid | item | — | 单张输入网格，所有非零格子为可填充区域 |
| decorations | array | — | — | `[{名称:密度}]` / `[{name,density}]` / 字符串（JSON 或 `树木:40,花草:20`） |
| algorithm | string | item | "random" | random / cluster / edge / noise / poisson |
| densityMode | boolean | item | true | true=密度（density 为百分比 0-100）；false=数量（density 为准确格数） |
| seed | number | item | 0 | 随机种子，0 每次随机不同 |

## 输出参数

| 参数名 | 类型 | access | 说明 |
|--------|------|--------|------|
| outputGrid | grid | item | 多值网格，每种装饰物一个递增 id（从输入网格 max+1 起），其余为 0 |
| outputNameList | array | item | 实际写入网格的装饰物条目 `[{id, name, type:'asset'}]` |
