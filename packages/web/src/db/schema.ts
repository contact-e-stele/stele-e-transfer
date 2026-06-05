import { sql } from 'drizzle-orm';
import { text, integer, real, sqliteTable } from 'drizzle-orm/sqlite-core';

// ─── Produkte (aus AliExpress gescrapt) ──────────────────────────────────────
export const products = sqliteTable('products', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  asin: text('asin').notNull().unique(),       // intern: ali_<timestamp>
  sourceUrl: text('source_url'),               // AliExpress URL
  amazonUrl: text('amazon_url').notNull(),     // legacy (= sourceUrl)
  title: text('title').notNull(),              // Original-Titel
  generatedTitle: text('generated_title').notNull(),
  htmlDescription: text('html_description').notNull(),
  bullets: text('bullets').notNull(),          // JSON array
  variants: text('variants').notNull(),        // JSON array
  description: text('description'),
  images: text('images'),                      // JSON array von Bild-URLs
  // Preise
  buyPrice: real('buy_price'),                 // Einkaufspreis (AliExpress, €)
  sellPrice: real('sell_price'),               // Verkaufspreis (eBay, €)
  lastPriceCheck: text('last_price_check'),    // ISO datetime
  priceChanged: integer('price_changed', { mode: 'boolean' }).default(false),
  // eBay
  ebayListingId: text('ebay_listing_id'),
  ebayStatus: text('ebay_status').default('none'), // none | listed | error
  ebayError: text('ebay_error'),
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
