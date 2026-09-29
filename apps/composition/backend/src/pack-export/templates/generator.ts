import { defaultGeneratorContext } from '@forgeax/scene-authoring/generator-context'
export { defaultGeneratorContext } from '@forgeax/scene-authoring/generator-context'
type GeneratorContext = ReturnType<typeof defaultGeneratorContext>
const PACK_SEED = 1

export function defineGenerator<TInputs extends Record<string, unknown>, TOutputs>(definition: {
  id?: string
  run: (ctx: GeneratorContext, inputs: TInputs) => TOutputs | Promise<TOutputs>
}): ((args?: TInputs) => TOutputs | Promise<TOutputs>) & typeof definition {
  const fn = (args: TInputs = {} as TInputs): TOutputs | Promise<TOutputs> =>
    definition.run(defaultGeneratorContext(PACK_SEED), args)
  return Object.assign(fn, definition)
}

export const defineRecordedGenerator = defineGenerator
