# image_preview — 图像预览（2D 资产生成器）

## 功能

在画布上**直接预览** image 端口上的图像，并把同一个图像 alias / data URL **原样透传**到下游，方便：

- 在图像处理链路中插入一个观察点，确认上游图像真的生成 / 加载成功
- 挂在 `ImageGen`（AI 生图）、`RemoveBG`（抠图）、`Resize`（缩放）等节点的 `image` 输出端口后，第一时间看到结果
- 作为「探针式」可视化中转节点，连线不会被打断，删除节点也不影响数据流

## 输入

| 名称 | 类型 | 说明 |
|------|------|------|
| `image` | `image` | 上游图像：可以是资产库中的 alias / 编码 ImageRef，也可以是 `data:image/...;base64,...` data URL |

## 输出

| 名称 | 类型 | 说明 |
|------|------|------|
| `image` | `image` | 与输入完全一致的图像（透传） |

## 渲染说明

- 后端 `index.ts` 只做透传，不做任何编码 / 解码。
- 真正的预览发生在编辑器内核前端 **ImagePreviewNode**：
  - 通过 `nodeOutputs[上游节点][上游端口]` 拿到 image 字符串
  - 若以 `data:` 开头 → 直接作为 `<img>` 的 src
  - 否则视为编码 ImageRef → 解析出 blob 通过 `/api/v1/library/blob/:id` 获取图像
- 未连接上游时，节点中央展示「连接图像端口」空状态提示。
- `meta.json` 显式设置 `frontend.nodeType = "image_preview"`，从而**跳过**本 app 对
  `image/*` 电池默认套用的 `asset2d_image_battery` 渲染器，改用内核的专用预览节点。

## 使用方法

1. 从电池库 `Basic` 分类（`image/basic`）拖入画布
2. 把任何输出 `image` 类型的端口连到该节点的 `image` 输入
3. 节点中央立刻显示对应图像缩略图
4. 如需继续传递给下游，直接从节点右侧 `image` 输出端口接出即可

## 典型用法

```
ImageGen → image_preview              (生成结果即时可视化)
          ↘ RemoveBG → image_preview  (抠图后确认效果)
                       ↘ ImgOutput → [资产库]
```
