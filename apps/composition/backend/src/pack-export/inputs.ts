import { validateScenePackParameter } from '@forgeax/scene-authoring'
import { assertPortableInputs } from '@forgeax/scene'
export type PackSchemaVersion = '1.0.0' | '2.0.0'
export function resolvePackSchemaVersion(value: unknown): PackSchemaVersion {
  if (value === undefined) return '2.0.0'
  if (value === '1.0.0' || value === '2.0.0') return value
  throw new Error("schemaVersion must be '1.0.0' or '2.0.0'")
}
export type ParameterBindings = Readonly<
  Record<string, { argument: number; path: readonly string[] }>
>
/** Validate source argument addresses before running or writing any output. */
export function validatePackInputs(
  args: readonly unknown[] = [],
  parameters: readonly Record<string, unknown>[] = [],
  bindings: ParameterBindings = {},
): void {
  assertPortableInputs(args)
  const names = new Set<string>()
  for (const parameter of parameters) {
    validateScenePackParameter(parameter)
    if (
      typeof parameter.name !== 'string' ||
      !parameter.name ||
      names.has(parameter.name)
    )
      throw new Error('Pack parameter names must be nonempty and unique')
    names.add(parameter.name)
    if (!Object.hasOwn(bindings, parameter.name))
      throw new Error(
        `Pack parameter '${parameter.name}' has no argument binding`,
      )
    assertPortableInputs([parameter])
  }
  for (const [name, binding] of Object.entries(bindings)) {
    if (!names.has(name))
      throw new Error(`Pack binding '${name}' has no parameter definition`)
    if (
      !binding ||
      !Number.isInteger(binding.argument) ||
      binding.argument < 0 ||
      binding.argument >= args.length ||
      !Array.isArray(binding.path)
    )
      throw new Error(`Pack binding '${name}' has an invalid argument address`)
    let owner: unknown = args
    for (const key of [String(binding.argument), ...binding.path]) {
      if (
        typeof key !== 'string' ||
        ['__proto__', 'constructor', 'prototype'].includes(key) ||
        !owner ||
        typeof owner !== 'object' ||
        !Object.hasOwn(owner, key)
      )
        throw new Error(
          `Pack binding '${name}' cannot resolve argument path '${key}'`,
        )
      owner = (owner as Record<string, unknown>)[key]
    }
    const parameter = parameters.find((item) => item.name === name)!
    if (JSON.stringify(owner) !== JSON.stringify(parameter.default))
      throw new Error(
        `Pack parameter '${name}' default must match its initial argument value`,
      )
  }
}
