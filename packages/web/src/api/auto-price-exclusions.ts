// OFFEN 010: Ausnahmeliste "Preisprüfung ändert bei eBay nichts" je Produkt — app_settings 'auto_price_excluded' (KEINE Migration).
// Schreibt nur diesen Schlüssel, kein eBay-Aufruf. Aufheben nur auf Freigabe des Inhabers (z. B. "119 frei").
import { eq } from 'drizzle-orm';
import { AUTO_PRICE_EXCLUDED_KEY, parseAutoPriceExclusions, type AutoPriceExclusions } from '../shared/price-jump';

export async function getAutoPriceExclusions(): Promise<AutoPriceExclusions> {
  const { db } = await import('../db/index');
  const { appSettings } = await import('../db/schema');
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, AUTO_PRICE_EXCLUDED_KEY));
  return parseAutoPriceExclusions(row?.value);
}

export async function setAutoPriceExclusion(productId: number, excluded: boolean, note: string | null): Promise<AutoPriceExclusions> {
  const { db } = await import('../db/index');
  const { appSettings } = await import('../db/schema');
  const all = await getAutoPriceExclusions();
  if (excluded) all[String(productId)] = { at: new Date().toISOString(), note }; else delete all[String(productId)];
  const value = JSON.stringify(all);
  const now = new Date().toISOString();
  await db.insert(appSettings).values({ key: AUTO_PRICE_EXCLUDED_KEY, value, updatedAt: now })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: now } });
  return all;
}
