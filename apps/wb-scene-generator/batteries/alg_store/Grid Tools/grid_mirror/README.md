# 网格镜像 (grid_mirror)

将二维网格沿水平轴、垂直轴或两个轴同时镜像翻转，输出翻转后的新网格。

约定与 Photoshop / OpenCV / Unity 一致：

- **horizontal**：左右翻转（沿竖直轴镜像）
- **vertical**：上下翻转（沿水平轴镜像）
- **both**：左右 + 上下，等价于 180° 旋转

## 功能特点

1. **三种方向**：horizontal（左右）、vertical（上下）、both（180°）
2. **尺寸不变**：翻转不改变网格行列数

## 适用情况

- 对称地图生成（翻转半边拼合成完整地图）
- 瓷砖变体生成
- 数据预处理中的镜像增强

## 基本使用方法

1. 将网格连接到 `输入网格` 端口
2. 从下拉框选择 `镜像轴`（horizontal / vertical / both）
3. 从 `镜像网格` 端口获取输出

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| grid | grid | — | 待镜像翻转的二维网格 |
| axis | string | horizontal | 镜像方向：horizontal=左右翻转，vertical=上下翻转，both=180° |

支持的别名（大小写不敏感）：

- horizontal: `horizontal` `lr` `flip_x` `x`
- vertical: `vertical` `tb` `flip_y` `y`
- both: `both` `xy` `180`

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| grid | grid | 镜像翻转后的二维网格 |

## 注意事项

1. **方向语义**：horizontal 翻转每行内元素顺序（左右对调），vertical 翻转行的顺序（上下对调）
2. **历史兼容**：早期版本曾把 horizontal/vertical 语义写反，本电池现已与图像处理通用约定对齐。如有依赖旧行为的管线，请交换 axis 值
3. **空网格**：输入空网格时返回错误提示
