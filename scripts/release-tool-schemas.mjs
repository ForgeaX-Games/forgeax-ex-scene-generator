const EMPTY_ARGS_SCHEMA = Object.freeze({ type: 'object', additionalProperties: false })

function isJsonObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function schemaFilename(index, toolId, field) {
  const safeId = String(toolId).replace(/[^a-z0-9._-]+/giu, '-').replace(/^-+|-+$/gu, '') || 'tool'
  return `./schemas/tools/${String(index).padStart(3, '0')}-${safeId}.${field}.json`
}

function assertRelocatableSchema(document, toolId, field) {
  const pending = [document]
  const seen = new Set()
  while (pending.length > 0) {
    const value = pending.pop()
    if (typeof value !== 'object' || value === null || seen.has(value)) continue
    seen.add(value)
    if (!Array.isArray(value)) {
      for (const keyword of ['$ref', '$dynamicRef', '$recursiveRef']) {
        const reference = value[keyword]
        if (typeof reference === 'string' && !reference.startsWith('#')) {
          throw new TypeError(`${toolId} ${field} contains an external JSON Schema reference that cannot be relocated: ${reference}`)
        }
      }
    }
    pending.push(...(Array.isArray(value) ? value : Object.values(value)))
  }
  return document
}

function schemaDocument(tool, field, readSchema) {
  const value = tool[field]
  if (value === undefined && field === 'args') return EMPTY_ARGS_SCHEMA
  if (value === undefined) return undefined
  if (isJsonObject(value)) return assertRelocatableSchema(value, tool.id, field)
  if (typeof value === 'string' && value.length > 0) {
    const loaded = readSchema?.(value)
    if (isJsonObject(loaded)) return assertRelocatableSchema(loaded, tool.id, field)
    throw new TypeError(`${tool.id} ${field} reference could not be read as a JSON Schema object: ${value}`)
  }
  throw new TypeError(`${tool.id} ${field} must be a JSON Schema object or path reference`)
}

/**
 * Convert development-manifest tool schemas into the package-local path form
 * consumed by @forgeax/extension-host. Source manifests may keep inline JSON
 * Schema objects (or their own path references); the released manifest never
 * exposes either source-tree representation.
 */
export function materializeToolSchemas(tools, options) {
  const indexOffset = options.indexOffset ?? 0
  return tools.map((tool, localIndex) => {
    const index = indexOffset + localIndex
    const projected = { ...tool }
    for (const field of ['args', 'returns']) {
      const document = schemaDocument(tool, field, options.readSchema)
      if (document === undefined) continue
      const reference = schemaFilename(index, tool.id, field)
      options.writeSchema(reference, document)
      projected[field] = reference
    }
    return projected
  })
}
