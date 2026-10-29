// OFFEN 017 (stele-243): "Fehler zurücksetzen" und Pflichtfeld nachtragen dürfen ein gelistetes Produkt (eBay-Nr) nie auf 'none' setzen.
// Lokale Datei-DB + echte App, eigener Prozess (Muster A-030), gestartet von listing-status-route.test.ts. Kein Netzwerk.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const IS_CHILD = process.env.A030_CHILD === '1';
const dbFile = join(tmpdir(), 'offen017-route-test.db').replace(/\\/g, '/');
if (IS_CHILD) {
  try { rmSync(dbFile, { force: true }); } catch { /* neu anlegen */ }
  process.env.TURSO_DATABASE_URL = 'file:' + dbFile;
  process.env.TURSO_AUTH_TOKEN = '';
  process.env.SESSION_SECRET = 'test-secret-offen017';
  process.env.AUTH_USER1_NAME = 'o17-tester';
  process.env.AUTH_USER1_PASS = 'o17-pass';
  process.env.EBAY_REFRESH_TOKEN = 'test-refresh-token';
}

describe.skipIf(!IS_CHILD)('OFFEN 017 – Status bleibt listed (eigener Prozess, lokale Datei-DB)', () => {
  let app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
  let cookie = '';
  const realFetch = globalThis.fetch;
  let fetchCalls = 0;

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
    const base = { asin: 'a', sourceUrl: 'x', amazonUrl: 'x', title: 'O17-LOKAL', generatedTitle: 'Handschuhe', htmlDescription: '<p/>', bullets: '[]', variants: '[]' };
    // 243: live gelistet, aber mit altem Pflichtfeld-Fehler (Stand aus zweitem Gerät)
    await db.insert(schema.products).values({ ...base, id: 243, asin: 'a243', ebayStatus: 'listed', ebayListingId: '198755130523', ebayError: 'eBay-Pflichtfeld "Größe" fehlt', ebayMissingAspect: 'Größe' } as never);
    await db.insert(schema.products).values({ ...base, id: 244, asin: 'a244', ebayStatus: 'listed', ebayListingId: '198755130599', ebayError: 'alt' } as never);
    await db.insert(schema.products).values({ ...base, id: 245, asin: 'a245', ebayStatus: 'error', ebayListingId: null, ebayError: 'Pflichtfeld', ebayMissingAspect: 'Größe' } as never);
    app = (await import('./index')).default as typeof app;
    const login = await app.request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: process.env.AUTH_USER1_NAME, password: process.env.AUTH_USER1_PASS }) });
    expect(login.status).toBe(200);
    cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    globalThis.fetch = (async () => { fetchCalls++; throw new Error('Netzwerk darf nicht berührt werden'); }) as unknown as typeof fetch;
  }, 30_000);
  afterAll(() => { globalThis.fetch = realFetch; try { rmSync(dbFile, { force: true }); } catch { /* egal */ } });

  const call = (method: string, path: string, body?: unknown) => app.request(path, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const read = async (id: number) => {
    const { db } = await import('../db/index');
    const schema = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    return (await db.select().from(schema.products).where(eq(schema.products.id, id)))[0];
  };

  test('Pflichtfeld Größe nachtragen bei gelistetem 243 → bleibt listed mit eBay-Nr, Fehler leer', async () => {
    const r = await call('PATCH', '/api/products/243', { manualAspects: { 'Größe': 'Einheitsgröße' } });
    expect(r.status).toBe(200);
    const p = await read(243);
    expect(p.ebayStatus).toBe('listed');
    expect(p.ebayListingId).toBe('198755130523');
    expect(p.ebayError).toBeNull();
    expect(p.ebayMissingAspect).toBeNull();
  });
  test('"Fehler zurücksetzen" bei gelistetem 244 → bleibt listed', async () => {
    const r = await call('POST', '/api/products/244/reset-error');
    expect(r.status).toBe(200);
    expect(((await r.json()) as { ebayStatus?: string }).ebayStatus).toBe('listed');
    const p = await read(244);
    expect(p.ebayStatus).toBe('listed');
    expect(p.ebayError).toBeNull();
  });
  test('ohne eBay-Nr (245) → none wie bisher', async () => {
    await call('PATCH', '/api/products/245', { manualAspects: { 'Größe': 'M' } });
    expect((await read(245)).ebayStatus).toBe('none');
  });
  test('kein Netzwerkaufruf', () => { expect(fetchCalls).toBe(0); });
});
