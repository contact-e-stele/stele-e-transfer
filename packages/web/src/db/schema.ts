import { sql } from 'drizzle-orm';
import { text, integer, real, sqliteTable } from 'drizzle-orm/sqlite-core';

// ─── Produkte (aus AliExpress gescrapt) ──────────────────────────────────────
export const products = sqliteTable('products', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  asin: text('asin').notNull().unique(),       // intern: ali_<timestamp>
  sourceUrl: text('source_url'),               // AliExpress URL
  amazonUrl: text('amazon_url').notNull(),     // legacy (= sourceUrl)
  aliexpressItemId: text('aliexpress_item_id'), // AliExpress Produkt-ID z.B. 1005012438990021
  variantPrices: text('variant_prices'), // JSON: [{skuId, attrs:{Farbe:"Rot",Größe:"M"}, price:12.99}]
  title: text('title').notNull(),              // Original-Titel
  generatedTitle: text('generated_title').notNull(),
  generatedDescription: text('generated_description'), // fertige HTML-Beschreibung für eBay
  htmlDescription: text('html_description').notNull(),
  bullets: text('bullets').notNull(),          // JSON array
  variants: text('variants').notNull(),        // JSON array
  description: text('description'),
  images: text('images'),                      // JSON array von Bild-URLs
  // Preise
  buyPrice: real('buy_price'),                 // Einkaufspreis (AliExpress, €)
  shippingCost: real('shipping_cost').default(0), // Versandkosten laut Lieferanten-Seite (0 = kostenlos)
  sellPrice: real('sell_price'),               // Verkaufspreis (eBay, €)
  lastPriceCheck: text('last_price_check'),    // ISO datetime
  priceChanged: integer('price_changed', { mode: 'boolean' }).default(false),
  // eBay
  specs: text('specs'),                        // JSON object — AliExpress Produktspezifikationen
  adRate: real('ad_rate').default(5),            // Anzeigentarif % (Promoted Listings)
  ebayListingId: text('ebay_listing_id'),
  ebayStatus: text('ebay_status').default('none'), // none | listed | error
  ebayError: text('ebay_error'),
  ebayCategory: text('ebay_category'),           // manuell gesetzte eBay Kategorie-ID
  variantContents: text('variant_contents'), // JSON: {"SET1":"10 kleine + 10 große","SET2":"..."}
  gpsrRaw: text('gpsr_raw'),                 // Rohtext aus Import-Feld (legacy)
  gpsrHtml: text('gpsr_html'),               // fertiger HTML-Block für eBay (legacy)
  // GPSR strukturiert (EU Produktsicherheitsverordnung)
  gpsrName: text('gpsr_name'),               // Hersteller/Verantwortlicher Name
  gpsrAddress: text('gpsr_address'),         // Straße + Hausnummer
  gpsrCity: text('gpsr_city'),               // PLZ + Stadt
  gpsrEmail: text('gpsr_email'),             // E-Mail
  gpsrPhone: text('gpsr_phone'),             // Telefon
  handlingTimeDays: integer('handling_time_days').default(10), // Bearbeitungszeit in Tagen (eBay Fulfillment Policy)
  shipsFrom: text('ships_from'),       // Versandland (z.B. 'DE', 'China') — gesetzt beim AliExpress Import
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
});

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;

// ─── Preis-Historie ───────────────────────────────────────────────────────────
export const priceHistory = sqliteTable('price_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  productId: integer('product_id').notNull(),
  price: real('price').notNull(),
  source: text('source').default('aliexpress'), // aliexpress | manual
  checkedAt: text('checked_at').default(sql`(datetime('now'))`),
});

export type PriceHistory = typeof priceHistory.$inferSelect;

// ─── App-Einstellungen (Key-Value Store) ──────────────────────────────────────
// Wird u.a. für AliExpress OAuth Tokens genutzt
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
});

export type AppSetting = typeof appSettings.$inferSelect;

// ─── Vertrauenswürdige Lieferanten (EU-bestätigte AliExpress Shops) ───────────
export const trustedSuppliers = sqliteTable('trusted_suppliers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  shopName: text('shop_name').notNull(),
  shopUrl: text('shop_url').notNull(),
  aliStoreId: text('ali_store_id'),
  euConfirmed: integer('eu_confirmed', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});

export type TrustedSupplier = typeof trustedSuppliers.$inferSelect;
export type NewTrustedSupplier = typeof trustedSuppliers.$inferInsert;

// ─── Bestellungen — lokale Zusatzinfos zu eBay-Bestellungen ───────────────────
// Kerndaten (Käufer, Artikel, Preis, Status) kommen live von eBay — hier nur App-spezifische Ergänzungen
export const orderNotes = sqliteTable('order_notes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ebayOrderId: text('ebay_order_id').notNull().unique(),
  trackingNumber: text('tracking_number'),
  carrier: text('carrier'),                    // z.B. DHL, Deutsche Post, Hermes, DPD
  shippedAt: text('shipped_at'),                // manuell gesetzt (lokaler Status, unabhaengig von eBay Fulfillment)
  customerNotifiedAt: text('customer_notified_at'),
  internalNote: text('internal_note'),
  invoiceGeneratedAt: text('invoice_generated_at'), // automatische Rechnungs-Generierung (P13)
  invoicePath: text('invoice_path'),                // Pfad zur automatisch generierten PDF
  aliexpressOrderId: text('aliexpress_order_id'),   // manuell eingetragene Lieferanten-Bestellnummer
  aliexpressInvoiceUrl: text('aliexpress_invoice_url'), // hochgeladene AliExpress-Rechnung (PDF/Bild)
  manualBuyPrice: real('manual_buy_price'),         // tatsaechlicher Einkaufspreis laut Rechnung (manuell, hat Vorrang vor DB-Wert)
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
});

export type OrderNote = typeof orderNotes.$inferSelect;
export type NewOrderNote = typeof orderNotes.$inferInsert;

