/**
 * Content-addressed mesh blob route — the slim port of the legacy
 * `GET /library/blob/:sha256` endpoint (library.routes.ts §333).
 *
 * The baker writes each tessellated mesh into the FS blob store as
 * `<contentBlobSha>.obj`; g_to_urdf emits `<mesh filename="<sha>.obj"/>` into the
 * URDF, and the viewer fetches it from `baseUrl + '/' + filename`. Because the
 * path is content-addressed it can be cached `immutable` forever.
 *
 * Faithful to legacy contract:
 *   - param accepts `<sha>` or `<sha>.<ext>`; sha MUST be 64 hex (traversal-safe)
 *   - 400 on malformed sha, 404 when the blob is absent on disk
 *   - Content-Type from the stored mime (defaults to octet-stream)
 *   - ETag = "<sha>", Cache-Control: public, max-age=31536000, immutable
 */

import { createReadStream } from 'node:fs'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { getLibraryService } from '../services/library.service.js'

export async function registerLibraryRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { sha256: string } }>(
    '/api/v1/library/blob/:sha256',
    async (req: FastifyRequest<{ Params: { sha256: string } }>, reply: FastifyReply) => {
      const raw = req.params.sha256
      // Accept <sha> or <sha>.<ext>; sha must be 64 hex (defends path traversal).
      const match = /^([0-9a-f]{64})(?:\.[a-z0-9]{1,8})?$/i.exec(raw)
      if (!match) {
        return reply.code(400).send({ error: 'invalid sha256' })
      }
      const sha256 = match[1].toLowerCase()
      const svc = getLibraryService()
      const filePath = svc.resolveBlobPathBySha(sha256)
      if (!filePath) {
        return reply.code(404).send({ error: 'Blob not found' })
      }
      const mime = svc.getMimeBySha(sha256) ?? 'application/octet-stream'
      return reply
        .header('Content-Type', mime)
        .header('ETag', `"${sha256}"`)
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        .send(createReadStream(filePath))
    },
  )
}
