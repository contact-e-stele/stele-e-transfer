// A-017: Orchestrierung "Stufenwechsel → neue Preise" für POST /products/tier-reprice. Bewusst OHNE direkte DB-/eBay-Importe: alles
// Schreibende kommt als `deps` herein (index.ts verdrahtet die echten Funktionen), damit die Regel "kein eBay-Aufruf ohne
// ausdrückliches Senden" mit Mocks testbar ist (Grundgesetz Regel 2). Entscheidungslogik: shared/tier-reprice.ts.
import {
  planTierReprice, storePatchForPlan, decideTierRepriceAction, compareExpected,
  type RepriceProduct, type TierPlan, type TierRepriceMode, type ExpectedPrices,
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

// sent_not_stored: an eBay gesendet, aber das Speichern in der App ist fehlgeschlagen (App-Preise jetzt älter als eBay).
export type TierRepriceStatus = 'preview' | 'stored' | 'sent' | 'send_failed' | 'sent_not_stored' | 'error' | 'rejected' | 'not_found';

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
  input: { productIds: number[]; targetMarginEur: number; mode: TierRepriceMode; confirm: boolean; sendToEbay: boolean; expected?: ExpectedPrices },
  deps: TierRepriceDeps,
): Promise<TierRepriceResult[]> {
  const results: TierRepriceResult[] = [];
  for (const id of input.productIds) {
    // Ein Fehler in einem Produkt (Exception in einer Dep) darf weder die Ergebnisse bereits erledigter Produkte verwerfen noch den
    // Rest der Charge abbrechen — je Produkt abfangen und als eigenes Ergebnis melden.
    try {
      results.push(await runOne(products, id, input, deps));
    } catch (e) {
      results.push({ productId: id, title: products.get(id)?.generatedTitle ?? '', isLive: products.has(id) ? isLiveListed(products.get(id)!) : false, status: 'error', error: 'Unerwarteter Fehler: ' + String(e) });
    }
  }
  return results;
}

async function runOne(
  products: Map<number, TierRepriceProductRow>,
  id: number,
  input: { targetMarginEur: number; mode: TierRepriceMode; confirm: boolean; sendToEbay: boolean; expected?: ExpectedPrices },
  deps: TierRepriceDeps,
): Promise<TierRepriceResult> {
  {
    const row = products.get(id);
    if (!row) return { productId: id, title: '', isLive: false, status: 'not_found', error: 'Produkt nicht gefunden' };
    const isLive = isLiveListed(row);
    const base = { productId: id, title: row.generatedTitle, isLive };
    const plan = planTierReprice(row, input.targetMarginEur);
    const decision = decideTierRepriceAction({ mode: input.mode, confirm: input.confirm, sendToEbay: input.sendToEbay, isLive });

    if (decision.action === 'preview') return { ...base, status: 'preview', plan };
    if (decision.action === 'rejected') return { ...base, status: 'rejected', plan, error: decision.error };

    // Gesendet/gespeichert wird nur, was in der Vorschau bestätigt wurde (Plan kann sich per Scrape/Cron zwischenzeitlich ändern).
    const drift = compareExpected(plan, input.expected?.[String(id)]);
    if (drift) return { ...base, status: 'rejected', plan, error: drift };

    const patch = storePatchForPlan(row, plan);
    const stored = { targetMarginEur: input.targetMarginEur, ...patch };

    if (decision.action === 'store_only') {
      await deps.store(id, stored);
      return { ...base, status: 'stored', plan, stored };
    }

    // store_and_send: live gelistet, ausdrücklich bestätigt. Keine Preisänderung → nur das Ziel speichern, eBay bleibt unberührt.
    if (plan.rows.length === 0 || plan.changedCount === 0) {
      await deps.store(id, { targetMarginEur: input.targetMarginEur });
      return { ...base, status: 'stored', plan, stored: { targetMarginEur: input.targetMarginEur } };
    }
    // Erst an eBay; die App-Preise werden NUR bei vollem Erfolg gespeichert (nie weiter als eBay).
    if (plan.isVariant) {
      const sendRows: VariantSendRow[] = plan.rows.map(r => ({
        skuId: r.skuId ?? '', attrs: r.attrs ?? {}, buyPrice: r.ware, correctSellPrice: r.newSell, displayValues: r.displayValues,
      }));
      let res: { ok: boolean; updatedCount: number; errors: string[] };
      try { res = await deps.sendVariants(id, parseGroups(row.variants), sendRows); } catch (e) {
        return { ...base, status: 'send_failed', plan, sentCount: 0, error: 'Senden an eBay fehlgeschlagen: ' + String(e) + ' — App-Preise NICHT gespeichert (eBay-Stand unklar, bitte prüfen).' };
      }
      // VOLLER Erfolg heißt: keine Fehlermeldung UND jede Plan-Zeile wurde tatsächlich an eine reale eBay-Variante gesendet.
      if (!res.ok || res.errors.length > 0 || res.updatedCount !== plan.rows.length) {
        return {
          ...base, status: 'send_failed', plan, sentCount: res.updatedCount,
          error: `${res.updatedCount} von ${plan.rows.length} Varianten-Preisen an eBay gesetzt${res.errors.length > 0 ? ': ' + res.errors.join(' | ') : ' (nicht jede Plan-Variante hat eine passende eBay-SKU)'} — App-Preise NICHT gespeichert. Teilweise gesendete Preise stehen auf eBay: im Produkte-Tab prüfen.`,
        };
      }
      try { await deps.store(id, stored); } catch (e) {
        return { ...base, status: 'sent_not_stored', plan, sentCount: res.updatedCount, error: 'An eBay gesendet, aber App-Preise NICHT gespeichert (' + String(e) + ') — eBay ist neuer als die App, bitte erneut senden.' };
      }
      return { ...base, status: 'sent', plan, sentCount: res.updatedCount, stored };
    } else {
      let res: { ok: boolean; error?: string };
      try { res = await deps.sendSingle(id, row.ebayListingId!, plan.rows[0].newSell); } catch (e) {
        return { ...base, status: 'send_failed', plan, sentCount: 0, error: 'Senden an eBay fehlgeschlagen: ' + String(e) + ' — App-Preis NICHT gespeichert (eBay-Stand unklar, bitte prüfen).' };
      }
      if (!res.ok) {
        return { ...base, status: 'send_failed', plan, sentCount: 0, error: `Preis konnte nicht an eBay gesendet werden${res.error ? ': ' + res.error : ''} — App-Preis NICHT gespeichert.` };
      }
      try { await deps.store(id, stored); } catch (e) {
        return { ...base, status: 'sent_not_stored', plan, sentCount: 1, error: 'An eBay gesendet, aber App-Preis NICHT gespeichert (' + String(e) + ') — eBay ist neuer als die App, bitte erneut senden.' };
      }
      return { ...base, status: 'sent', plan, sentCount: 1, stored };
    }
  }
}
