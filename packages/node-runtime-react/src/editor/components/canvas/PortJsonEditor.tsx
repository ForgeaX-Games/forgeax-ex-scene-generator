import { useEffect, useRef, useState } from 'react'

import { formatJsonLiteral, parseJsonLiteral } from '../../utils/jsonLiteral.js'

const COMMIT_MS = 700

export function PortJsonEditor({
  value,
  onCommit,
  zh,
}: {
  value: unknown
  onCommit: (next: unknown) => void
  zh: boolean
}) {
  const [text, setText] = useState(() => formatJsonLiteral(value))
  const [error, setError] = useState<string | null>(null)
  const lastGood = useRef(formatJsonLiteral(value))
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    const next = formatJsonLiteral(value)
    if (next === lastGood.current) return
    lastGood.current = next
    setText(next)
    setError(null)
  }, [value])

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const apply = (raw: string, pretty: boolean) => {
    const parsed = parseJsonLiteral(raw)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    setError(null)
    const formatted = formatJsonLiteral(parsed.value)
    lastGood.current = formatted
    if (pretty) setText(formatted)
    onCommit(parsed.value)
  }

  return (
    <div className="bn-json-editor">
      <textarea
        className="bn-json-editor-text nodrag nowheel"
        spellCheck={false}
        value={text}
        onChange={(event) => {
          const raw = event.target.value
          setText(raw)
          const parsed = parseJsonLiteral(raw)
          if (!parsed.ok) {
            setError(parsed.error)
            return
          }
          setError(null)
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => apply(raw, false), COMMIT_MS)
        }}
        onBlur={() => {
          if (timer.current) clearTimeout(timer.current)
          apply(text, true)
        }}
      />
      {error ? (
        <div className="bn-json-editor-error">{zh ? `不是 JSON：${error}` : error}</div>
      ) : null}
    </div>
  )
}
