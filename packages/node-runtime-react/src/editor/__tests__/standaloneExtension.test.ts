import { describe, expect, it } from 'vitest'
import { isStandaloneExtension } from '../components/chrome/StandaloneExtensionShell.js'

// The guard must key on `?pane=`, not on being a top-level document: an app embedded
// by a plain launcher iframe has no pane host either, and used to lose its whole left
// navigation because the frame check said "someone is hosting us".
const withSearch = (search: string): boolean => {
  window.history.replaceState(null, '', `/${search}`)
  return isStandaloneExtension()
}

describe('isStandaloneExtension', () => {
  it('is standalone when no pane is named', () => {
    expect(withSearch('')).toBe(true)
    expect(withSearch('?slug=demo')).toBe(true)
  })

  it('is hosted whenever a pane is named', () => {
    expect(withSearch('?pane=center')).toBe(false)
    expect(withSearch('?pane=left')).toBe(false)
    expect(withSearch('?pane=center&slug=demo')).toBe(false)
  })
})
