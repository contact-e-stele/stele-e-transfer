// OFFEN 013 (stele-220): DELETE /api/ebay/listings/:itemId gegen eine LOKALE Datei-DB und die echte App.
// eBay wird per fetch-Attrappe gespielt (OAuth + EndItem). Regel 6a: Verknüpfung nur nach bestätigtem Ende lösen.
// Läuft wie electric-route.child.test.ts in einem EIGENEN Prozess (A-030), gestartet von listing-guard-route.test.ts.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const IS_CHILD = process.env.A030_CHILD === '1';
const dbFile = join(tmpdir(), 'offen013-route-test.db').replace(/\\/g, '/');
if (IS_CHILD) {
  try { rmSync(dbFile, { force: true }); } catch { /* neu anlegen */ }
  process.env.TURSO_DATABASE_URL = 'file:' + dbFile;
  process.env.TURSO_AUTH_TOKEN = '';
  process.env.SESSION_SECRET = 'test-secret-offen013';
  process.env.AUTH_USER1_NAME = 'o13-tester';
  process.env.AUTH_USER1_PASS = 'o13-pass';
  process.env.EBAY_REFRESH_TOKEN = 'test-refresh-token';
}

describe.skipIf(!IS_CHILD)('OFFEN 013 Regel 6a – DELETE /api/ebay/listings/:itemId (eigener Prozess, lokale Datei-DB)', () => {
  let app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
  let cookie = '';
  const realFetch = globalThis.fetch;
  let endItemAnswer = '';
  const endItemCalls: string[] = [];

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
    await db.insert(schema.products).values({ id: 220, asin: 'a220', sourceUrl: 'https://www.aliexpress.com/item/1005012236402215.html', amazonUrl: 'x', title: 'O13-LOKALE-TESTZEILE', generatedTitle: 'Reisekissen', htmlDescription: '<p/>', bullets: '[]', variants: '[]', ebayStatus: 'listed', ebayListingId: '198712713157' } as never);
    app = (await import('./index')).default as typeof app;
    const login = await app.request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: process.env.AUTH_USER1_NAME, password: process.env.AUTH_USER1_PASS }) });
    expect(login.status).toBe(200);
    cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('/identity/v1/oauth2/token')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 7200 }), { status: 200 });
      const callName = new Headers(init?.headers).get('X-EBAY-API-CALL-NAME');
      if (url.includes('/ws/api.dll') && callName === 'EndItem') { endItemCalls.push(String(init?.body ?? '')); return new Response(endItemAnswer, { status: 200 }); }
      throw new Error('unerwarteter Netzwerkaufruf: ' + url + ' ' + callName);
    }) as unknown as typeof fetch;
  });
  afterAll(() => { globalThis.fetch = realFetch; try { rmSync(dbFile, { force: true }); } catch { /* egal */ } });

  const del = (itemId: string) => app.request(`/api/ebay/listings/${itemId}`, { method: 'DELETE', headers: { Cookie: cookie } });
  const read220 = async () => {
    const { db } = await import('../db/index');
    const schema = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    return (await db.select().from(schema.products).where(eq(schema.products.id, 220)))[0];
  };

  test('eBay lehnt das Beenden ab → 502 mit Klartext, Produkt 220 bleibt verknüpft und gelistet', async () => {
    endItemAnswer = '<EndItemResponse><Ack>Failure</Ack><Errors><LongMessage>Dieses Angebot wird über die warenbestandsbasierte Angebotsverwaltung verwaltet.</LongMessage></Errors></EndItemResponse>';
    const res = await del('198712713157');
    expect(res.status).toBe(502);
    const body = await res.json() as { ok?: boolean; warning?: string; error?: string };
    expect(body.ok).toBeUndefined();
    expect(body.warning).toBeUndefined();
    expect(body.error).toContain('nicht bestätigt');
    const p = await read220();
    expect(p.ebayListingId).toBe('198712713157');
    expect(p.ebayStatus).toBe('listed');
    console.log('Textauszug Fehlermeldung: ' + body.error);
  });

  test('eBay bestätigt das Ende → ok, Verknüpfung gelöst', async () => {
    endItemAnswer = '<EndItemResponse><Ack>Success</Ack><EndTime>2026-10-28T20:09:00.000Z</EndTime></EndItemResponse>';
    const res = await del('198712713157');
    expect(res.status).toBe(200);
    expect((await res.json() as { ok?: boolean }).ok).toBe(true);
    const p = await read220();
    expect(p.ebayListingId).toBeNull();
    expect(p.ebayStatus).toBe('none');
    expect(endItemCalls.length).toBe(2);
  });
});
