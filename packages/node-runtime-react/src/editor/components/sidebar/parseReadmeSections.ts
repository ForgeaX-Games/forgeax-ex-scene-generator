/** One `#` / `##` / … heading and the markdown body that follows until the next heading. */
export interface ReadmeSection {
  /** Heading text without leading `#`. Empty when preamble exists before the first heading. */
  title: string
  /** ATX heading level (1–6). `0` for preamble with no heading. */
  level: number
  /** Raw markdown body (may contain tables, code fences, blockquotes, …). */
  content: string
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/

/**
 * Split a README into title+content sections on ATX headings (`#` … `######`).
 * Content before the first heading (if any) becomes a level-0 section with an empty title.
 */
export function parseReadmeSections(md: string): ReadmeSection[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const sections: ReadmeSection[] = []
  let current: ReadmeSection | null = null

  const flush = () => {
    if (!current) return
    sections.push({
      title: current.title,
      level: current.level,
      content: current.content.replace(/^\n+/, '').replace(/\n+$/, ''),
    })
    current = null
  }

  for (const line of lines) {
    const m = line.match(HEADING_RE)
    if (m) {
      flush()
      current = { title: m[2]!.trim(), level: m[1]!.length, content: '' }
      continue
    }
    if (!current) {
      if (!line.trim()) continue
      current = { title: '', level: 0, content: line }
      continue
    }
    current.content = current.content.length === 0 ? line : `${current.content}\n${line}`
  }
  flush()
  return sections.filter((s) => s.title || s.content.trim())
}
