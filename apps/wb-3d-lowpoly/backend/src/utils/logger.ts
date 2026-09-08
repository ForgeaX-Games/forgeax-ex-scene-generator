/**
 * Minimal logger shim for the ported baker service.
 *
 * The legacy backend shipped a richer logger (levels, transports). Here the
 * baker only needs debug/info/warn/error sinks; this maps them onto console so
 * the ported baker.service.ts keeps its original `import { logger } from
 * '../../utils/logger.js'` path verbatim. `debug` is gated behind
 * FORGEAX_BAKER_DEBUG to keep the live :9567 backend logs quiet by default.
 */

const debugEnabled =
  process.env.FORGEAX_BAKER_DEBUG === '1' || process.env.FORGEAX_BAKER_DEBUG === 'true'

export const logger = {
  debug(message: string): void {
    if (debugEnabled) console.debug(message)
  },
  info(message: string): void {
    console.log(message)
  },
  warn(message: string): void {
    console.warn(message)
  },
  error(message: string): void {
    console.error(message)
  },
}
