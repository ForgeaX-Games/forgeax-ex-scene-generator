# 家具名称折叠 (furniture_name_collapse)

将逐房间家具放置器输出的家具索引和实体网格同步折叠：把同名家具在不同房间的所有像素值（rank）统一映射为一个新连续 id，网格和名称清单保持一致。

## 功能特点

1. **名称去重**：多个房间的同名家具（如"书桌"在10个房间各出现，rank 各不相同）折叠为同一条名称记录
2. **网格重映射**：maskA 中所有属于同名家具的像素值同步改写为新 id，保证网格与名称清单完全对齐
3. **连续编号**：新 id 从 1 起按首次出现顺序分配，紧凑无空洞
4. **顺序稳定**：以首次出现顺序为准，结果可复现

## 适用情况

- `per_room_furniture_placer` 或 `adaptive_room_furniture_placer` 后必须接本电池，才能正常送入渲染器
- 解决多房间导致的 furnitureIndex 200+ 条、maskA 像素值跳跃的问题

## 基本使用方法

```
per_room_furniture_placer
  .furnitureIndex → furniture_name_collapse.list
  .newMaskA       → furniture_name_collapse.maskA
      outputGrid → 渲染器 / fill_sort
      nameList   → 渲染器名称清单
      count      → 文本面板（可选，查看种数）
```

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| list | array | — | 家具索引 [{rank, name, ...}]，来自放置器 furnitureIndex |
| maskA | grid | — | 家具实体网格，像素值=rank，来自放置器 newMaskA |
| type | string | "asset" | 输出名称清单的 type 字段（asset / tile） |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| outputGrid | grid | 重映射后的家具网格，像素值为新连续 id（1起） |
| nameList | array | [{id, name, type}]，与 outputGrid 像素值一一对应 |
| count | number | 唯一家具种数 |

## 注意事项

1. **去重依据是 name 字符串**：`"书桌_椅子"` 和 `"书桌"` 是两条不同记录
2. **找不到映射的像素清零**：若 maskA 中存在 furnitureIndex 未覆盖的 rank 值，对应像素置 0
3. **id 与原 rank 无关**：输出 outputGrid 的像素值是重新编号的 id，不等于原 rank
