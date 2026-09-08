/**
 * ImagePreview 电池执行函数（2D 资产生成器）
 *
 * 行为：透传上游 image（图像资产 alias 或 base64 data URL）到输出端口，
 *      不做任何实际计算 —— 真正的「预览」由编辑器内核自定义节点 ImagePreviewNode 渲染
 *      （meta.json 的 frontend.nodeType = "image_preview" 显式选中该渲染器，
 *      从而跳过本 app 的 image 默认渲染器 asset2d_image_battery）。
 *      串联到任意输出 image 的节点（ImageGen / RemoveBG / Resize 等）后，
 *      可在画布上直观看到该图像，且不打断下游连线。
 *
 * 运行约定：函数名小写字母开头，入参/出参均为 Record<string, unknown>
 */
export function imagePreview(input: Record<string, unknown>): Record<string, unknown> {
  const image = typeof input.image === 'string' && input.image.trim()
    ? input.image.trim()
    : null

  if (!image) {
    return { error: 'No upstream image connected. Connect an image-typed output to this node.' }
  }

  return { image }
}
