import { copyImage } from '../../../_shared/asset2d.js';

export async function imageOutput(input: Record<string, unknown>, ctx?: { services?: Record<string, unknown> }): Promise<Record<string, unknown>> {
  const copied = await copyImage(input, ctx, 'image_output');
  return { alias: copied.image, ok: Boolean(copied.image) && !copied.error };
}
