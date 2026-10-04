// A-029 (P-E01): Ende-zu-Ende gegen eine LOKALE Test-DB (Datei) und die echte App — Migration (additiv), Einstellungen, Produkt-PATCH und die Elektro-Sperre
// in POST /api/ebay/list. Die Sperre antwortet VOR jedem eBay-Aufruf; ein globaler fetch-Spion beweist, dass in keinem Fall ein Netzwerkaufruf passiert.
// Die Tabelle "products" wird aus dem Schema OHNE die 5 neuen Spalten angelegt (= Stand der Produktions-DB vor dem Deploy), dann läuft runMigrations().
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const dbFile = join(tmpdir(), 'a029-route-test.db').replace(/\\/g, '/');
try { rmSync(dbFile, { force: true }); } catch { /* neu anlegen */ }
// Der db-Client ist ein Singleton: lädt vorher eine andere Testdatei die DB, gilt deren (lokale) Datei-URL — es wird NIE etwas gegen eine Nicht-Datei-DB getan (siehe beforeAll).
if (!process.env.TURSO_DATABASE_URL) process.env.TURSO_DATABASE_URL = 'file:' + dbFile;
process.env.SESSION_SECRET = 'test-secret-a029';
process.env.AUTH_USER1_NAME = 'a029-tester';
process.env.AUTH_USER1_PASS = 'a029-pass';
process.env.EBAY_REFRESH_TOKEN = process.env.EBAY_REFRESH_TOKEN || 'test-refresh-token';

const NEW_COLUMNS = ['is_electric', 'electric_suggested', 'device_type', 'has_battery', 'electric_proofs'];
let app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
let cookie = '';
let fetchCalls = 0;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const { createClient } = await import('@libsql/client');
  const { getTableConfig } = await import('drizzle-orm/sqlite-core');
  const schema = await import('../db/schema');
  const cols = getTableConfig(schema.products).columns.filter(c => !NEW_COLUMNS.includes(c.name)).map(c => `"${c.name}" ${c.getSQLType().toUpperCase()}${c.primary ? ' PRIMARY KEY' : ''}`);
  if (!process.env.TURSO_DATABASE_URL!.startsWith('file:')) throw new Error('Dieser Test arbeitet nur gegen eine lokale Datei-DB, nie gegen Turso/Produktion');
  const client = createClient({ url: process.env.TURSO_DATABASE_URL! });
  await client.execute('DROP TABLE IF EXISTS products');
  await client.execute('DROP TABLE IF EXISTS app_settings');
  await client.execute(`CREATE TABLE products (${cols.join(', ')})`);
  await client.execute(`INSERT INTO products (id, asin, source_url, amazon_url, title, generated_title, html_description, bullets, variants, ebay_status) VALUES (1, 'ali_old', 'x', 'x', 'Alt', 'Altprodukt', '<p/>', '[]', '[]', 'listed')`);
  const { runMigrations } = await import('../db/migrate');
  await runMigrations();
  app = (await import('./index')).default as typeof app;
  const login = await app.request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.AUTH_USER1_NAME, password: process.env.AUTH_USER1_PASS }),
  });
  expect(login.status).toBe(200);
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
  globalThis.fetch = (async () => { fetchCalls++; throw new Error('Netzwerk darf nicht berührt werden'); }) as unknown as typeof fetch;
});
afterAll(() => { globalThis.fetch = realFetch; try { rmSync(dbFile, { force: true }); } catch { /* egal */ } });

const call = (method: string, path: string, body?: unknown) => app.request(path, {
  method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body),
});
const insertProduct = async (id: number, over: Record<string, unknown> = {}) => {
  const { db } = await import('../db/index');
  const schema = await import('../db/schema');
  await db.insert(schema.products).values({ id, asin: 'a' + id, sourceUrl: 'x', amazonUrl: 'x', title: 't', generatedTitle: 'T' + id, htmlDescription: '<p/>', bullets: '[]', variants: '[]', buyPrice: 5, ebayStatus: 'none', ...over } as never);
};
const readProduct = async (id: number) => {
  const { db } = await import('../db/index');
  const schema = await import('../db/schema');
  const { eq } = await import('drizzle-orm');
  return (await db.select().from(schema.products).where(eq(schema.products.id, id)))[0];
};
const listError = async (id: number) => {
  const res = await call('POST', '/api/ebay/list', { productId: id });
  return { status: res.status, error: ((await res.json()) as { error?: string }).error ?? '' };
};

describe('Migration (additiv) auf einer Tabelle im Stand VOR dem Deploy', () => {
  test('Bestandszeile bleibt unverändert lesbar; neue Spalten: is_electric NULL, electric_suggested 0, has_battery 0 → kein Elektro', async () => {
    const p = await readProduct(1);
    expect(p.generatedTitle).toBe('Altprodukt');
    expect(p.ebayStatus).toBe('listed');
    expect(p.isElectric).toBeNull();
    expect(p.electricSuggested).toBe(0);
    expect(p.hasBattery).toBe(0);
    expect(p.deviceType).toBeNull();
    expect(p.electricProofs).toBeNull();
    const { evaluateElectricGate } = await import('../shared/electric');
    expect(evaluateElectricGate(p, { weeeRegNr: null, registeredDeviceTypes: [] }).blocked).toBe(false);
  });
  test('zweiter Lauf der Migrationen ist folgenlos (Duplikat-Spalten werden übersprungen)', async () => {
    const { runMigrations } = await import('../db/migrate');
    await runMigrations();
    expect((await readProduct(1)).isElectric).toBeNull();
  });
});

