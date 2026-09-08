# 家具列表按 rank 拆分 (furniture_rank_split)

将家具对象数组按 rank 值拆成主列表和填充列表两段 JSON 字符串。

## 功能特点

1. **按 rank 拆分**：rank 1-7 进主列表，rank 8-9 进填充列表
2. **填充 rank 重置**：填充列表中第一条 rank 改为 1，第二条改为 2

## 适用情况

- 接在 `furniture_list_split` 电池之后，将解析出的家具数组分流给 furniture_placer 和 furniture_filler 两个后续节点

## 基本使用方法

将 `furniture_list_split` 电池的 `list` 输出连接到本电池的 `list` 输入，执行后从 `main_list` 和 `fill_list` 分别获取对应 JSON 字符串。

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| list | array | — | 家具对象数组，每个元素必须含 `rank` 字段 |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| main_list | string | rank 1-7 的家具，rank 保持原值，格式化 JSON 字符串 |
| fill_list | string | rank 8-9 的家具，rank 重置为 1、2，格式化 JSON 字符串 |

## 注意事项

1. **rank 判断**：以每条家具的 `rank` 字段数值为准，`rank >= 8` 进填充列表，其余进主列表。
2. **填充 rank 顺序**：按在数组中出现的先后顺序依次编为 1、2，与原始 rank 值无关。
