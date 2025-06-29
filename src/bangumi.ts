import { Hono } from 'hono'
import { cors } from 'hono/cors'

export type Env = { BANGUMI_DB: D1Database }

export const app = new Hono<{ Bindings: Env }>()
app.use('*', cors())

app.get('/', async (c) => {
  return c.text('Bangumi Mikan kv store')
})
app.get('/refresh', async (c) => {
  const msg = await bulkSync(c.env.BANGUMI_DB)
  return c.text(msg)
})

app.get('/query', async (c) => {
  const id = c.req.query('id')
  if (!id) return c.text('Missing id', 400)
  const { results } = await c.env.BANGUMI_DB
    .prepare('SELECT mikan_id FROM bangumi_mikan WHERE bangumi_id = ?')
    .bind(id)
    .all()
  if (results.length === 0) return c.text('Not found', 404)
  return c.json({ bangumi_id: id, mikan_id: results[0].mikan_id })
})

app.get('/__scheduled', async (c) => {
  const msg = await bulkSync(c.env.BANGUMI_DB)
  return c.text(`[scheduled] ${msg}`)
})

export async function bulkSync(db: D1Database): Promise<string> {
  const res = await fetch(
    'https://raw.githubusercontent.com/xiaoyvyv/bangumi-data/main/data/mikan/bangumi-mikan.json'
  );
  if (!res.ok) throw new Error('Fetch failed ' + res.status);
  const obj: Record<string, string> = await res.json();

  const entries = Object.entries(obj).filter(([b, m]) => b && m);
  const valuesSql = entries
    .map(([mikan, bgm]) => `(${bgm}, ${mikan})`)
    .join(',');
  await db.exec(`DROP TABLE IF EXISTS bangumi_mikan`);
  await db.exec(`
    CREATE TABLE bangumi_mikan ( bangumi_id TEXT PRIMARY KEY, mikan_id TEXT )
  `.trim());
  
  // 如果没有记录，插入空表
  if(entries.length){
    await db.exec(` INSERT INTO bangumi_mikan (bangumi_id, mikan_id) VALUES ${valuesSql}`);
  }
 
  return `Bulk synced ${entries.length} records at ${new Date().toISOString()}`;
}