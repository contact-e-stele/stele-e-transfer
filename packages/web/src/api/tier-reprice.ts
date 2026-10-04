// A-017: Orchestrierung "Stufenwechsel → neue Preise" für POST /products/tier-reprice. Bewusst OHNE direkte DB-/eBay-Importe: alles
// Schreibende kommt als `deps` herein (index.ts verdrahtet die echten Funktionen), damit die Regel "kein eBay-Aufruf ohne
// ausdrückliches Senden" mit Mocks testbar ist (Grundgesetz Regel 2). Entscheidungslogik: shared/tier-reprice.ts.
import {
  planTierReprice, storePatchForPlan, decideTierRepriceAction,
  type RepriceProduct, type TierPlan, type TierRepriceMode,
} from '../shared/tier-reprice';

export interface TierRepriceProductRow extends RepriceProduct {
  generatedTitle: string;
  variants: string | null;            // JSON VariantGroup[]
  ebayStatus: string;
  ebayListingId: string | null;
}

export interface VariantSendRow {
  skuId: string; attrs: Record<string, string>; buyPrice: number; correctSellPrice: number; displayValues?: Record<string, string>;
}

export interface TierRepriceDeps {
  sendVariants: (productId: number, groups: Array<{ name: string; values: string[] }>, rows: VariantSendRow[]) => Promise<{ ok: boolean; updatedCount: number; errors: string[] }>;
  sendSingle: (productId: number, listingId: string, price: number) => Promise<{ ok: boolean; error?: string }>;
  store: (productId: number, patch: { targetMarginEur: number; variantSellPrices?: string; sellPrice?: number }) => Promise<void>;
}

export type TierRepriceStatus = 'preview' | 'stored' | 'sent' | 'send_failed' | 'rejected' | 'not_found';

export interface TierRepriceResult {
  productId: number;
  title: string;
  isLive: boolean;
  status: TierRepriceStatus;
  plan?: TierPlan;
  error?: string;
  sentCount?: number;
  stored?: { targetMarginEur: number; variantSellPrices?: string; sellPrice?: number };
}

export const isLiveListed = (p: Pick<TierRepriceProductRow, 'ebayStatus' | 'ebayListingId'>): boolean => p.ebayStatus === 'listed' && !!p.ebayListingId;

function parseGroups(json: string | null): Array<{ name: string; values: string[] }> {
  try { const g = json ? JSON.parse(json) : []; return Array.isArray(g) ? g : []; } catch { return []; }
}

export async function runTierReprice(
  products: Map<number, TierRepriceProductRow>,
  input: { productIds: number[]; targetMarginEur: number; mode: TierRepriceMode; confirm: boolean; sendToEbay: boolean },
  deps: TierRepriceDeps,
): Promise<TierRepriceResult[]> {
  const results: TierRepriceResult[] = [];
  for (const id of input.productIds) {
    const row = products.get(id);
    if (!row) { results.push({ productId: id, title: '', isLive: false, status: 'not_found', error: 'Produkt nicht gefunden' }); continue; }
    const isLive = isLiveListed(row);
    const base = { productId: id, title: row.generatedTitle, isLive };
    const plan = planTierReprice(row, input.targetMarginEur);
    const decision = decideTierRepriceAction({ mode: input.mode, confirm: input.confirm, sendToEbay: input.sendToEbay, isLive });

    if (decision.action === 'preview') { results.push({ ...base, status: 'preview', plan }); continue; }
    if (decision.action === 'rejected') { results.push({ ...base, status: 'rejected', plan, error: decision.error }); continue; }

    const patch = storePatchForPlan(row, plan);
    const stored = { targetMarginEur: input.targetMarginEur, ...patch };

    if (decision.action === 'store_only') {
      await deps.store(id, stored);
      results.push({ ...base, status: 'stored', plan, stored });
      continue;
    }

    // store_and_send: live gelistet, ausdrücklich bestätigt. Keine Preisänderung → nur das Ziel speichern, eBay bleibt unberührt.
    if (plan.rows.length === 0 || plan.changedCount === 0) {
      await deps.store(id, { targetMarginEur: input.targetMarginEur });
      results.push({ ...base, status: 'stored', plan, stored: { targetMarginEur: input.targetMarginEur } });
      continue;
    }
    // Erst an eBay; die App-Preise werden NUR bei vollem Erfolg gespeichert (nie weiter als eBay).
    if (plan.isVariant) {
      const sendRows: VariantSendRow[] = plan.rows.map(r => ({
        skuId: r.skuId ?? '', attrs: r.attrs ?? {}, buyPrice: r.ware, correctSellPrice: r.newSell, displayValues: r.displayValues,
      }));
      const res = await deps.sendVariants(id, parseGroups(row.variants), sendRows);
      if (!res.ok || res.errors.length > 0) {
        results.push({
          ...base, status: 'send_failed', plan, sentCount: res.updatedCount,
          error: `${res.updatedCount} von ${plan.rows.length} Varianten-Preisen an eBay gesetzt${res.errors.length > 0 ? ': ' + res.errors.join(' | ') : ''} — App-Preise NICHT gespeichert, bitte erneut senden.`,
        });
        continue;
      }
      await deps.store(id, stored);
      results.push({ ...base, status: 'sent', plan, sentCount: res.updatedCount, stored });
    } else {
      const res = await deps.sendSingle(id, row.ebayListingId!, plan.rows[0].newSell);
      if (!res.ok) {
        results.push({ ...base, status: 'send_failed', plan, sentCount: 0, error: `Preis konnte nicht an eBay gesendet werden${res.error ? ': ' + res.error : ''} — App-Preis NICHT gespeichert.` });
        continue;
      }
      await deps.store(id, stored);
      results.push({ ...base, status: 'sent', plan, sentCount: 1, stored });
    }
  }
  return results;
}
