// K-011: Preis-Sperre je Produkt in app_settings 'ebay_price_locks' (KEINE Migration). Gesetzt, solange eBay-Käuferpreis und
// Inventory-Angebotsdaten voneinander abweichen; aufgehoben nach dem Angleichen (beide gleich). Während der Sperre sendet die App für das
// Produkt KEINE Preise an eBay (updateOfferPriceBySku / Trading-Fallbacks prüfen isProductPriceLocked).
import { eq } from 'drizzle-orm';
import { PRICE_LOCKS_SETTING_KEY, parsePriceLocks, type PriceLock, type PriceLocks } from '../shared/ebay-buyer-price';

export async function getPriceLocks(): Promise<PriceLocks> {
  const { db } = await import('../db/index');
  const { appSettings } = await import('../db/schema');
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, PRICE_LOCKS_SETTING_KEY));
  return parsePriceLocks(row?.value);
}

export async function setPriceLock(productId: number, lock: PriceLock | null): Promise<void> {
  const { db } = await import('../db/index');
  const { appSettings } = await import('../db/schema');
  const all = await getPriceLocks();
  if (lock) all[String(productId)] = lock; else delete all[String(productId)];
  const value = JSON.stringify(all);
  const now = new Date().toISOString();
  await db.insert(appSettings).values({ key: PRICE_LOCKS_SETTING_KEY, value, updatedAt: now })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: now } });
}

/** true = gesperrt. Ist der Speicher nicht lesbar, wird NICHT gesperrt (Verhalten wie vor K-011) — mit Warnung im Log. */
export async function isProductPriceLocked(productId: number): Promise<boolean> {
  try { return !!(await getPriceLocks())[String(productId)]; }
  catch (e) { console.warn(`[K-011] Sperr-Speicher nicht lesbar (stele-${productId}) — ohne Sperre weiter:`, e); return false; }
}
