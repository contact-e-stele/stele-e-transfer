/**
 * DB Migration — fügt neue Spalten hinzu ohne bestehende Daten zu löschen
 * Sicher bei wiederholtem Ausführen (IF NOT EXISTS / try-catch pro Statement)
 *
 * Ausführen: bun run packages/web/src/db/migrate.ts
 */
import { createClient } from '@libsql/client';

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url) throw new Error('TURSO_DATABASE_URL not set');

const client = createClient({ url, authToken });

const migrations = [
  // Neue Spalten in products
  `ALTER TABLE products ADD COLUMN generated_description TEXT`,
  `ALTER TABLE products ADD COLUMN source_url TEXT`,
  `ALTER TABLE products ADD COLUMN images TEXT`,
  `ALTER TABLE products ADD COLUMN buy_price REAL`,
  `ALTER TABLE products ADD COLUMN sell_price REAL`,
  `ALTER TABLE products ADD COLUMN last_price_check TEXT`,
  `ALTER TABLE products ADD COLUMN price_changed INTEGER DEFAULT 0`,
  `ALTER TABLE products ADD COLUMN specs TEXT`,
  // Preis-Historie Tabelle
  `CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    price REAL NOT NULL,
    source TEXT DEFAULT 'aliexpress',
    checked_at TEXT DEFAULT (datetime('now'))
  )`,
];

export async function runMigrations() {
  console.log('[migrate] Starting migrations...');
  for (const sql of migrations) {
    try {
      await client.execute(sql);
      console.log(`[migrate] ✓ ${sql.slice(0, 60)}...`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column') || msg.includes('already exists')) {
        console.log(`[migrate] → Skip (already exists): ${sql.slice(0, 60)}`);
      } else {
        console.error(`[migrate] ✗ FAILED: ${sql}`);
        console.error(msg);
      }
    }
  }
  console.log('[migrate] Done.');
}

// Direct execution
if (import.meta.main) {
  runMigrations();
}
