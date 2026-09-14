// P-81 — Aufgabe 3: prüft, ob ad_rate WIRKLICH als Spalte in der echten DB existiert (nicht nur
// im Drizzle-Schema/TypeScript-Typ) und ob sie heute schon befüllt ist. NUR LESEND.
import { createClient } from '@libsql/client';

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url) throw new Error('TURSO_DATABASE_URL not set');
const client = createClient({ url, authToken });

const info = await client.execute(`PRAGMA table_info(products)`);
const adRateCol = info.rows.find(r => r.name === 'ad_rate');
console.log('PRAGMA table_info(products) — Spalte ad_rate:', adRateCol ?? 'NICHT VORHANDEN');

if (adRateCol) {
  const stats = await client.execute(`
    SELECT
      COUNT(*) AS total,
      COUNT(ad_rate) AS non_null,
      COUNT(CASE WHEN ad_rate = 0 THEN 1 END) AS zero,
      COUNT(CASE WHEN ad_rate > 0 THEN 1 END) AS positive,
      MIN(ad_rate) AS min_val,
      MAX(ad_rate) AS max_val
    FROM products
  `);
  console.log('Befüllungs-Statistik:', stats.rows[0]);

  const distinct = await client.execute(`SELECT DISTINCT ad_rate FROM products ORDER BY ad_rate`);
  console.log('Vorkommende Werte:', distinct.rows.map(r => r.ad_rate));
}
