# 赛道栅格化 (track_mesh_rasterize)

将平滑中心线点序列用圆笔刷逐点描边，按指定宽度将赛道区域填充到二维网格中，输出可供后续管线使用的 outputGrid 和 outputNameList。

## 功能特点

1. **圆笔刷描边**：对每个中心线采样点绘制圆形区域，比法线偏移算法更稳定，无尖角问题
2. **标准输出格式**：输出符合项目规范的 `outputGrid` + `outputNameList`，可直接接入后续电池
3. **可配置掩码**：`trackId` 和 `bgId` 支持与现有场景的掩码体系对接
4. **任意网格尺寸**：宽高与骨架生成阶段解耦，可独立调整输出分辨率

## 适用情况

- 赛道生成管线的最终步骤，将曲线数据转为网格掩码
- 与 `track_skeleton_generate` + `track_spline_smooth` 配套使用

## 基本使用方法

1. 将 `track_spline_smooth` 的 `centerline` 接入本电池
2. `width`、`height` 与骨架生成阶段保持一致
3. 调节 `trackWidth`（建议 6~15）控制赛道宽度
4. 输出 `outputGrid` 可接入渲染电池或进一步处理

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| centerline | array | - | 中心线点列 JSON 字符串（来自 track_spline_smooth） |
| width | number | 100 | 输出网格列数 |
| height | number | 100 | 输出网格行数 |
| trackWidth | number | 8 | 赛道宽度（格子数） |
| trackId | number | 1 | 赛道区域掩码值 |
| bgId | number | 0 | 背景区域掩码值 |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| outputGrid | grid | 含赛道掩码的二维整数网格 |
| outputNameList | array | 掩码清单 `[{id,name}...]` |

## 注意事项

1. **宽高一致性**：`width`/`height` 应与 `track_skeleton_generate` 的同名参数保持一致，否则赛道会超出网格边界
2. **trackWidth 与 samplesPerSegment**：若 trackWidth 远大于相邻中心线点间距，会有部分重叠但不影响结果
3. **执行先后**：请先执行 `track_skeleton_generate` → `track_spline_smooth`，再执行本电池
