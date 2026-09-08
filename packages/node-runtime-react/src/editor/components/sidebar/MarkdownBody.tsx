import type { ReactNode } from 'react'

/** Inline: `code`, **bold**, *italic* (simple, non-nested). */
function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const tok = m[0]!
    if (tok.startsWith('`')) {
      parts.push(<code key={key++}>{tok.slice(1, -1)}</code>)
    } else if (tok.startsWith('**')) {
      parts.push(<strong key={key++}>{tok.slice(2, -2)}</strong>)
    } else {
      parts.push(<em key={key++}>{tok.slice(1, -1)}</em>)
    }
    last = m.index + tok.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

function isTableSeparator(line: string): boolean {
  return /^\|?[\s:|-]+\|[\s:|-]*\|?$/.test(line.trim()) && line.includes('-')
}

function splitTableRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  return s.split('|').map((c) => c.trim())
}

/**
 * Lightweight markdown body renderer for template README sections.
 * Supports: paragraphs, fenced code, blockquotes, GFM-ish tables, inline code/bold/italic.
 */
export function MarkdownBody({ content }: { content: string }): JSX.Element {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]!

    if (line.trimStart().startsWith('```')) {
      const fence = line.trimStart()
      const lang = fence.slice(3).trim()
      i += 1
      const codeLines: string[] = []
      while (i < lines.length && !lines[i]!.trimStart().startsWith('```')) {
        codeLines.push(lines[i]!)
        i += 1
      }
      if (i < lines.length) i += 1
      blocks.push(
        <pre key={key++} className="tpl-md-code" data-lang={lang || undefined}>
          <code>{codeLines.join('\n')}</code>
        </pre>,
      )
      continue
    }

    if (line.trimStart().startsWith('>')) {
      const quoteLines: string[] = []
      while (i < lines.length && lines[i]!.trimStart().startsWith('>')) {
        quoteLines.push(lines[i]!.replace(/^\s*>\s?/, ''))
        i += 1
      }
      blocks.push(
        <blockquote key={key++} className="tpl-md-quote">
          {renderInline(quoteLines.join(' '))}
        </blockquote>,
      )
      continue
    }

    if (
      line.includes('|')
      && i + 1 < lines.length
      && isTableSeparator(lines[i + 1]!)
    ) {
      const header = splitTableRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim()) {
        rows.push(splitTableRow(lines[i]!))
        i += 1
      }
      blocks.push(
        <div key={key++} className="tpl-md-table-wrap">
          <table className="tpl-md-table">
            <thead>
              <tr>
                {header.map((h, hi) => (
                  <th key={hi}>{renderInline(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {header.map((_, ci) => (
                    <td key={ci}>{renderInline(row[ci] ?? '')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    if (!line.trim()) {
      i += 1
      continue
    }

    const para: string[] = []
    while (
      i < lines.length
      && lines[i]!.trim()
      && !lines[i]!.trimStart().startsWith('```')
      && !lines[i]!.trimStart().startsWith('>')
      && !(
        lines[i]!.includes('|')
        && i + 1 < lines.length
        && isTableSeparator(lines[i + 1]!)
      )
    ) {
      para.push(lines[i]!)
      i += 1
    }
    blocks.push(
      <p key={key++} className="tpl-md-p">
        {renderInline(para.join(' '))}
      </p>,
    )
  }

  if (blocks.length === 0) return <></>
  return <>{blocks}</>
}
