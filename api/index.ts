import { Hono } from 'hono'
import { bangumiApp, bulkSync } from './bangumi'
import { trackApp } from './track'
import type { Env } from './bangumi'

// 创建主应用并显式设置路由
const app = new Hono<{ Bindings: Env }>()
app.get('/', async (c) => {
  return c.text('CF API')
})
app.route('/bgm', bangumiApp)
app.route('/track', trackApp)

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
