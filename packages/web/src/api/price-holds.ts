// K-008: Speicher für "Preis halten" — app_settings (Key-Value, KEINE Migration): Schlüssel 'price_holds' (JSON je Produkt/Variante)
// und 'price_hold_notices' (Hinweise an den Inhaber, wenn das Sicherheitsnetz ein Halten aufhebt, die letzten 50).
// Schreibt NUR diese zwei Schlüssel — kein eBay-Aufruf, keine Preisänderung. Regeln: shared/price-hold.ts.
import { eq } from 'drizzle-orm';
import {
  PRICE_HOLDS_SETTING_KEY, PRICE_HOLD_NOTICES_SETTING_KEY, parsePriceHolds, parsePriceHoldNotices, releaseNoticeText,
  type PriceHold, type PriceHolds, type PriceHoldNotice, type HoldRow,
} from '../shared/price-hold';

const MAX_NOTICES = 50;

async function readKey(key: string): Promise<string | null> {
  const { db } = await import('../db/index');
  const { appSettings } = await import('../db/schema');
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key));
  return row?.value ?? null;
}
async function writeKey(key: string, value: string): Promise<void> {
  const { db } = await import('../db/index');
  const { appSettings } = await import('../db/schema');
  const now = new Date().toISOString();
  await db.insert(appSettings).values({ key, value, updatedAt: now }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: now } });
}

export async function getPriceHolds(): Promise<PriceHolds> { return parsePriceHolds(await readKey(PRICE_HOLDS_SETTING_KEY)); }
export async function getPriceHoldNotices(): Promise<PriceHoldNotice[]> { return parsePriceHoldNotices(await readKey(PRICE_HOLD_NOTICES_SETTING_KEY)); }

/** Halten setzen (hold) oder aufheben (null) — nur dieses Feld. */
export async function setPriceHold(productId: number, key: string, hold: PriceHold | null): Promise<PriceHolds> {
  const all = await getPriceHolds();
  const pid = String(productId);
  const cur = { ...(all[pid] ?? {}) };
  if (hold) cur[key] = hold; else delete cur[key];
  if (Object.keys(cur).length > 0) all[pid] = cur; else delete all[pid];
  await writeKey(PRICE_HOLDS_SETTING_KEY, JSON.stringify(all));
  return all;
}

/** Sicherheitsnetz: Halten der Zeilen aufheben + Hinweis an den Inhaber (App + Render-Log). Darf die Preisprüfung nie abbrechen. */
export async function releasePriceHolds(productId: number, rows: HoldRow[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    const all = await getPriceHolds();
    const pid = String(productId);
    const cur = { ...(all[pid] ?? {}) };
    for (const r of rows) delete cur[r.key];
    if (Object.keys(cur).length > 0) all[pid] = cur; else delete all[pid];
    await writeKey(PRICE_HOLDS_SETTING_KEY, JSON.stringify(all));
    const now = new Date().toISOString();
    const notices = await getPriceHoldNotices();
    for (const r of rows) {
      const text = releaseNoticeText(productId, r);
      console.warn(`[K-008] ⚠️ ${text}`);
      notices.unshift({ productId, key: r.key, label: r.label, heldPrice: r.heldPrice, profit: r.profit ?? 0, at: now, text });
    }
    await writeKey(PRICE_HOLD_NOTICES_SETTING_KEY, JSON.stringify(notices.slice(0, MAX_NOTICES)));
  } catch (e) {
    console.warn(`[K-008] stele-${productId}: Halten aufheben fehlgeschlagen (Preisprüfung läuft weiter):`, e);
  }
}
