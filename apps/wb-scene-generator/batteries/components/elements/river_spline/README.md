# 河流样条化 (river_spline)

将一组折线控制点经过**法线扰动 + 五种平滑算法**生成自然弯曲的河流，光栅化写入单张二维整数网格。算法逻辑完整迁移自 `picture_processor.py`。

> **DataTree 数据格式**：`inputGrid` / `outputGrid` 均为 `grid`（`access: item`）。本电池每次只处理单张网格，网格列表由引擎按 DataTree 自动逐张 fanout / 重组。

## 功能特点

1. **两阶段流水线**：① 控制点沿法线随机扰动（增加随机弯曲）→ ② 选择平滑算法生成流畅曲线。
2. **五种平滑算法**：noise / bezier / cubic_spline / moving_avg / gaussian，覆盖从折线到光滑曲线的完整需求。
3. **算法下拉框**：`algorithm` 端口提供选项选择器，可在画布上直接切换算法。
4. **圆形笔刷光栅化**：以欧氏距离判断覆盖范围，边缘圆润无锯齿。
5. **自动掩码顺延**：河流填充值 = 输入网格最大值 + 1，不与已有层冲突。

## 适用情况

- 在地形/地图网格上沿指定路径绘制自然河流
- 需要比较不同平滑风格效果（可实时切换算法）
- 需要随机感较强（noise）或极度光滑（gaussian/cubic_spline）的河道

## 基本使用方法

1. 将上游地形电池的 `outputGrid` 连接到 `inputGrid`
2. 将控制点数组（`[[col,row],...]`）连接到 `控制点`
3. 在 `平滑算法` 下拉框选择算法
4. 调整扰动参数和算法专用参数后执行

## 算法说明

| 算法 | 关键参数 | 特点 |
|------|---------|------|
| **noise** | offsetMin/offsetMax | 折线扰动，不额外平滑，棱角最多 |
| **bezier** | bezierDegree | 分段贝塞尔曲线，平滑且局部可控 |
| **cubic_spline** | — | 累积弧长三次样条，曲线最自然（默认） |
| **moving_avg** | windowSize | 滑动窗口平均，简单高效，端点固定 |
| **gaussian** | sigma | 高斯核加权平均，边缘保持较好，端点固定 |

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| inputGrid | grid | — | 单张基准输入网格（DataTree 逐张处理） |
| points | array | — | 控制点 `[[col,row],...]`，至少 2 个 |
| algorithm | string | cubic_spline | 平滑算法选择器（下拉框） |
| riverWidth | number | 3 | 河流宽度（格），笔刷直径 |
| numMidPoints | number | 3 | 内部法线扰动点数量（0=不扰动） |
| offsetMin | number | -30 | 扰动法线偏移最小值（格） |
| offsetMax | number | 30 | 扰动法线偏移最大值（格） |
| segmentUniformity | number | 0.5 | 扰动点分布均匀度 [0,1] |
| windowSize | number | 5 | 移动平均窗口大小（仅 moving_avg） |
| sigma | number | 2.0 | 高斯核标准差（仅 gaussian） |
| bezierDegree | number | 3 | 贝塞尔曲线次数 1~6（仅 bezier） |
| seed | number | 0 | 随机种子，0=每次不同 |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| outputGrid | grid | 含河流掩码的输出网格，河流值 = max(input)+1 |

## 控制点格式

`points` 接受 `[[col, row], ...]` 格式（先列 X，再行 Y）：

```json
[[5, 2], [15, 10], [30, 8], [45, 18]]
```

## 注意事项

1. **算法专用参数**：`windowSize`/`sigma`/`bezierDegree` 各自只对对应算法生效，其他算法下这些参数会被忽略。
2. **numMidPoints=0**：关闭法线扰动，直接对原始控制点路径应用平滑算法，结果更规则。
3. **offsetMin/offsetMax 符号**：负值和正值分别代表法线两侧方向，设为对称范围（如 -30/30）可产生左右随机弯曲。
4. **控制点坐标**：`[col, row]` 格式，col 为 X 轴（列），row 为 Y 轴（行），注意不要写反。
5. **cubic_spline 要求**：至少需要 4 个控制点才能完整插值，点数过少会自动退回原始路径。
