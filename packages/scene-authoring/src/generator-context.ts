/** Pure deterministic generator context shared by the host and portable builds. */
export function defaultGeneratorContext(seed = 1): {
  seed: number
  random: (salt?: number) => number
  rng: (salt?: number) => () => number
  log: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void
  signal: AbortSignal
} {
  const mulberry = (value: number) => {
    let t = value >>> 0
    return () => {
      t += 0x6d2b79f5
      let r = Math.imul(t ^ (t >>> 15), 1 | t)
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296
    }
  }
  const stream = mulberry(seed)
  return {
    seed,
    random: (salt) => (salt === undefined ? stream() : mulberry(seed + salt)()),
    rng: (salt) =>
      mulberry(
        salt === undefined ? seed + Math.floor(stream() * 1e9) : seed + salt,
      ),
    log: () => undefined,
    signal: new AbortController().signal,
  }
}
