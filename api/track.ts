import { Hono } from 'hono'
import { cors } from 'hono/cors'

export type Env = { MISC_DB: D1Database }

export const trackApp = new Hono<{ Bindings: Env }>()
trackApp.use('/*', cors())

// Track 路由的根路径
trackApp.get('/', async (c) => {
  return c.text('Track API')
})

// 添加一个示例路由
trackApp.get('/status', async (c) => {
  return c.text('Track service is running')
})