// OFFEN 022: POST /api/products/bulk-delete gegen eine LOKALE Datei-DB und die echte App (Muster A-030, eigener Prozess).
// Google Drive wird per fetch-Attrappe gespielt. Geprüft: Vorschau schreibt nichts · gelistete sind gesperrt ·
// ohne Sicherung wird nichts gelöscht · mit Sicherung werden nur die freien gelöscht, Sicherung enthält sie.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const IS_CHILD = process.env.A030_CHILD === '1';
const dbFile = join(tmpdir(), 'offen022-route-test.db').replace(/\\/g, '/');
if (IS_CHILD) {
  try { rmSync(dbFile, { force: true }); } catch { /* neu anlegen */ }
  process.env.TURSO_DATABASE_URL = 'file:' + dbFile;
  process.env.TURSO_AUTH_TOKEN = '';
  process.env.SESSION_SECRET = 'test-secret-offen022';
  process.env.AUTH_USER1_NAME = 'o22-tester';
  process.env.AUTH_USER1_PASS = 'o22-pass';
}

describe.skipIf(!IS_CHILD)('OFFEN 022 – POST /api/products/bulk-delete (eigener Prozess, lokale Datei-DB)', () => {
  let app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
  let cookie = '';
  const realFetch = globalThis.fetch;
  let driveOk = false;
  const uploads: string[] = [];

  beforeAll(async () => {
    if (!process.env.TURSO_DATABASE_URL!.startsWith('file:')) throw new Error('nur gegen lokale Datei-DB');
    const { runMigrations } = await import('../db/migrate');
    const { createClient } = await import('@libsql/client');
    const { getTableConfig } = await import('drizzle-orm/sqlite-core');
    const schema = await import('../db/schema');
    const cols = getTableConfig(schema.products).columns.map(c => `"${c.name}" ${c.getSQLType().toUpperCase()}${c.primary ? ' PRIMARY KEY' : ''}`);
    const client = createClient({ url: process.env.TURSO_DATABASE_URL! });
    await client.execute('DROP TABLE IF EXISTS products');
    await client.execute(`CREATE TABLE products (${cols.join(', ')})`);
    await runMigrations();
    const { db } = await import('../db/index');
    const base = { amazonUrl: 'x', htmlDescription: '<p/>', bullets: '[]', variants: '[]' };
    await db.insert(schema.products).values([
      { ...base, id: 229, asin: 'a229', title: 'O22-TOT', generatedTitle: 'Haarspangen tot', ebayStatus: 'none', ebayListingId: null },
      { ...base, id: 150, asin: 'a150', title: 'O22-TOT', generatedTitle: 'Kotbeutel tot', ebayStatus: 'none', ebayListingId: null },
      { ...base, id: 234, asin: 'a234', title: 'O22-LIVE', generatedTitle: 'Wandregal live', ebayStatus: 'listed', ebayListingId: '198755307690' },
    ] as never);
    await db.insert(schema.priceHistory).values({ productId: 229, price: 1.79 } as never);
    await db.insert(schema.appSettings).values({ key: 'gdrive_refresh_token', value: 'test-refresh' } as never);
    app = (await import('./index')).default as typeof app;
    const login = await app.request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: process.env.AUTH_USER1_NAME, password: process.env.AUTH_USER1_PASS }) });
    expect(login.status).toBe(200);
    cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'g', expires_in: 3600 }), { status: 200 });
      if (url.startsWith('https://www.googleapis.com/drive/v3/files')) return new Response(JSON.stringify({ files: [{ id: 'folder-1' }] }), { status: 200 });
      if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files')) {
        if (!driveOk) return new Response('kaputt', { status: 500 });
        const b = init?.body; uploads.push(typeof b === 'string' ? b : b instanceof Blob ? await b.text() : String(b));
        return new Response(JSON.stringify({ id: 'up-1', webViewLink: 'https://drive/x' }), { status: 200 });
      }
      throw new Error('unerwarteter Netzwerkaufruf: ' + url);
    }) as unknown as typeof fetch;
  });
  afterAll(() => { globalThis.fetch = realFetch; try { rmSync(dbFile, { force: true }); } catch { /* egal */ } });

  const post = (body: unknown) => app.request('/api/products/bulk-delete', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });
  const ids = async () => {
    const { db } = await import('../db/index');
    const schema = await import('../db/schema');
    return (await db.select().from(schema.products)).map(p => p.id).sort((a, b) => a - b);
  };

  test('Vorschau (ohne confirm): 234 gesperrt, nichts gelöscht', async () => {
    const res = await post({ ids: [229, 150, 234] });
    expect(res.status).toBe(200);
    const d = await res.json() as { mode: string; deletable: Array<{ id: number }>; blocked: Array<{ id: number; reason: string }> };
    expect(d.mode).toBe('preview');
    expect(d.deletable.map(x => x.id)).toEqual([229, 150]);
    expect(d.blocked.map(x => x.id)).toEqual([234]);
    expect(await ids()).toEqual([150, 229, 234]);
  });

  test('Sicherung schlägt fehl → nichts gelöscht', async () => {
    driveOk = false;
    const res = await post({ ids: [229, 150, 234], confirm: true });
    expect(res.status).toBe(502);
    const d = await res.json() as { error?: string };
    expect(d.error).toContain('nichts gelöscht');
    expect(await ids()).toEqual([150, 229, 234]);
  });

  test('mit Sicherung: 229 + 150 gelöscht, 234 bleibt, Sicherung enthält beide', async () => {
    driveOk = true;
    const res = await post({ ids: [229, 150, 234], confirm: true });
    expect(res.status).toBe(200);
    const d = await res.json() as { results: Array<{ id: number; ok: boolean }>; blocked: Array<{ id: number }>; backup: { name: string } };
    expect(d.results).toEqual([{ id: 229, ok: true }, { id: 150, ok: true }]);
    expect(d.blocked.map(x => x.id)).toEqual([234]);
    expect(d.backup.name).toMatch(/^geloeschte-produkte-.*-2-stueck\.json$/);
    expect(await ids()).toEqual([234]);
    const up = uploads.join('\n');
    expect(up).toContain('Haarspangen tot');
    expect(up).toContain('Kotbeutel tot');
    expect(up).not.toContain('Wandregal live');
    console.log('Textauszug Sicherung: ' + d.backup.name);
  });
});
