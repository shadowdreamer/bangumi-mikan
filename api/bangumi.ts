import { Hono } from 'hono';
import { cors } from 'hono/cors';

export type Env = { BANGUMI_DB: D1Database };

export const bangumiApp = new Hono<{ Bindings: Env }>();

type Site = {
	site: string;
	id: string;
};
type Item = {
	sites: Site[];
};
interface BangumiData {
	siteMeta: unknown;
	items: Item[];
}
bangumiApp.use('/*', cors());
bangumiApp.get('/', async (c) => {
	return c.text('Bangumi Mikan kv store');
});
bangumiApp.get('/refresh', async (c) => {
	const msg = await bulkSync(c.env.BANGUMI_DB, true);
	return c.text(msg);
});

bangumiApp.get('/query', async (c) => {
	const id = c.req.query('id');
	if (!id) return c.text('Missing id', 400);
	const { results } = await c.env.BANGUMI_DB.prepare('SELECT mikan_id FROM bangumi_mikan WHERE bangumi_id = ?').bind(id).all();
	if (results.length === 0) return c.text('Not found', 404);
	return c.json({ bangumi_id: id, mikan_id: results[0].mikan_id });
});

bangumiApp.get('/__scheduled', async (c) => {
	const msg = await bulkSync(c.env.BANGUMI_DB);
	return c.text(`[scheduled] ${msg}`);
});

export async function bulkSync(db: D1Database, skipCheckHash = false): Promise<string> {
	const res = await fetch('https://unpkg.com/bangumi-data@0.3/dist/data.json');

	if (!res.ok) {
		throw new Error(`Fetch failed: ${res.status}`);
	}

	const text = await res.text();

	// SHA-256，取前 8 字节作为 Hash
	const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));

	const newHash = Array.from(new Uint8Array(hashBuffer))
		.slice(0, 8)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');

	// Hash 没有变化，直接跳过
	if (!skipCheckHash) {
		const last = await getLastHash(db);

		if (last === newHash) {
			return `Hash not changed, skip at ${new Date().toISOString()}`;
		}
	}

	const obj: BangumiData = JSON.parse(text);

	/*
	 * Bangumi ID -> Mikan ID
	 *
	 * 使用 Map 去重。
	 * 如果 Bangumi ID 重复，后面的 Mikan ID 覆盖前面的。
	 */
	const mapping = new Map<string, string>();

	for (const item of obj.items) {
		const bangumi = item.sites.find((s) => s.site === 'bangumi');
		const mikan = item.sites.find((s) => s.site === 'mikan');

		if (!bangumi?.id || !mikan?.id) {
			continue;
		}

		const bangumiId = String(bangumi.id);
		const mikanId = String(mikan.id);

		// 重复 Bangumi ID 会覆盖之前的 Mikan ID
		mapping.set(bangumiId, mikanId);
	}

	const values = Array.from(mapping.entries());

	/*
	 * 创建临时表。
	 *
	 * 正式表只有在所有数据写入成功后才会被替换。
	 */
	await db.exec('DROP TABLE IF EXISTS bangumi_mikan_new');

	await db.exec('CREATE TABLE bangumi_mikan_new (bangumi_id TEXT PRIMARY KEY, mikan_id TEXT NOT NULL)');

	/*
	 * 分批插入，避免一次生成超长 SQL。
	 */
	const BATCH_SIZE = 500;

	for (let i = 0; i < values.length; i += BATCH_SIZE) {
		const chunk = values.slice(i, i + BATCH_SIZE);

		const statements = chunk.map(([bangumiId, mikanId]) =>
			db.prepare('INSERT INTO bangumi_mikan_new (bangumi_id, mikan_id) VALUES (?, ?)').bind(bangumiId, mikanId),
		);

		await db.batch(statements);
	}

	/*
	 * 新表已经完整写入，替换正式表。
	 */
	await db.exec('DROP TABLE IF EXISTS bangumi_mikan');

	await db.exec('ALTER TABLE bangumi_mikan_new RENAME TO bangumi_mikan');

	/*
	 * 所有操作成功后才更新 Hash。
	 */
	await db.batch([
		db.prepare("DELETE FROM meta WHERE key = 'last_hash'"),
		db.prepare('INSERT INTO meta (key, hash, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)').bind('last_hash', newHash),
	]);

	return `Bulk synced ${values.length} records at ${new Date().toISOString()}` + (skipCheckHash ? ', skipCheckHash' : '');
}

async function getLastHash(db: D1Database) {
	const exists = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='meta'").first();

	if (!exists) {
		await db.exec(
			`CREATE TABLE IF NOT EXISTS meta ( \
      key TEXT PRIMARY KEY, \
      hash TEXT,\
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP \
      )`.trim(),
		);
		return null;
	}

	const row = await db.prepare("SELECT hash FROM meta WHERE key='last_hash'").first();
	return row?.hash ?? null;
}
