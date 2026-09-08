# alg_region_offset · 区域偏移

对输入区域做**有符号形态学偏移**：`offset>0` 外扩，`offset<0` 内缩，`0` 仅归一化。按格邻接逐圈推进，**支持不规则区域**（不要求矩形）。纯 grid 算子，**无随机性**。

## 接口

| 端口 | 类型 | 说明 |
| --- | --- | --- |
| in `region` | grid (item) | 前景=非零格 |
| in `offset` | number | 正=外扩，负=内缩 |
| in `connectivity` | number | 4=菱形，8=方块 |
| out `region` | grid (item) | 偏移后的 0/1 区域 |
| out `ring` | grid (item) | 原区域 ⊕ 结果（边带） |

## 算法

- **外扩**：与 `alg_region_dilate` 相同的前景 BFS。
- **内缩**：扩一圈背景边后算到背景的距离场，保留 `dist > |offset|` 的前景。
- **ring**：原区域与结果的对称差——外扩时为增益环，内缩时为退去环。

## 复用场景

禁区/缓冲带、地块内缩留边、不规则湖岸/岛屿轮廓的平行偏移。Scene 模板见 `batteries/templates/general/grid/RegionOffset`。
