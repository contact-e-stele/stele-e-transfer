// A-045: Migration (additiv) + PATCH /api/products/:id mit den Produktdaten für die Beschreibung v2 gegen eine LOKALE Datei-DB und die echte App.
// Eigener Prozess (Muster A-030): product-data-route.test.ts startet diese Datei mit A045_CHILD=1 und kontrollierter Umgebung.
// Die Tabelle "products" wird aus dem Schema OHNE die 5 neuen Spalten angelegt (= Stand der Produktions-DB vor dem Deploy), dann läuft runMigrations().
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const IS_CHILD = process.env.A045_CHILD === '1';
const dbFile = join(tmpdir(), 'a045-route-test.db').replaceAll('\\', '/');
if (IS_CHILD) {
  try { rmSync(dbFile, { force: true }); } catch { /* neu anlegen */ }
  process.env.TURSO_DATABASE_URL = 'file:' + dbFile;
  process.env.TURSO_AUTH_TOKEN = '';
  process.env.SESSION_SECRET = 'test-secret-a045';
  process.env.AUTH_USER1_NAME = 'a045-tester';
  process.env.AUTH_USER1_PASS = 'a045-pass';
}

describe.skipIf(!IS_CHILD)('Produktdaten Beschreibung v2 (eigener Prozess, lokale Datei-DB)', () => {
  const NEW_COLUMNS = ['material', 'usage_note', 'use_purpose', 'variant_details', 'material_source'];
  let app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
  let cookie = '';

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
    await client.execute(`INSERT INTO products (id, asin, source_url, amazon_url, title, generated_title, html_description, bullets, variants, ebay_status) VALUES (1, 'ali_old', 'x', 'x', 'A045-LOKALE-TESTZEILE', 'Altprodukt', '<p/>', '[]', '[]', 'none')`);
    const before = (await client.execute('PRAGMA table_info(products)')).rows.map(r => String(r.name));
    for (const c of NEW_COLUMNS) expect(before).not.toContain(c);
    const { runMigrations } = await import('../db/migrate');
    await runMigrations();
    const { db: appDb } = await import('../db/index');
    const { eq } = await import('drizzle-orm');
    const probe = await appDb.select({ title: schema.products.title }).from(schema.products).where(eq(schema.products.id, 1)).catch(() => []);
    if (probe[0]?.title !== 'A045-LOKALE-TESTZEILE') throw new Error('db-Singleton zeigt nicht auf die lokale Test-DB — Abbruch, nichts geschrieben');
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
  const read = async () => {
    const { db } = await import('../db/index');
    const schema = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    return db.select().from(schema.products).where(eq(schema.products.id, 1)).get();
  };

  test('Migration additiv: 5 neue Spalten da, Altzeile unverändert, neue Felder NULL', async () => {
    const { createClient } = await import('@libsql/client');
    const cols = (await createClient({ url: process.env.TURSO_DATABASE_URL! }).execute('PRAGMA table_info(products)')).rows.map(r => String(r.name));
    for (const c of NEW_COLUMNS) expect(cols).toContain(c);
    const row = await read();
    expect(row?.title).toBe('A045-LOKALE-TESTZEILE');
    expect(row?.material ?? null).toBeNull();
    expect(row?.variantDetails ?? null).toBeNull();
  });

  test('ungültig → 400 mit Klartext, nichts gespeichert', async () => {
    const res = await patch({ material: 'Silikon', variantDetails: { 'stele-1-A': { displayNameDe: 'X', pieces: 1, measure: { kind: 'D', values: [40], source: 'z', location: 'Titel' } } } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('a, b, c oder d');
    expect((await read())?.material ?? null).toBeNull();
  });

  test('gültig (v2.3-Beispiel stele-127) → 200, JSON gespeichert; null löscht', async () => {
    const vd = { 'stele-127-A': { displayNameDe: 'Dehnbar', pieces: 2, measure: { kind: 'STRETCH', values: [10, 37], source: 'c', location: 'Galeriebild 4' } } };
    const res = await patch({ material: 'Silikon', usageNote: 'mehrfach verwendbar', usePurpose: 'Frischhaltehaube', materialSource: { source: 'a', location: 'Titel' }, variantDetails: vd });
    expect(res.status).toBe(200);
    const row = await read();
    expect(row?.material).toBe('Silikon');
    expect(JSON.parse(row!.variantDetails!)).toEqual(vd);
    expect(JSON.parse(row!.materialSource!)).toEqual({ source: 'a', location: 'Titel' });
    expect((await patch({ variantDetails: null, material: null })).status).toBe(200);
    const cleared = await read();
    expect(cleared?.variantDetails ?? null).toBeNull();
    expect(cleared?.material ?? null).toBeNull();
  });
});
