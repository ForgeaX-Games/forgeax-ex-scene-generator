/**
 * passThrough: dynamic identity battery.
 *
 * Each input_i is returned unchanged as output_i. The dispatcher passes dynamic
 * input/output ports as DataTree values because their access is "tree", so this
 * preserves the upstream wire shape instead of flattening values.
 */
export function passThrough(input: Record<string, unknown>): Record<string, unknown> {
  const portCount = typeof input.portCount === "number" ? input.portCount : 2;
  const output: Record<string, unknown> = {};

  for (let i = 0; i < portCount; i++) {
    const value = input[`input_${i}`];
    if (value !== undefined) {
      output[`output_${i}`] = value;
    }
  }

  return output;
}
