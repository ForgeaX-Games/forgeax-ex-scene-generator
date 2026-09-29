import type { FastifyInstance } from 'fastify'
import { getRuntime } from '../runtime.js'

export async function registerAssetRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/assets', async (req) => {
    const query = req.query as { type?: string; suffix?: string }
    const rt = await getRuntime()
    const items = rt.assets.list({
      ...(query.type ? { type: query.type } : {}),
      ...(query.suffix ? { suffix: query.suffix } : {}),
    })
    return {
      items: items.map(({ absPath: _absPath, ...safe }) => safe),
    }
  })
}
