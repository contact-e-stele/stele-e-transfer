// K-018 PR B: automatisch senken am Ende des Tages-Preislaufs. Plan = planAutoLower (reine Funktion, shared/auto-lower.ts).
// Schalter AUTO_LOWER_ENABLED (Standard AUS): bei AUS wird NUR die Vorschau geloggt und in app_settings `auto_lower_last_preview` abgelegt
// (GET /api/reports/auto-lower). Bei AN: je Produkt runVariantReprice (direction down, App → eBay lowerOnly → zurücklesen, Speichern nur bei
// vollem Erfolg) — derselbe Weg wie „Auswahl senken“ (buildVariantRepriceDeps). Fehler brechen den Preislauf nie ab.
import { eq } from 'drizzle-orm';
import { planAutoLower, type AutoLowerInput, type AutoLowerPlan, type AutoLowerProduct } from '../shared/auto-lower';
import { runVariantReprice, type VariantRepriceDeps, type VariantRepriceProductRow } from './variant-reprice';

export const AUTO_LOWER_PREVIEW_KEY = 'auto_lower_last_preview';
export function autoLowerEnabled(env: Record<string, string | undefined> = process.env): boolean { return env.AUTO_LOWER_ENABLED === 'true'; }

export interface AutoLowerRunResult { enabled: boolean; at: string; plan: AutoLowerPlan; gesendet: Array<{ productId: number; status: string; error?: string }> }

export async function runAutoLower(
  input: AutoLowerInput & { products: Array<AutoLowerProduct & VariantRepriceProductRow> },
  deps: { enabled: boolean; depsFor: (p: VariantRepriceProductRow) => VariantRepriceDeps; savePreview: (json: string) => Promise<void>; now?: Date },
): Promise<AutoLowerRunResult> {
  const plan = planAutoLower(input);
  const at = (deps.now ?? new Date()).toISOString();
  const gesendet: AutoLowerRunResult['gesendet'] = [];
  for (const s of plan.senken) for (const r of s.rows) {
    console.log(`[AutoSenken${deps.enabled ? '' : ' Vorschau'}] stele-${r.productId} ${r.label} ${r.alt.toFixed(2)} → ${r.neu.toFixed(2)} Gewinn ${r.gewinnAlt?.toFixed(2)} → ${r.gewinnNeu?.toFixed(2)} (ohne Kassen-Faktor, EK aus diesem Lauf)`);
  }
  for (const n of plan.nichtGesenkt) console.log(`[AutoSenken] stele-${n.productId} ${n.label}: nicht gesenkt — ${n.grund}`);
  if (deps.enabled) {
    for (const s of plan.senken) {
      const product = input.products.find(p => p.id === s.productId)!;
      const row = { ...product, variantPrices: input.freshEk.get(s.productId) ?? product.variantPrices } as VariantRepriceProductRow;
      try {
        const r = await runVariantReprice(row, { productId: s.productId, prices: s.prices, mode: 'apply', confirm: true, sendToEbay: true, direction: 'down' }, deps.depsFor(row));
        gesendet.push({ productId: s.productId, status: r.status, ...(r.error ? { error: r.error } : {}) });
      } catch (e) {
        gesendet.push({ productId: s.productId, status: 'error', error: String(e) });
        console.warn(`[AutoSenken] stele-${s.productId}: Fehler (Lauf geht weiter): ${String(e)}`);
      }
    }
  }
  const result: AutoLowerRunResult = { enabled: deps.enabled, at, plan, gesendet };
  try { await deps.savePreview(JSON.stringify(result)); } catch (e) { console.warn('[AutoSenken] Vorschau nicht gespeichert:', e); }
  return result;
}

/** Produktions-Abhängigkeiten (DB, eBay). */
export async function defaultSavePreview(json: string): Promise<void> {
  const { db } = await import('../db/index');
  const { appSettings } = await import('../db/schema');
  const now = new Date().toISOString();
  await db.insert(appSettings).values({ key: AUTO_LOWER_PREVIEW_KEY, value: json, updatedAt: now })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: json, updatedAt: now } });
}
export async function readAutoLowerPreview(): Promise<AutoLowerRunResult | null> {
  const { db } = await import('../db/index');
  const { appSettings } = await import('../db/schema');
  const row = await db.select().from(appSettings).where(eq(appSettings.key, AUTO_LOWER_PREVIEW_KEY)).get();
  try { return row?.value ? JSON.parse(row.value) : null; } catch { return null; }
}
