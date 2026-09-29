// 💡 SELECT-tool cycle stepping (pure).
//
// The SELECT tool resolves a clicked screen cell to an ORDERED list of candidate
// layers (top-most first). Clicking a NEW cell selects the top-most (index 0);
// re-clicking the SAME cell steps one layer deeper, wrapping back to the top at
// the bottom. Moving to a different cell resets the cycle. Extracted as a pure
// reducer over (previous anchor cell, previous index) so it is deterministic and
// unit-testable, with no dependency on React refs or the DOM.

export interface SelectCycleState {
  /** The screen cell the cycle is currently anchored to (`col,row`), or null. */
  cell: string | null
  /** How deep into that cell's candidate list the last click landed. */
  index: number
}

export interface SelectCycleStep {
  next: SelectCycleState
  /** The candidate index to select now (0 = top-most). */
  index: number
}

/**
 * Advance the cycle for a click on `cell` whose candidate list has `count`
 * entries (count > 0). Same cell as last time → step deeper (wrap at the end);
 * a different cell (or first ever) → reset to the top-most candidate.
 */
export function stepSelectCycle(prev: SelectCycleState, cell: string, count: number): SelectCycleStep {
  if (count <= 0) return { next: { cell: null, index: 0 }, index: 0 }
  if (prev.cell === cell) {
    const index = (prev.index + 1) % count
    return { next: { cell, index }, index }
  }
  return { next: { cell, index: 0 }, index: 0 }
}
