# TSP 近似回路 (tsp_approximation)

旅行商问题近似算法（最近邻 + 2-opt），对一组点求"近似最短"的访问顺序。可作回路或开放路径。

## 功能特点

1. **最近邻初始化**：从随机起点贪心构造初始顺序，速度快。
2. **2-opt 优化**：通过反复翻转两条交叉边来缩短总长度，质量明显高于纯贪心。
3. **闭合 / 开放**：`closed=true` 形成回路，`false` 输出开放路径。
4. **多种输出**：访问顺序索引、按序点列、路径光栅图、总长度。

## 适用情况

- NPC 巡逻路线 / 玩家任务串联
- 装饰性回路（围墙/护城河/装饰图案）
- POI 串联最短路径
- 角色采集顺序优化

## 基本使用方法

1. 输入 `points`，例如 `"10,10; 50,30; 30,50; 70,40; 20,60"`。
2. 默认 closed=true、algorithm=nearest_2opt 已是大多数场景最佳。
3. 想要可重复结果固定 `seed`；想要更快但质量低，把 algorithm 改 `nearest_neighbor`。

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| points | number rank 2 | [] | 点列表 `[[x,y],...]`（也兼容旧字符串 "x,y; x,y"） |
| closed | boolean | true | 是否闭合 |
| algorithm | string | nearest_2opt | nearest_neighbor / nearest_2opt |
| metric | string | euclidean | euclidean / manhattan |
| maxIterations | number | 1000 | 2-opt 迭代上限 |
| width | number | 64 | pathGrid 宽度 |
| height | number | 64 | pathGrid 高度 |
| seed | number | 0 | 随机种子（决定起点） |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| order | array | 按访问顺序的原索引列表 |
| pathPoints | array | 重排后的点坐标（闭合时末尾追加起点） |
| pathGrid | grid | 0/1 光栅化路径 |
| totalLength | number | 路径/回路总长度 |

## 注意事项

1. **TSP 是 NP-Hard**：本电池是近似解。点数 ≤ 100 时质量很好，更大数据建议先聚类再分块求 TSP。
2. **2-opt 可能收敛慢**：极端形状下需调大 `maxIterations`；默认 1000 对 ≤30 个点足够。
3. **欧氏 vs 曼哈顿**：游戏中网格世界用 manhattan 更贴近真实步数；视觉装饰建议 euclidean。
