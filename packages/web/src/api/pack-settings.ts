// OFFEN 007: Packmenge von EINZELARTIKELN (ohne variantPrices) in app_settings "pack_qty_single" ({ productId: N }) — KEINE Migration.
// Bei Varianten steht die Packmenge im variantPrices-Eintrag selbst (shared/pack-qty.ts).
import { eq } from 'drizzle-orm';
import { normalizePackQty } from '../shared/pack-qty';

const KEY = 'pack_qty_single';

export async function getSinglePackQtys(): Promise<Record<string, number>> {
  try {
    const { db } = await import('../db/index');
    const { appSettings } = await import('../db/schema');
    const row = await db.select().from(appSettings).where(eq(appSettings.key, KEY)).get();
    const m = row?.value ? JSON.parse(row.value) as Record<string, unknown> : {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(m)) { const n = normalizePackQty(v); if (n > 1) out[k] = n; }
    return out;
  } catch { return {}; }
}

export async function setSinglePackQty(productId: number, n: unknown): Promise<void> {
  const q = normalizePackQty(n);
  const all = await getSinglePackQtys();
  if (q > 1) all[String(productId)] = q; else delete all[String(productId)];
  const { db } = await import('../db/index');
  const { appSettings } = await import('../db/schema');
  const now = new Date().toISOString();
  const value = JSON.stringify(all);
  await db.insert(appSettings).values({ key: KEY, value, updatedAt: now }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: now } });
}
