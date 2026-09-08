# 家具清单转名称清单 (furniture_list_to_namelist)

将家具清单（`rank/name/isGroup` 格式）转换为渲染器标准名称清单（`id/name/type` 格式）。

## 功能特点

1. **格式转换**：将 AI 家具推理结果中的 `rank` 字段映射为 `id`，保留 `name`，补充 `type` 字段
2. **类型可配置**：`type` 字段支持 `asset`（场景摆件）和 `tile`（地面砖块）两种值
3. **容错处理**：自动跳过格式不合法的条目，rank/name 缺失时不报错

## 适用情况

- AI 家具推理（LLM）输出家具清单后，需要接入渲染器图层系统
- 将 `furniture_list_split` / `furniture_rank_split` 的输出转换为 `grid_namelist_pack` 可接受的格式

## 基本使用方法

```
[AI 文本推理] → result → [furniture_list_split] → list
                                                      ↓
                                         [家具清单转名称清单] → nameList → [grid_namelist_pack]
```

1. 将上游家具清单连接到 `list` 端口
2. 通过 `type` 下拉选择 `asset`（家具摆件，默认）或 `tile`
3. 输出 `nameList` 接入 `grid_namelist_pack` 的 `nameList` 端口

## 输入参数

| 参数名 | 类型  | 默认值  | 说明 |
|--------|-------|---------|------|
| list   | array | —       | 家具清单，每项需含 `rank`（数字）和 `name`（字符串）字段 |
| type   | string | asset  | 输出的 type 字段值：`asset` 或 `tile` |

## 输出参数

| 参数名   | 类型  | 说明 |
|----------|-------|------|
| nameList | array | `{id, name, type}[]` 格式的渲染器名称清单，`id` 来自 `rank` |

## 注意事项

1. **isGroup 字段被忽略**：该字段仅用于家具放置逻辑，转换为名称清单时不需要
2. **id 值来自 rank**：若上游家具清单中 rank 有跳号（如 1、2、3、5），id 也会对应跳号，需确保与网格掩码值一致
3. **家具摆件选 asset**：通常家具应使用 `asset` 类型，`tile` 仅用于地面纹理类家具
