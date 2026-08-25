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
  `ALTER TABLE products ADD COLUMN aliexpress_item_id TEXT`,
  `ALTER TABLE products ADD COLUMN variant_prices TEXT`,
  `ALTER TABLE products ADD COLUMN variant_contents TEXT`,
  `ALTER TABLE products ADD COLUMN gpsr_raw TEXT`,
  `ALTER TABLE products ADD COLUMN gpsr_html TEXT`,
  `ALTER TABLE products ADD COLUMN ebay_category TEXT`,
  // GPSR strukturiert
  `ALTER TABLE products ADD COLUMN gpsr_name TEXT`,
  `ALTER TABLE products ADD COLUMN gpsr_address TEXT`,
  `ALTER TABLE products ADD COLUMN gpsr_city TEXT`,
  `ALTER TABLE products ADD COLUMN gpsr_email TEXT`,
  `ALTER TABLE products ADD COLUMN gpsr_phone TEXT`,
  // Handbuch/Zertifikat-Upload + Freitextnotiz — rein manuell, kein Automatismus (GPSR/Handbuch-Vereinfachung)
  `ALTER TABLE products ADD COLUMN manual_pdf_url TEXT`,
  `ALTER TABLE products ADD COLUMN certification_note TEXT`,
  // Preis-Historie Tabelle
  `CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    price REAL NOT NULL,
    source TEXT DEFAULT 'aliexpress',
    checked_at TEXT DEFAULT (datetime('now'))
  )`,
  // App-Einstellungen (Key-Value) — für OAuth Tokens etc.
  `CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  // Bearbeitungszeit pro Produkt (eBay Fulfillment Policy)
  `ALTER TABLE products ADD COLUMN handling_time_days INTEGER DEFAULT 10`,
  // Versandland — gesetzt beim AliExpress Import (ab 01.07.2026 relevant für China-Zoll)
  `ALTER TABLE products ADD COLUMN ships_from TEXT`,
  // Versandkosten (0 = kostenlos), manuell im Import-Tab erfasst
  `ALTER TABLE products ADD COLUMN shipping_cost REAL DEFAULT 0`,
  // Vertrauenswürdige Lieferanten (EU-bestätigte AliExpress Shops)
  `CREATE TABLE IF NOT EXISTS trusted_suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_name TEXT NOT NULL,
    shop_url TEXT NOT NULL,
    ali_store_id TEXT,
    eu_confirmed INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // Bestellungen — lokale Zusatzinfos zu eBay-Bestellungen (P13)
  `CREATE TABLE IF NOT EXISTS order_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ebay_order_id TEXT NOT NULL UNIQUE,
    tracking_number TEXT,
    carrier TEXT,
    shipped_at TEXT,
    customer_notified_at TEXT,
    internal_note TEXT,
    invoice_generated_at TEXT,
    invoice_path TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  // Falls order_notes schon ohne invoice-Spalten existiert (Update-Fall)
  `ALTER TABLE order_notes ADD COLUMN invoice_generated_at TEXT`,
  `ALTER TABLE order_notes ADD COLUMN invoice_path TEXT`,
  // AliExpress-Bestellnummer + Rechnung (manuell), P13 Erweiterung
  `ALTER TABLE order_notes ADD COLUMN aliexpress_order_id TEXT`,
  `ALTER TABLE order_notes ADD COLUMN aliexpress_invoice_url TEXT`,
  // Tatsaechlicher Einkaufspreis laut Rechnung (manuell) - hat Vorrang vor automatischem DB-Match
  `ALTER TABLE order_notes ADD COLUMN manual_buy_price REAL`,
  // Zeitpunkt der "neue Bestellung"-Benachrichtigungsmail — verhindert Doppel-Mails bei wiederholten Checks
  `ALTER TABLE order_notes ADD COLUMN notification_sent_at TEXT`,
  // P-86: Zeitpunkt, zu dem der Danke+Sendungsnummer-Entwurf als "erledigt" bestätigt wurde
  // (separat von customer_notified_at aus P-85, das die Bewertungsbitte betrifft — andere Nachricht)
  `ALTER TABLE order_notes ADD COLUMN thank_you_sent_at TEXT`,
  // Kategorie fuer manuell gespeicherte Shops (feste Auswahlliste, siehe shared/constants.ts SHOP_CATEGORIES)
  `ALTER TABLE trusted_suppliers ADD COLUMN category TEXT`,
  // Compliance-Prüfung für Lieferanten (P-66 Schritt 1) — noch kein Import-Gate
  `ALTER TABLE trusted_suppliers ADD COLUMN compliance_status TEXT DEFAULT 'ungeprueft'`,
  `ALTER TABLE trusted_suppliers ADD COLUMN compliance_docs_verified_at TEXT`,
  `ALTER TABLE trusted_suppliers ADD COLUMN compliance_notes TEXT`,
  // P-88: manuelles Eingabefeld für eBay-Pflichtfelder, die die Selbstheilung (P-91/92) nicht befüllen konnte
  `ALTER TABLE products ADD COLUMN ebay_missing_aspect TEXT`,
  `ALTER TABLE products ADD COLUMN manual_aspects TEXT`,
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
