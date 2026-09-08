# alg_region_dilate · 区域膨胀

对输入区域做 N 步形态学膨胀（BFS 外扩）：前景（非零格）向外扩张 `steps` 圈，输出膨胀后的 0/1 区域。纯 grid 形态学算子，**无随机性**。

## 接口

| 端口 | 类型 | 说明 |
| --- | --- | --- |
| in `region` | grid (item) | 前景=非零格 |
| in `steps` | number | 膨胀步数 / 半径 |
| in `connectivity` | number | 4=菱形外扩，8=方块外扩 |
| out `region` | grid (item) | 膨胀后的 0/1 区域 |

## 算法

`lake_gen` 里 `buildForbiddenZone`（对湖泊格 BFS 外扩 `spacing` 圈成间距禁区）的通用化。从所有前景格作为初始 frontier，逐圈把未访问的邻接格纳入，做 `steps` 轮。`connectivity=4` 用上下左右邻接（曼哈顿，菱形），`8` 加对角（切比雪夫，方块）。

## 复用场景

独立后可被任何「外扩 / 禁区 / 缓冲带 / 外轮廓加粗 / 区域加厚」场景复用。在 lake 拼接里，它接在 blob 并集之后，膨胀出湖岸缓冲带，再喂给下游电池当**禁区 / 障碍**（例如让道路、建筑避开湖区）。
