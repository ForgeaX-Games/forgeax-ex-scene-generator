import type { SceneCallStatement, SceneDefinitionPort, SceneExpression, SceneGroupDefinition, SceneModuleAst } from '../model/types.js'

function printExpression(expression: SceneExpression, indent: number): string {
  switch (expression.kind) {
    case 'literal':
      return JSON.stringify(expression.value)
    case 'reference':
      return expression.output ? `${expression.binding}.${expression.output}` : expression.binding
    case 'callable':
      return expression.functionName
    case 'array':
      return `[${expression.items.map((item) => printExpression(item, indent)).join(', ')}]`
    case 'object': {
      const entries = Object.entries(expression.properties)
      if (entries.length === 0) return '{}'
      const pad = ' '.repeat(indent + 2)
      const close = ' '.repeat(indent)
      return `{\n${entries
        .map(([key, value]) => `${pad}${key}: ${printExpression(value, indent + 2)},`)
        .join('\n')}\n${close}}`
    }
  }
}

function printCall(statement: SceneCallStatement, exported = false): string {
  const entries = Object.entries(statement.args)
  const args =
    entries.length === 0
      ? '{}'
      : `{\n${entries
          .map(([name, value]) => `  ${name}: ${printExpression(value, 2)},`)
          .join('\n')}\n}`
  const call = `${statement.functionName}(${args})`
  return `// @scene-id ${statement.statementId}\n${statement.binding ? `${exported ? 'export ' : ''}const ${statement.binding} = ${call}` : call}`
}

function printPortMap(ports: Record<string, SceneDefinitionPort>, indent: number): string {
  const entries = Object.entries(ports)
  if (entries.length === 0) return '{}'
  const pad = ' '.repeat(indent + 2)
  const close = ' '.repeat(indent)
  return `{\n${entries.map(([name, port]) => {
    const extras = [
      port.runtimeType ? `runtimeType: ${JSON.stringify(port.runtimeType)}` : '',
      port.runtimePort ? `runtimePort: ${JSON.stringify(port.runtimePort)}` : '',
      port.access ? `access: ${JSON.stringify(port.access)}` : '',
      port.hidden !== undefined ? `hidden: ${port.hidden}` : '',
      port.required !== undefined ? `required: ${port.required}` : '',
      port.mode ? `mode: ${JSON.stringify(port.mode)}` : '',
      port.label ? `label: ${JSON.stringify(port.label)}` : '',
      port.labelEn ? `labelEn: ${JSON.stringify(port.labelEn)}` : '',
      port.description ? `description: ${JSON.stringify(port.description)}` : '',
      port.order !== undefined ? `order: ${port.order}` : '',
      port.defaultValue !== undefined ? `defaultValue: ${JSON.stringify(port.defaultValue)}` : '',
    ].filter(Boolean)
    return `${pad}${name}: ${extras.length ? `{ type: ${port.type}, ${extras.join(', ')} }` : port.type},`
  }).join('\n')}\n${close}}`
}

function printDefinition(definition: SceneGroupDefinition, exported = false): string {
  const inputs = printPortMap(definition.meta.inputs, 4)
  const outputs = printPortMap(definition.meta.outputs, 4)
  const body = definition.body.map((statement) => printCall(statement).replace(/^/gm, '    ')).join('\n\n')
  const returned = printExpression({ kind: 'object', properties: definition.returnOutputs }, 4)
  return [
    `// @scene-id ${definition.definitionId}`,
    `${exported ? 'export ' : ''}const ${definition.exportName} = defineGroup(`,
    `  {`,
    `    id: ${JSON.stringify(definition.meta.id)},`,
    `    version: ${JSON.stringify(definition.meta.version)},`,
    `    inputs: ${inputs.replace(/\n/g, '\n    ')},`,
    `    outputs: ${outputs.replace(/\n/g, '\n    ')},`,
    ...(definition.meta.sealed !== undefined ? [`    sealed: ${definition.meta.sealed},`] : []),
    `  },`,
    `  ({ ${definition.paramNames.join(', ')} }) => {`,
    ...(body ? [body] : []),
    `    return ${returned.replace(/\n/g, '\n    ')}`,
    `  },`,
    `)`,
  ].join('\n')
}

export function printSceneModule(module: SceneModuleAst): string {
  const imports = module.imports.map((item) => {
    const names = (item.specifiers ?? item.names.map((name) => ({ imported: name, local: name })))
      .map((specifier) => specifier.imported === specifier.local
        ? specifier.local
        : `${specifier.imported} as ${specifier.local}`)
    return `import { ${names.join(', ')} } from ${JSON.stringify(item.from)}`
  })
  const directlyExported = new Set(
    module.exports.filter((item) => item.local === item.exported).map((item) => item.local),
  )
  const definitions = module.definitions.map((item) => printDefinition(item, directlyExported.has(item.exportName)))
  const calls = module.statements.map((item) => printCall(item, Boolean(item.binding && directlyExported.has(item.binding))))
  const declarationNames = new Set([
    ...module.definitions.map((item) => item.exportName),
    ...module.statements.flatMap((item) => item.binding ? [item.binding] : []),
  ])
  const explicitExports = module.exports
    .filter((item) => item.local !== item.exported || !declarationNames.has(item.local))
    .map((item) => `export { ${item.local === item.exported ? item.local : `${item.local} as ${item.exported}`} }`)
  return [
    `// @scene-module-id ${module.moduleId}`,
    ...imports,
    ...definitions,
    ...calls,
    ...explicitExports,
  ].join('\n\n') + '\n'
}
