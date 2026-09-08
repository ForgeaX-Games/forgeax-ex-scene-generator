# 区域边界平滑 (region_boundary_smooth)

将多区域 ID 网格的锯齿断续边界转换为连续平滑曲线，三阶段处理。

## 算法流程

```
regionGrid (锯齿边界 + 间隙断续)
    │
    ▼ Phase 1: BFS 填隙
    │  将 0 值间隙格子填充为最近区域 ID，形成完整 Voronoi 分区
    │
    ▼ Phase 2: 高斯加权投票迭代平滑
    │  每次迭代中，每个格子统计邻域内各区域的高斯加权票数
    │  取票数最多的区域 ID，重复 iterations 轮
    │
    ▼ Phase 3: 重刻均匀间隙
    │  找出所有区域交界格子，向外 BFS 膨胀 gapWidth 步，
    │  标记格子置 0，形成均匀宽度的光滑边界线
    │
    ▼ 输出
    smoothGrid (平滑连续边界)  +  baseGrid (二值掩码)
```

## 功能特点

1. **填充碎裂间隙**：原始间隙（gapWidth 排斥造成的 0 值格）在平滑前先填充，避免影响投票结果
2. **高斯权重投票**：距离近的邻居权重大，距离远的权重小，产生更自然的过渡
3. **均匀间隙重刻**：平滑后按固定像素宽度重刻边界线，使间隙宽度统一一致
4. **保留区域数量**：不改变区域数量和 ID，只优化边界形态

## 适用情况

- `rts_base_shape_gen` 或 `rts_base_shape_poisson` 输出的 `regionGrid` 有锯齿边界
- 需要将像素级台阶边界平滑为自然曲线
- 需要统一区域间隙宽度（原始 gapWidth 参数产生的间隙可能不均匀）

## 基本使用方法

1. 将 `rts_base_shape_gen`（或 poisson 版本）的 `regionGrid` 输出连到本电池的 `regionGrid` 输入
2. 调整 `iterations` 和 `kernelRadius` 控制平滑程度
3. 用 `smoothGrid` 替换原来的 `regionGrid` 输出使用
4. 用 `baseGrid` 替换原来的 `baseGrid` 输出使用

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| regionGrid | grid | 必填 | 多区域 ID 网格，0=间隙，1-based 区域编号 |
| iterations | number | 3 | 高斯投票迭代次数，越多越平滑（建议 2~5） |
| kernelRadius | number | 2 | 高斯核半径（格），越大过渡越柔和（建议 1~4） |
| gapWidth | number | 1 | 重刻间隙宽度（格），0=不重刻，直接输出无缝分区 |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| smoothGrid | grid | 平滑后的区域 ID 网格（含间隙=0） |
| baseGrid | grid | 二值掩码：1=有区域，0=间隙 |

## 参数调节建议

| 效果目标 | 推荐参数 |
|----------|---------|
| 轻度平滑，保留形状 | iterations=2, kernelRadius=1 |
| 标准平滑（推荐） | iterations=3, kernelRadius=2 |
| 强力平滑，接近 Voronoi | iterations=5, kernelRadius=3 |
| 无缝平铺（不要间隙） | gapWidth=0 |
| 宽边界线 | gapWidth=2~3 |

## 注意事项

1. **输入必须是 regionGrid**：不能直接接 baseGrid（二值网格），baseGrid 只有 0/1 两值，无法区分多个区域
2. **kernelRadius 越大越慢**：计算量为 O(w × h × kernelRadius²)，对大网格设过大的 kernelRadius 会较慢
3. **与 rts_quad_symmetry 配合**：建议先平滑再做四重对称，否则对称边界处会出现新的锯齿
4. **gapWidth=0 的无缝输出**：smoothGrid 的所有格子都有区域 ID，可直接用于进一步处理
