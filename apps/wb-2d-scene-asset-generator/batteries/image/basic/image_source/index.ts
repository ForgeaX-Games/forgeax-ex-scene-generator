/**
 * ImageSource 电池执行函数（2D 资产生成器）
 *
 * 行为：把存放在节点参数里的图像引用（编码后的 {alias,blobId} JSON 或 data URL）
 *      原样输出到 image 端口，作为下游图像管线的「源」。本节点只有输出端口，
 *      不接收任何上游输入。真正的图像预览由编辑器内核自定义节点 ImageSourceNode 渲染
 *      （meta.json 的 frontend.nodeType = "image_source"）。
 *
 *      一般由前端「All Images」面板拖拽图片到画布时自动创建，并把被拖图片的
 *      编码引用写入 params.image。
 *
 * 运行约定：函数名小写字母开头，入参/出参均为 Record<string, unknown>
 */
export function imageSource(input: Record<string, unknown>): Record<string, unknown> {
  const image = typeof input.image === 'string' && input.image.trim() ? input.image.trim() : null

  if (!image) {
    return { error: 'No image set. Drag an image from the All Images panel onto the canvas, or set the image reference param.' }
  }

  return { image }
}