describe('Einstellungen /api/settings/electric', () => {
  test('Start: WEEE-Nr. leer (nie vorbelegt), Gerätearten = nur "Kat. 5 Kleingeräte", Batterie-Registrierung AUS, Umlage 0', async () => {
    const d = await (await call('GET', '/api/settings/electric')).json() as Record<string, unknown>;
    expect(d).toEqual({ weeeRegNr: null, registeredDeviceTypes: ['Kat. 5 Kleingeräte'], batteryRegistration: false, earUmlageEur: 0 });
  });
  test('ungültiges Format → 400; leer erlaubt', async () => {
    const bad = await call('PUT', '/api/settings/electric', { weeeRegNr: 'DE123' });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toContain('DE" + 8 Ziffern');
    expect((await call('PUT', '/api/settings/electric', { weeeRegNr: '' })).status).toBe(200);
  });
  test('ohne Login → 401', async () => {
    const res = await app.request('/api/settings/electric', { method: 'GET' });
    expect(res.status).toBe(401);
  });
});

describe('Elektro-Sperre in POST /api/ebay/list (Klartext im Fehlerfeld, vor eBay)', () => {
  test('Elektro = ja, WEEE-Nr. leer → 400 "Elektro-Sperre: WEEE-Reg.-Nr. fehlt …", Status error + Text in der DB', async () => {
    await insertProduct(10, { isElectric: 1, deviceType: 'Kat. 5 Kleingeräte' });
    const r = await listError(10);
    expect(r.status).toBe(400);
    expect(r.error).toContain('Elektro-Sperre: WEEE-Reg.-Nr. fehlt');
    const p = await readProduct(10);
    expect(p.ebayStatus).toBe('error');
    expect(p.ebayError).toBe(r.error);
    console.log('Textauszug Fehlermeldung (WEEE leer): ' + r.error);
  });
  test('Batterie/Akku = ja → "Elektro-Sperre: Batterie nicht erlaubt" (auch ohne bestätigtes Elektro)', async () => {
    await insertProduct(11, { isElectric: 0, hasBattery: 1 });
    const r = await listError(11);
    expect(r).toEqual({ status: 400, error: 'Elektro-Sperre: Batterie nicht erlaubt' });
    console.log('Textauszug Fehlermeldung (Batterie): ' + r.error);
  });
  test('unbestätigter Import-Vorschlag → gesperrt, bis ja/nein gewählt ist', async () => {
    await insertProduct(12, { isElectric: null, electricSuggested: 1 });
    const r = await listError(12);
    expect(r.status).toBe(400);
    expect(r.error).toBe('Elektro-Sperre: Elektro-Vorschlag nicht bestätigt (bitte Elektro ja/nein wählen)');
    console.log('Textauszug Fehlermeldung (Vorschlag): ' + r.error);
  });
  test('Nicht-Elektro (Bestandsprodukt ohne Markierung) läuft an der Sperre vorbei — Fehler kommt erst später (keine Bilder)', async () => {
    await insertProduct(13, {});
    const r = await listError(13);
    expect(r.error).not.toContain('Elektro-Sperre');
    expect(r.error).toContain('Keine Bilder');
  });
  test('Schritt für Schritt freischalten: PATCH Geräteart/Nachweise + Einstellungen → die Sperre fällt, jede Lücke wird einzeln genannt', async () => {
    await insertProduct(14, { isElectric: 1 });
    // 1) ungültige Geräteart wird abgelehnt
    const badType = await call('PATCH', '/api/products/14', { deviceType: 'Kat. 3 Bildschirme' });
    expect(badType.status).toBe(400);
    // 2) alles Fehlende (WEEE leer, Geräteart, 4 Nachweise) wird genannt
    expect((await listError(14)).error).toContain('Geräteart fehlt');
    expect((await call('PATCH', '/api/products/14', { deviceType: 'Kat. 5 Kleingeräte' })).status).toBe(200);
    expect((await call('PUT', '/api/settings/electric', { weeeRegNr: 'DE12345678' })).status).toBe(200);
    const afterSettings = (await listError(14)).error;
    expect(afterSettings).toContain('Nachweis fehlt: CE-Kennzeichnung');
    expect(afterSettings).not.toContain('WEEE-Reg.-Nr.');
    expect(afterSettings).not.toContain('Geräteart');
    // 3) Nachweise (Häkchen + Beleg)
    const proofs = Object.fromEntries(['ce', 'declaration', 'manual', 'weeeSymbol'].map(k => [k, { ok: true, note: 'Beleg ' + k }]));
    expect((await call('PATCH', '/api/products/14', { electricProofs: proofs })).status).toBe(200);
    const final = await listError(14);
    expect(final.error).not.toContain('Elektro-Sperre');
    expect(final.error).toContain('Keine Bilder'); // erst NACH der Sperre
  });
  test('in keinem dieser Fälle wurde das Netzwerk berührt (kein eBay-Aufruf)', () => {
    expect(fetchCalls).toBe(0);
  });
});
