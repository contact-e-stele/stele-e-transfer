import { sql } from 'drizzle-orm';
import { text, integer, sqliteTable } from 'drizzle-orm/sqlite-core';

export const products = sqliteTable('products', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  asin: text('asin').notNull().unique(),
  amazonUrl: text('amazon_url').notNull(),
  title: text('title').notNull(),
  generatedTitle: text('generated_title').notNull(),
  htmlDescription: text('html_description').notNull(),
  bullets: text('bullets').notNull(), // JSON array
  variants: text('variants').notNull(), // JSON array
  description: text('description'),
  ebayListingId: text('ebay_listing_id'),
  ebayStatus: text('ebay_status').default('none'), // none | listed | error
  ebayError: text('ebay_error'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
});

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
