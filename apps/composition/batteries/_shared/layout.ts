/** Domain-neutral layout arithmetic. Metres; no building presets or renderer state. */
export interface SpanSpec { key: string; min: number; max?: number; weight?: number }
export function allocateSpanValues(length: number, spans: readonly SpanSpec[], gap = 0) {
  if (!Number.isFinite(length) || length < 0 || !Number.isFinite(gap) || gap < 0) throw new Error('Span length and gap must be finite and nonnegative')
  if (new Set(spans.map(s => s.key)).size !== spans.length) throw new Error('Span keys must be unique')
  for (const s of spans) if (!Number.isFinite(s.min) || s.min < 0 || (s.max !== undefined && (!Number.isFinite(s.max) || s.max < s.min)) || (s.weight !== undefined && (!Number.isFinite(s.weight) || s.weight < 0))) throw new Error(`Invalid span constraints: ${s.key}`)
  const widths = spans.map(s => s.min)
  const available = length - gap * Math.max(0, spans.length - 1)
  let remaining = available - widths.reduce((a,b) => a+b,0)
  if (remaining < -1e-8) throw new Error(`Span minimums exceed available length by ${-remaining}m`)
  let active = spans.map((s,i) => i).filter(i => (spans[i]!.weight ?? 1) > 0 && (spans[i]!.max ?? Infinity) > widths[i]!)
  while (remaining > 1e-8 && active.length) {
    const weight = active.reduce((n,i) => n+(spans[i]!.weight ?? 1),0)
    const budget = remaining
    for (const i of active) {
      const add = Math.min(budget * (spans[i]!.weight ?? 1)/weight, (spans[i]!.max ?? Infinity)-widths[i]!)
      widths[i]! += add; remaining -= add
    }
    active = active.filter(i => (spans[i]!.max ?? Infinity)-widths[i]! > 1e-8)
  }
  let offset = 0
  const placements = spans.map((s,i) => { const start=offset, width=widths[i]!; offset += width+gap; return {key:s.key,start,end:start+width,width} })
  return { placements, remainder: Math.max(0,remaining) }
}
export function segmentRunValues(length: number, maximum: number, minimum = 0, gap = 0) {
  if (![length,maximum,minimum,gap].every(Number.isFinite) || length < 0 || maximum <= 0 || minimum < 0 || minimum > maximum || gap < 0) throw new Error('Invalid run constraints')
  if (length === 0) return []
  const count = Math.max(1,Math.ceil((length+gap)/(maximum+gap)))
  const width = (length-gap*(count-1))/count
  if (width < minimum || width <= 0) throw new Error('Run cannot satisfy segment minimum and maximum')
  return Array.from({length:count},(_,i) => ({key:`segment-${i}`,start:i*(width+gap),end:i*(width+gap)+width,width}))
}
export function deriveSeedValue(seed: number, path: string) {
  let h = seed >>> 0
  for (let i=0;i<path.length;i++) h = Math.imul(h ^ path.charCodeAt(i),16777619)
  h ^= h >>> 16; h = Math.imul(h,0x7feb352d); h ^= h >>> 15; h = Math.imul(h,0x846ca68b)
  return (h ^ (h >>> 16)) >>> 0
}
