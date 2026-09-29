/** JSON-bindable subset of Pack 2.0.0 parameters; asset-guid requires an import adapter. */
export type ScenePackParameter = {
  readonly name: string
  readonly type:
    | 'bool'
    | 'u32'
    | 'i32'
    | 'f32'
    | 'f64'
    | 'string'
    | 'enum'
    | 'vec2'
    | 'vec3'
    | 'vec4'
    | 'color'
  readonly default: boolean | number | string | readonly number[]
  readonly minimum?: number
  readonly maximum?: number
  readonly values?: readonly string[]
}
export function validateScenePackParameter(
  parameter: Record<string, unknown>,
): void {
  const fail = (reason: string): never => {
    throw new Error(`Pack parameter '${String(parameter.name)}': ${reason}`)
  }
  if (
    typeof parameter.name !== 'string' ||
    !/^[A-Za-z][A-Za-z0-9_.-]*$/.test(parameter.name)
  )
    fail('invalid native parameter name')
  for (const field of Object.keys(parameter))
    if (
      !['name', 'type', 'default', 'minimum', 'maximum', 'values'].includes(
        field,
      )
    )
      fail(`unsupported descriptor field '${field}'`)
  const { type, default: value, minimum, maximum, values } = parameter
  const numeric = ['u32', 'i32', 'f32', 'f64'].includes(String(type))
  for (const bound of [minimum, maximum])
    if (
      bound !== undefined &&
      (!numeric || typeof bound !== 'number' || !Number.isFinite(bound))
    )
      fail('bounds require a finite numeric parameter')
  if (
    typeof minimum === 'number' &&
    typeof maximum === 'number' &&
    minimum > maximum
  )
    fail('minimum exceeds maximum')
  if (type !== 'enum' && values !== undefined)
    fail('values is only supported on enum parameters')
  if (numeric) {
    if (typeof value !== 'number' || !Number.isFinite(value))
      fail('default must be finite numeric data')
    const number = value as number
    if ((type === 'u32' || type === 'i32') && !Number.isInteger(number))
      fail('default must be an integer')
    if (type === 'u32' && (number < 0 || number > 0xffffffff))
      fail('u32 default out of range')
    if (type === 'i32' && (number < -0x80000000 || number > 0x7fffffff))
      fail('i32 default out of range')
    if (type === 'f32' && !Number.isFinite(Math.fround(number)))
      fail('default exceeds f32 range')
    if (
      (typeof minimum === 'number' && number < minimum) ||
      (typeof maximum === 'number' && number > maximum)
    )
      fail('default is outside declared bounds')
    return
  }
  if (type === 'bool') {
    if (typeof value !== 'boolean') fail('default must be boolean')
    return
  }
  if (type === 'string') {
    if (typeof value !== 'string') fail('default must be a string')
    return
  }
  if (type === 'enum') {
    if (
      !Array.isArray(values) ||
      !values.length ||
      values.some((v) => typeof v !== 'string') ||
      new Set(values).size !== values.length
    )
      fail('enum values must be unique strings')
    if (typeof value !== 'string' || !(values as string[]).includes(value))
      fail('default must be a declared enum value')
    return
  }
  const size =
    type === 'vec2'
      ? 2
      : type === 'vec3'
        ? 3
        : type === 'vec4' || type === 'color'
          ? 4
          : 0
  if (!size)
    fail(
      `unsupported JSON-bound type '${String(type)}'; native asset references require an explicit adapter`,
    )
  if (
    !Array.isArray(value) ||
    value.length !== size ||
    value.some((v) => typeof v !== 'number' || !Number.isFinite(v))
  )
    fail(`default must contain ${size} finite components`)
}
