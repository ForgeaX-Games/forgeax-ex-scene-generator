import { builtinModules } from 'node:module'
import { posix } from 'node:path'

export const SDK_SPECIFIERS = new Set([
  '@forgeax/project-generator',
  '@forgeax/project-generator/sdk',
  '@forgeax/project-generator/geom',
  '@forgeax/scene-authoring',
])

const NODE_BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
])

export type ProjectSourceKind = 'scene' | 'generator' | 'helper' | 'material' | 'unknown'

export function projectSourceKind(file: string): ProjectSourceKind {
  if (file.endsWith('.scene.ts')) return 'scene'
  if (file.endsWith('.generator.ts')) return 'generator'
  if (file.endsWith('.generator-lib.ts')) return 'helper'
  if (file.endsWith('.material.ts')) return 'material'
  return 'unknown'
}

export function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../')
}

export function resolveProjectImport(fromFile: string, specifier: string): string {
  return posix.normalize(posix.join(posix.dirname(fromFile), specifier))
}

export interface ImportDiagnostic {
  code: string
  message: string
  file: string
  specifier: string
}

export function diagnoseGeneratorImport(
  file: string,
  specifier: string,
): ImportDiagnostic | undefined {
  const kind = projectSourceKind(file)
  if (SDK_SPECIFIERS.has(specifier)) return undefined
  if (NODE_BUILTINS.has(specifier) || specifier.startsWith('node:')) {
    return {
      code: 'GENERATOR_IMPORT_BUILTIN',
      message: `Generator code cannot import Node builtin '${specifier}'.`,
      file,
      specifier,
    }
  }
  if (!isRelativeSpecifier(specifier)) {
    return {
      code: 'GENERATOR_IMPORT_NPM',
      message: `Generator code cannot import npm package '${specifier}'.`,
      file,
      specifier,
    }
  }
  const target = resolveProjectImport(file, specifier)
  if (target.split('/').includes('..')) {
    return {
      code: 'GENERATOR_IMPORT_ESCAPE',
      message: `Import '${specifier}' escapes the project scene tree.`,
      file,
      specifier,
    }
  }
  const targetKind = projectSourceKind(target)
  if (kind === 'generator' && targetKind !== 'helper') {
    return {
      code: 'GENERATOR_IMPORT_DAG',
      message: `.generator.ts may only import *.generator-lib.ts or the Generator SDK; got '${specifier}'.`,
      file,
      specifier,
    }
  }
  if (kind === 'helper' && targetKind !== 'helper') {
    return {
      code: 'GENERATOR_IMPORT_DAG',
      message: `*.generator-lib.ts may only import other helpers or the Generator SDK; got '${specifier}'.`,
      file,
      specifier,
    }
  }
  return undefined
}

export function collectRelativeImports(source: string): string[] {
  const specifiers: string[] = []
  for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) specifiers.push(match[1])
  for (const match of source.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g)) specifiers.push(match[1])
  return specifiers
}

export function hasDynamicImport(source: string): boolean {
  return /\bimport\s*\(/.test(source)
}
