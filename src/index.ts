import { app, bulkSync } from './bangumi'
import type { Env } from './bangumi'

async function handleFetch(req: Request, env: Env, ctx: ExecutionContext) {
  return app.fetch(req, env, ctx)
}

async function scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
  ctx.waitUntil((async () => {
    const msg = await bulkSync(env.BANGUMI_DB)
    console.log('[scheduled] ' + msg)
  })())
}

export default {
  fetch: handleFetch,
  scheduled,
}
