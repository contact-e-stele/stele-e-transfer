// Design-Sprint S2: Migration (additiv) + GET /api/products/:id/pflichtdaten-preview (nur lesen) + PATCH pflichtDaten gegen eine LOKALE
// Datei-DB und die echte App. Die Tabelle "products" wird OHNE die neue Spalte angelegt (= Stand der Produktions-DB vor dem Deploy).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const IS_CHILD = process.env.S2_CHILD === '1';
const dbFile = join(tmpdir(), 's2-pflichtdaten-route-test.db').replaceAll('\\', '/');
if (IS_CHILD) {
  try { rmSync(dbFile, { force: true }); } catch { /* neu anlegen */ }
  process.env.TURSO_DATABASE_URL = 'file:' + dbFile;
  process.env.TURSO_AUTH_TOKEN = '';
  process.env.SESSION_SECRET = 'test-secret-s2';
  process.env.AUTH_USER1_NAME = 's2-tester';
  process.env.AUTH_USER1_PASS = 's2-pass';
}

describe.skipIf(!IS_CHILD)('Pflicht-Daten (eigener Prozess, lokale Datei-DB)', () => {
  const NEW_COLUMNS = ['pflicht_daten'];
  let app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
  let cookie = '';
  const VP = JSON.stringify([
    { skuId: '1', attrs: { Color: 'White', Size: 'Diameter 20cm', 'Ships From': 'CHINA' }, price: 1 },
    { skuId: '2', attrs: { Color: 'Champagne', Size: 'Diameter 25cm', 'Ships From': 'CHINA' }, price: 1 },
  ]);

  beforeAll(async () => {
    if (!process.env.TURSO_DATABASE_URL!.startsWith('file:')) throw new Error('Dieser Test arbeitet nur gegen eine lokale Datei-DB, nie gegen Turso/Produktion');
    const { createClient } = await import('@libsql/client');
    const { getTableConfig } = await import('drizzle-orm/sqlite-core');
    const schema = await import('../db/schema');
    const cols = getTableConfig(schema.products).columns.filter(c => !NEW_COLUMNS.includes(c.name)).map(c => `"${c.name}" ${c.getSQLType().toUpperCase()}${c.primary ? ' PRIMARY KEY' : ''}`);
    const client = createClient({ url: process.env.TURSO_DATABASE_URL! });
    await client.execute('DROP TABLE IF EXISTS products');
    await client.execute('DROP TABLE IF EXISTS app_settings');
    await client.execute(`CREATE TABLE products (${cols.join(', ')})`);
    await client.execute({ sql: `INSERT INTO products (id, asin, source_url, amazon_url, title, generated_title, html_description, bullets, variants, variant_prices, specs, ebay_status) VALUES (1, 'ali_s2', 'x', 'x', 'S2-LOKALE-TESTZEILE', 'Servierplatte', '<p/>', '[]', '[]', ?, ?, 'none')`, args: [VP, JSON.stringify({ Material: 'Stainless Steel', Produktart: 'Servierplatte' })] });
    const before = (await client.execute('PRAGMA table_info(products)')).rows.map(r => String(r.name));
    for (const c of NEW_COLUMNS) expect(before).not.toContain(c);
    const { runMigrations } = await import('../db/migrate');
    await runMigrations();
    const { db: appDb } = await import('../db/index');
    const { eq } = await import('drizzle-orm');
    const probe = await appDb.select({ title: schema.products.title }).from(schema.products).where(eq(schema.products.id, 1)).catch(() => []);
    if (probe[0]?.title !== 'S2-LOKALE-TESTZEILE') throw new Error('db-Singleton zeigt nicht auf die lokale Test-DB — Abbruch, nichts geschrieben');
    app = (await import('./index')).default as typeof app;
    const login = await app.request('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: process.env.AUTH_USER1_NAME, password: process.env.AUTH_USER1_PASS }),
    });
    expect(login.status).toBe(200);
    cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
  });
  afterAll(() => { try { rmSync(dbFile, { force: true }); } catch { /* egal */ } });

  const patch = (body: unknown) => app.request('/api/products/1', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });
  const preview = () => app.request('/api/products/1/pflichtdaten-preview', { headers: { Cookie: cookie } });
  const read = async () => {
    const { db } = await import('../db/index');
    const schema = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    return db.select().from(schema.products).where(eq(schema.products.id, 1)).get();
  };

  test('Migration additiv: Spalte pflicht_daten da, Altzeile unverändert, Wert NULL', async () => {
    const { createClient } = await import('@libsql/client');
    const cols = (await createClient({ url: process.env.TURSO_DATABASE_URL! }).execute('PRAGMA table_info(products)')).rows.map(r => String(r.name));
    expect(cols).toContain('pflicht_daten');
    const row = await read();
    expect(row?.title).toBe('S2-LOKALE-TESTZEILE');
    expect(row?.pflichtDaten ?? null).toBeNull();
  });

  test('Vorschau: nur lesen — Vorschlag mit Quelle, GELB (P4 fehlt, Farbe unbekannt), nichts geschrieben', async () => {
    const before = await read();
    const res = await preview();
    expect(res.status).toBe(200);
    const d = await res.json() as { readOnly: boolean; gespeichert: unknown; ampel: { status: string; text: string }; merkmale: Record<string, string>; ergebnis: { produktart: { value: string; source: string; herkunft: string } } };
    expect(d.readOnly).toBe(true);
    expect(d.gespeichert).toBeNull();
    expect(d.ergebnis.produktart).toMatchObject({ value: 'Servierplatte', source: 'b', herkunft: 'vorschlag' });
    expect(d.ampel.status).toBe('GELB');
    expect(d.ampel.text).toBe('Pflicht-Daten fehlen: Lieferumfang · Farbe unbekannt: Champagne');
    expect(d.merkmale).toEqual({ Produktart: 'Servierplatte', Material: 'Edelstahl' });
    expect(await read()).toEqual(before);
    expect((await app.request('/api/products/999/pflichtdaten-preview', { headers: { Cookie: cookie } })).status).toBe(404);
  });

  test('PATCH ungültig → 400, nichts gespeichert', async () => {
    const res = await patch({ pflichtDaten: { farben: { '2': { value: 'Champagner', source: 'a', location: 'Variantenauswahl', wording: 'Champagne' } } } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('nicht in der festen Farbliste');
    expect((await read())?.pflichtDaten ?? null).toBeNull();
  });

  test('PATCH gültig → 200, Quelle gespeichert, Vorschau GRÜN; null löscht', async () => {
    const res = await patch({ pflichtDaten: {
      lieferumfang: { value: '1 Platte', source: 'c', location: 'Galeriebild 2', wording: '1 x plate' },
      farben: { '2': { value: 'Gold', source: 'c', location: 'Galeriebild 4', wording: 'gold' } },
    } });
    expect(res.status).toBe(200);
    const stored = JSON.parse((await read())!.pflichtDaten!);
    expect(stored.lieferumfang).toEqual({ value: '1 Platte', source: 'c', location: 'Galeriebild 2', wording: '1 x plate' });
    const d = await (await preview()).json() as { ampel: { status: string } };
    expect(d.ampel.status).toBe('GRUEN');
    expect((await patch({ pflichtDaten: null })).status).toBe(200);
    expect((await read())?.pflichtDaten ?? null).toBeNull();
  });
});
