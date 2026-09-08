# image_source — 图像源（2D 资产生成器）

## 功能

把资产库中**一张已生成的图像**作为「图像源」输出到画布，作为图像处理链路的起点。
本节点**只有输出端口、没有输入**：图像引用存放在节点参数 `image` 里。

最常见的创建方式是**从「All Images」面板把一张图片拖拽到下方画布**——
落点处会自动创建一个 image_source 节点，并把被拖图片的编码引用写入参数，
节点中央立刻显示该图像缩略图（样式与 ImagePreview 一致）。

也可以从电池库 `Basic` 分类（`image/basic`）手动拖入，再在节点参数里填写图像引用。

## 输入

无（output-only 节点）。

## 输出

| 名称 | 类型 | 说明 |
|------|------|------|
| `image` | `image` | 选中的图像引用（资产库 alias / 编码 ImageRef / data URL），可连接到任何接收 image 的节点 |

## 参数

| 名称 | 类型 | 说明 |
|------|------|------|
| `image` | `string` | 编码后的图像引用（`{alias,blobId}` JSON 或 `data:` URL）。拖拽创建时自动填入。 |
| `alias` | `string` | 图像在资产库中的 alias，仅用于显示标识。 |

## 渲染说明

- 后端 `index.ts` 只是把参数 `image` 透传到 `image` 输出端口，不做编码 / 解码。
- 真正的预览发生在编辑器内核前端 **ImageSourceNode**：
  - 从节点参数 `image` 拿到引用字符串
  - 若以 `data:` 开头 → 直接作为 `<img>` 的 src
  - 否则视为编码 ImageRef → 解析出 blob，通过 `/api/v1/library/blob/:id` 获取图像
- 未设置图像时，节点中央展示「拖入图片」空状态提示。
- `meta.json` 显式设置 `frontend.nodeType = "image_source"`，从而**跳过**本 app 对
  `image/*` 电池默认套用的 `asset2d_image_battery` 渲染器，改用内核的专用源节点。

## 典型用法

```
[All Images 拖拽] → image_source → RemoveBG → Resize → ImgOutput → [资产库]
```
