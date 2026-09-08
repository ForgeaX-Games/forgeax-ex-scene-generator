/**
 * Image port 跨边界 DTO（alias / blobId 二层化）。
 *
 * 设计：image 端口承载的值有两种形式：
 *   1) ImageRefLibrary  — 资产库中的图像，通过 alias（用户可见名）+ blobId（内容哈希）双重定位
 *   2) data: URL       — 内联 base64（仅用于无需持久化的临时数据，例如 AI 生图前的预览）
 *
 * 字符串编码规则：
 *   - 资产库图像：JSON 序列化的 ImageRefLibrary，例如 `{"alias":"foo.png","blobId":"abc..."}`
 *   - 内联数据：原始 `data:image/png;base64,...`
 *
 * 不允许任何 fallback 形式（如裸 alias 字符串）。消费端通过 parseImageRef 显式解析两种情况。
 */
export interface ImageRefLibrary {
  alias: string;
  blobId: string; // sha256 hex
}

export type ImageRef = ImageRefLibrary | { dataUrl: string };

/** 把 ImageRef 序列化为可在 image 端口传输的字符串。 */
export function encodeImageRef(ref: ImageRef): string {
  if ('dataUrl' in ref) return ref.dataUrl;
  return JSON.stringify({ alias: ref.alias, blobId: ref.blobId });
}

/**
 * 解析 image 端口字符串到 ImageRef。
 * - 以 `data:` 开头 → dataUrl 形式
 * - 以 `{` 开头并包含 alias / blobId → library 形式
 * - 其他情况 → null（调用方判定为非法输入）
 */
export function parseImageRef(value: string | null | undefined): ImageRef | null {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('data:')) return { dataUrl: trimmed };
  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed) as { alias?: unknown; blobId?: unknown };
      if (typeof obj.alias === 'string' && typeof obj.blobId === 'string'
          && obj.alias && obj.blobId) {
        return { alias: obj.alias, blobId: obj.blobId };
      }
    } catch { /* fallthrough */ }
  }
  return null;
}
