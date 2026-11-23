import Fastify from 'fastify'
import proxy from '@fastify/http-proxy'
import staticFiles from '@fastify/static'
import { fileURLToPath } from 'node:url'

const app = Fastify()
await app.register(proxy, {
  upstream: process.env.API_PROXY ?? 'http://payments-api:3010',
  prefix: '/api',
  rewritePrefix: '/api',
})
await app.register(staticFiles, { root: fileURLToPath(new URL('./dist/', import.meta.url)) })
await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 5173) })
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void app.close() })
