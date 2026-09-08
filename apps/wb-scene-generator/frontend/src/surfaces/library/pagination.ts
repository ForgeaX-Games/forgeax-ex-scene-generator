// Page list for the Asset Store pager. Emits each page EXACTLY once, with
// first/last edges and ellipsis sentinels. ≤7 pages render flat; otherwise:
//   1 … [window of up to 3 around the current page] … last
// The centred window is strictly clamped to [2, totalPages-1] so the edge
// buttons (1 and last) can never be duplicated by the window.
export function pageItems(page: number, totalPages: number): (number | '…')[] {
  if (totalPages <= 7) {
    return Array.from({ length: Math.max(1, totalPages) }, (_, i) => i + 1)
  }
  const windowStart = Math.max(2, Math.min(page - 1, totalPages - 3))
  const windowEnd = Math.min(totalPages - 1, Math.max(page + 1, 4))
  const out: (number | '…')[] = [1]
  if (windowStart > 2) out.push('…')
  for (let p = windowStart; p <= windowEnd; p++) out.push(p)
  if (windowEnd < totalPages - 1) out.push('…')
  out.push(totalPages)
  return out
}
