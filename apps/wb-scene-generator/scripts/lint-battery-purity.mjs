#!/usr/bin/env node
// Battery purity lint: batteries must be pure functions of their declared
// inputs — no module-level mutable state that could leak results between
// unrelated invocations (see scene-v3-refactor-spec canvas, Phase 5 §3, and
// the cosmos_zone_marker bug it was written to prevent: a module-level memo
// table made its output depend on which seed happened to run first in the
// process, not on its own input).
//
// Rule (AST-based, via the TypeScript compiler API — regex is too easy to
// dodge with reformatting):
//   1. No top-level `let`/`var` in batteries/**/index.ts — every top-level
//      binding must be `const`.
//   2. A top-level `const` bound to a mutable container (array/object/Map/
//      Set/WeakMap/WeakSet literal or constructor call) must never be
//      mutated (push/set/add/delete/clear/splice/property-assignment/etc.)
//      anywhere in the file. A battery's exported entry point is called
//      repeatedly across the process lifetime, so any mutation of a
//      top-level const container is by definition cross-invocation shared
//      state — there is no "safe" mutation site to special-case.
//
// Usage: node scripts/lint-battery-purity.mjs [--dir batteries]
import ts from 'typescript'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_ROOT = fileURLToPath(new URL('..', import.meta.url))
const argDir = process.argv.includes('--dir') ? process.argv[process.argv.indexOf('--dir') + 1] : 'batteries'
const SCAN_ROOT = join(APP_ROOT, argDir)

/** Recursively collect `index.ts` battery entry files under `dir`. */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (name === 'index.ts') out.push(full)
  }
  return out
}

const MUTATING_METHODS = new Set([
  'push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin',
  'set', 'delete', 'clear', 'add',
])

/** True if `initializer` looks like a fresh mutable container. */
function isMutableContainerInit(initializer) {
  if (!initializer) return false
  if (ts.isArrayLiteralExpression(initializer)) return true
  if (ts.isObjectLiteralExpression(initializer)) return true
  if (ts.isNewExpression(initializer)) {
    const name = initializer.expression.getText()
    return ['Map', 'Set', 'WeakMap', 'WeakSet', 'Array'].includes(name)
  }
  return false
}

function lintFile(filePath) {
  const text = readFileSync(filePath, 'utf-8')
  const source = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const violations = []

  // Track top-level const identifiers bound to mutable containers, and their
  // declaring VariableDeclaration node (so its own initializer isn't treated
  // as a "mutation elsewhere").
  const mutableTopLevelNames = new Map() // name -> declaration node

  for (const stmt of source.statements) {
    if (!ts.isVariableStatement(stmt)) continue
    const isLetOrVar = !(stmt.declarationList.flags & ts.NodeFlags.Const)
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue
      if (isLetOrVar) {
        const { line } = source.getLineAndCharacterOfPosition(decl.getStart())
        const kind = stmt.declarationList.flags & ts.NodeFlags.Let ? 'let' : 'var'
        violations.push(
          `top-level \`${kind}\` \`${decl.name.text}\` at line ${line + 1} — ` +
          `batteries must not hold reassignable module state`,
        )
        continue
      }
      if (isMutableContainerInit(decl.initializer)) {
        mutableTopLevelNames.set(decl.name.text, decl)
      }
    }
  }

  if (mutableTopLevelNames.size > 0) {
    const visit = (node) => {
      if ([...mutableTopLevelNames.values()].includes(node)) return

      // a.b(...) where a is a tracked identifier and b is a mutating method.
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        mutableTopLevelNames.has(node.expression.expression.text) &&
        MUTATING_METHODS.has(node.expression.name.text)
      ) {
        const target = node.expression.expression.text
        const { line } = source.getLineAndCharacterOfPosition(node.getStart())
        violations.push(
          `mutation \`${target}.${node.expression.name.text}(...)\` at line ${line + 1} — ` +
          `top-level \`const ${target}\` is a mutable container shared across every invocation`,
        )
      }

      // a[x] = ... or a.x = ... where a is a tracked identifier.
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        (ts.isElementAccessExpression(node.left) || ts.isPropertyAccessExpression(node.left))
      ) {
        const base = node.left.expression
        if (ts.isIdentifier(base) && mutableTopLevelNames.has(base.text)) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart())
          violations.push(
            `assignment into \`${base.text}\` at line ${line + 1} — ` +
            `top-level \`const ${base.text}\` is a mutable container shared across every invocation`,
          )
        }
      }

      ts.forEachChild(node, visit)
    }
    visit(source)
  }

  return violations
}

const files = walk(SCAN_ROOT)
let failed = false
for (const file of files) {
  const violations = lintFile(file)
  if (violations.length > 0) {
    failed = true
    console.error(`\n[lint-battery-purity] ${relative(APP_ROOT, file)}`)
    for (const v of violations) console.error(`  - ${v}`)
  }
}

if (failed) {
  console.error(`\n[lint-battery-purity] FAILED — fix module-level mutable state above before committing.`)
  process.exit(1)
}
console.log(`[lint-battery-purity] OK — scanned ${files.length} battery entry files under ${argDir}/, no top-level mutable state.`)
