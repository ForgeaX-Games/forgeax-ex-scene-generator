import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { registerGroupTemplateRoutes } from '../src/routes/groupTemplates.js'

let app: FastifyInstance

beforeEach(async () => {
  app = Fastify({ logger: false })
  await registerGroupTemplateRoutes(app)
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe('group template door', () => {
  it('lists an empty catalog', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/group-templates?scope=all' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([])
  })

  it('rejects JSON instantiate and save', async () => {
    for (const url of [
      '/api/v1/group-templates/save',
      '/api/v1/group-templates/save-user',
      '/api/v1/group-templates/legacy/instantiate',
    ]) {
      const response = await app.inject({ method: 'POST', url, payload: {} })
      expect(response.statusCode).toBe(410)
      expect(response.json()).toEqual(expect.objectContaining({ status: 'rejected' }))
    }
  })
})
