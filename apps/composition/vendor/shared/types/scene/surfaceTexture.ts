/** Portable, wire-stable RGBA8 pixels. Images stay authored data, never URLs or renderer objects. */
export interface SurfaceTexture {
  readonly width: number
  readonly height: number
  /** Tight RGBA8, standard base64; row zero is v=0. */
  readonly rgba8: string
  readonly colorSpace: 'srgb' | 'linear'
  /** Repeats per authored UV unit. Missing UVs use one metre per unit. */
  readonly scale?: readonly [number, number]
}
export const SURFACE_TEXTURE_CHANNELS = ['baseColorTexture', 'normalTexture', 'metallicRoughnessTexture'] as const
export type SurfaceTextureChannel = typeof SURFACE_TEXTURE_CHANNELS[number]
export type SurfaceTextureMaps = Partial<Readonly<Record<SurfaceTextureChannel, SurfaceTexture>>>
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function decodeSurfaceTexture(source: SurfaceTexture): Uint8Array {
  const { width, height, rgba8, colorSpace, scale } = source
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1)
    throw new Error('Surface texture width and height must be positive integers')
  if (colorSpace !== 'srgb' && colorSpace !== 'linear') throw new Error('Surface texture requires an explicit colorSpace')
  if (scale && (scale.length !== 2 || scale.some(n => !Number.isFinite(n) || n <= 0))) throw new Error('Surface texture scale must contain two positive numbers')
  const length = width * height * 4
  if (rgba8.length !== Math.ceil(length / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(rgba8))
    throw new Error('Surface texture RGBA8 base64 length does not match its dimensions')
  const bytes = new Uint8Array(length)
  let at = 0
  for (let i = 0; i < rgba8.length; i += 4) {
    const n = (alphabet.indexOf(rgba8[i]!) << 18) | (alphabet.indexOf(rgba8[i+1]!) << 12)
      | (Math.max(0, alphabet.indexOf(rgba8[i+2]!)) << 6) | Math.max(0, alphabet.indexOf(rgba8[i+3]!))
    bytes[at++] = n >>> 16
    if (at < length) bytes[at++] = (n >>> 8) & 255
    if (at < length) bytes[at++] = n & 255
  }
  return bytes
}
/** Full content identity avoids hash collisions; UV transforms do not duplicate image assets. */
export function surfaceTextureKey(t: SurfaceTexture): string {
  return `${t.width}|${t.height}|${t.colorSpace}|${t.rgba8}`
}
export function surfaceTextureMapsKey(maps: SurfaceTextureMaps): string {
  return SURFACE_TEXTURE_CHANNELS.map(k => maps[k] ? `${k}:${surfaceTextureKey(maps[k]!)}:${maps[k]!.scale?.join(',') ?? '1,1'}` : '').filter(Boolean).join('|')
}
const validated = new WeakSet<SurfaceTexture>()
export function validateSurfaceTextureMaps(maps: SurfaceTextureMaps): void {
  for (const channel of SURFACE_TEXTURE_CHANNELS) {
    const source = maps[channel]
    if (!source) continue
    if (!validated.has(source)) { decodeSurfaceTexture(source); validated.add(source) }
    if (channel !== 'baseColorTexture' && source.colorSpace !== 'linear') throw new Error(`${channel} must use linear data`)
  }
}

/** Shared preview/export UV fallback, in scene coordinates (+Z up). */
export function projectSurfaceUvs(positions: ArrayLike<number>, normals: ArrayLike<number>): Float32Array {
  const uvs = new Float32Array((positions.length / 3) * 2)
  for (let p = 0, t = 0; p < positions.length; p += 3, t += 2) {
    const ax = Math.abs(normals[p] ?? 0), ay = Math.abs(normals[p+1] ?? 0), az = Math.abs(normals[p+2] ?? 1)
    uvs[t] = ax > az && ax >= ay ? positions[p+1]! : positions[p]!
    uvs[t+1] = az >= ax && az >= ay ? positions[p+1]! : positions[p+2]!
  }
  return uvs
}
