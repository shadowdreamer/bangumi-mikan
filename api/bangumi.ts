import { Hono } from 'hono'
import { cors } from 'hono/cors'

export type Env = { BANGUMI_DB: D1Database }

export const bangumiApp = new Hono<{ Bindings: Env }>()
bangumiApp.use('/*', cors())
bangumiApp.get('/', async (c) => {
  return c.text('Bangumi Mikan kv store')
})
bangumiApp.get('/refresh', async (c) => {
  const msg = await bulkSync(c.env.BANGUMI_DB, true)
  return c.text(msg)
})

bangumiApp.get('/query', async (c) => {
  const id = c.req.query('id')
  if (!id) return c.text('Missing id', 400)
  const { results } = await c.env.BANGUMI_DB
    .prepare('SELECT mikan_id FROM bangumi_mikan WHERE bangumi_id = ?')
    .bind(id)
    .all()
  if (results.length === 0) return c.text('Not found', 404)
  return c.json({ bangumi_id: id, mikan_id: results[0].mikan_id })
})

bangumiApp.get('/__scheduled', async (c) => {
  const msg = await bulkSync(c.env.BANGUMI_DB)
  return c.text(`[scheduled] ${msg}`)
})

export async function bulkSync(db: D1Database, skipCheckHash = false): Promise<string> {
  const res = await fetch(
    'https://raw.githubusercontent.com/xiaoyvyv/bangumi-data/main/data/mikan/bangumi-mikan.json'
  );



  if (!res.ok) throw new Error('Fetch failed ' + res.status);
  const text = await res.text();

  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  // to 8length string
  const newHash = Array.from(new Uint8Array(hashBuffer))
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

	if(!skipCheckHash){
		const last = await getLastHash(db);
		// 如果 hash 相同，不做任何操作
		if(last === newHash){
			return `Hash not changed, skip at ${new Date().toISOString()}`;
		}
	}

	type Brand<K, T> = K & { __brand: T };
  type BGM_ID = Brand<string, "BGM_ID">;
	type MIKAN_ID = Brand<string, "MIKAN_ID">;
  const obj: Record<MIKAN_ID, BGM_ID> = JSON.parse(text);

  const values: string[] = [];
  for (const [mikan, bgm] of Object.entries(obj)) {
    if (bgm && mikan) {
      values.push(`('${bgm}', '${mikan}')`);
    }
  }
  const valuesSql = values.join(',');

  await db.exec(`DROP TABLE IF EXISTS bangumi_mikan`);
  await db.exec(`CREATE TABLE bangumi_mikan ( bangumi_id TEXT PRIMARY KEY, mikan_id TEXT )`);
   // 更新 meta 表
  await db.batch([
    db.prepare("DELETE FROM meta WHERE key='last_hash'"),
    db.prepare(
      "INSERT INTO meta (key, hash, updated_at) VALUES ('last_hash', ?, CURRENT_TIMESTAMP)"
    ).bind(newHash),
  ]);

  // 如果没有记录，插入空表
  if(values.length){
    await db.exec(` INSERT INTO bangumi_mikan (bangumi_id, mikan_id) VALUES ${valuesSql}`);
  }

  return `Bulk synced ${values.length} records at ${new Date().toISOString()}, ${skipCheckHash ? 'skipCheckHash' : ''}`;
}

async function getLastHash(db: D1Database) {
  const exists = await db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='meta'")
    .first();

  if (!exists) {
    await db.exec(`CREATE TABLE IF NOT EXISTS meta ( \
      key TEXT PRIMARY KEY, \
      hash TEXT,\
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP \
      )`.trim());
    return null;
  }

  const row = await db.prepare("SELECT hash FROM meta WHERE key='last_hash'").first();
  return row?.hash ?? null;
}
