/** Explicit transport: typed buffers retain width, views and shared backing storage. */
export interface SceneWire {
  readonly schemaVersion: 'scene-document/1'
  readonly payload: unknown
  readonly buffers: readonly string[]
}
const constructors = {
  Float32Array,
  Float64Array,
  Uint8Array,
  Uint16Array,
  Uint32Array,
  Int8Array,
  Int16Array,
  Int32Array,
  Uint8ClampedArray,
}

export function encodeSceneDocument(value: unknown): SceneWire {
  const buffers: string[] = [],
    ids = new Map<ArrayBufferLike, number>()
  const bufferId = (buffer: ArrayBufferLike): number => {
    const existing = ids.get(buffer)
    if (existing !== undefined) return existing
    const index = buffers.length
    ids.set(buffer, index)
    let raw = ''
    const bytes = new Uint8Array(buffer)
    for (let offset = 0; offset < bytes.length; offset += 8192)
      raw += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
    buffers.push(btoa(raw))
    return index
  }
  const encode = (input: unknown): unknown => {
    if (input instanceof ArrayBuffer)
      return { $sceneBuffer: bufferId(input), type: 'ArrayBuffer' }
    if (ArrayBuffer.isView(input)) {
      if (input instanceof DataView)
        throw new Error(
          'Scene transport does not support DataView; use an explicit typed array',
        )
      return {
        $sceneBuffer: bufferId(input.buffer),
        type: input.constructor.name,
        byteOffset: input.byteOffset,
        length: (input as Uint8Array).length,
      }
    }
    if (input && typeof input === 'object') {
      if ('toJSON' in input && typeof input.toJSON === 'function')
        return encode(input.toJSON())
      if (input instanceof Map)
        return Object.fromEntries(
          [...input].map(([key, value]) => [key, encode(value)]),
        )
      if (Array.isArray(input)) return input.map(encode)
      return Object.fromEntries(
        Object.entries(input).map(([key, value]) => [key, encode(value)]),
      )
    }
    return input
  }
  return { schemaVersion: 'scene-document/1', payload: encode(value), buffers }
}

export function decodeSceneDocument<T>(wire: SceneWire): T {
  if (wire.schemaVersion !== 'scene-document/1' || !Array.isArray(wire.buffers))
    throw new Error('Unsupported scene document transport version')
  const buffers = wire.buffers.map(
    (data) =>
      Uint8Array.from(atob(data), (character) => character.charCodeAt(0))
        .buffer,
  )
  const decode = (input: unknown): unknown => {
    if (!input || typeof input !== 'object') return input
    if (Array.isArray(input)) return input.map(decode)
    const record = input as Record<string, unknown>
    if (typeof record.$sceneBuffer === 'number') {
      const id = record.$sceneBuffer
      if (!Number.isInteger(id) || id < 0 || id >= buffers.length)
        throw new Error('Scene buffer reference is out of range')
      const buffer = buffers[id]!
      if (record.type === 'ArrayBuffer') return buffer
      const Constructor = constructors[record.type as keyof typeof constructors]
      if (!Constructor)
        throw new Error(`Unsupported scene buffer type '${record.type}'`)
      return new Constructor(
        buffer,
        record.byteOffset as number,
        record.length as number,
      )
    }
    return Object.fromEntries(
      Object.entries(record).map(([key, value]) => [key, decode(value)]),
    )
  }
  return decode(wire.payload) as T
}
