// OFFEN 024 NACHTRAG (Inhaber 03.11.2026): Anzeige-Rate 5 % ↔ 0 % im Listings-Tab — Kampagne bei eBay UND Preise je Variante.
// Orchestrierung ohne direkte DB-/eBay-Importe (alles Schreibende kommt als deps herein, Muster api/tier-reprice.ts), damit die
// Reihenfolge-Regeln mit Attrappen testbar sind:
//   5 % → 0 %: ERST Werbung bei eBay entfernen (sonst niedrigerer Preis + Werbekosten = Verlust), DANN Preise senken.
//   0 % → 5 %: ERST Preise anheben, DANN in die Kampagne (sonst Werbekosten auf den alten, niedrigen Preis).
// Danach adRate in der App, App-Preise = eBay (Rücklesen). Ohne confirm nur Vorschau.
import { planAdRateSwitch, type AdSwitchRow } from '../shared/ad-rate-switch';

export interface AdSwitchProduct {
  id: number; title: string; ebayListingId: string; adRate: number | null; targetMarginEur: number | null;
  isChinaOrigin: boolean; checkoutFactor: number | null; isVariant: boolean;
  groups: Array<{ name: string; values: string[] }>;
  rows: Array<{ skuId: string; label: string; attrs: Record<string, string>; displayValues?: Record<string, string>; buyPrice: number; sellPrice: number }>;
}

export interface AdSwitchDeps {
  removeAds: (listingIds: string[]) => Promise<{ ok: boolean; results: Array<{ listingId: string; ok: boolean; error: string | null }> }>;
  addAds: (listingIds: string[], percent: number) => Promise<{ ok: boolean; results: Array<{ listingId: string; ok: boolean; error: string | null }>; error?: string }>;
  sendVariants: (productId: number, groups: AdSwitchProduct['groups'], rows: Array<{ skuId: string; attrs: Record<string, string>; displayValues?: Record<string, string>; buyPrice: number; correctSellPrice: number }>) => Promise<{ ok: boolean; updatedCount: number; errors: string[] }>;
  sendSingle: (productId: number, listingId: string, price: number) => Promise<{ ok: boolean; error?: string }>;
  storeAdRate: (productId: number, rate: number) => Promise<void>;
  readback: (productId: number) => Promise<{ ok: boolean; error?: string }>;
}

export type AdSwitchStatus = 'preview' | 'done' | 'ads_failed' | 'prices_failed' | 'mismatch' | 'unchanged' | 'error';
export interface AdSwitchResult {
  productId: number; listingId: string; title: string; fromRate: number; toRate: number;
  status: AdSwitchStatus; rows: AdSwitchRow[]; error?: string; sentCount?: number;
}

/** expected: skuId → neuer VK aus der Vorschau, die der Inhaber gesehen hat. Weicht die Neuberechnung ab → nichts senden. */
export async function runAdSwitch(
  products: AdSwitchProduct[], input: { toRate: number; confirm: boolean; expected?: Record<string, number> }, deps: AdSwitchDeps,
): Promise<AdSwitchResult[]> {
  const out: AdSwitchResult[] = [];
  for (const p of products) {
    const fromRate = p.adRate ?? 5;
    const rows = planAdRateSwitch({ fromRate, toRate: input.toRate, rows: p.rows, isChinaOrigin: p.isChinaOrigin, checkoutFactor: p.checkoutFactor, targetMarginEur: p.targetMarginEur });
    const base = { productId: p.id, listingId: p.ebayListingId, title: p.title, fromRate, toRate: input.toRate, rows };
    if (!input.confirm) { out.push({ ...base, status: 'preview' }); continue; }
    if (fromRate === input.toRate) { out.push({ ...base, status: 'unchanged', error: `steht schon auf ${input.toRate} %` }); continue; }
    if (input.expected) {
      const bad = rows.filter(r => r.send && input.expected![r.skuId] != null && Math.abs(input.expected![r.skuId] - r.newVk) > 0.004);
      const missing = rows.filter(r => r.send && input.expected![r.skuId] == null);
      if (bad.length > 0 || missing.length > 0) {
        out.push({ ...base, status: 'mismatch', error: `Vorschau veraltet (${[...bad, ...missing].map(r => r.label).join(', ')}) — nichts gesendet, bitte neu prüfen` });
        continue;
      }
    }
    try {
      const sendPrices = async (): Promise<{ ok: boolean; sent: number; error?: string }> => {
        const toSend = rows.filter(r => r.send);
        if (toSend.length === 0) return { ok: true, sent: 0 };
        if (p.isVariant) {
          // Alle Varianten mitschicken (nicht gesetzte mit altem Preis), damit jede eBay-SKU eine Zuordnung hat.
          const vrows = p.rows.map(r => {
            const plan = rows.find(x => x.skuId === r.skuId)!;
            return { skuId: r.skuId, attrs: r.attrs, displayValues: r.displayValues, buyPrice: r.buyPrice, correctSellPrice: plan.send ? plan.newVk : plan.oldVk };
          });
          const res = await deps.sendVariants(p.id, p.groups, vrows);
          return { ok: res.ok && res.errors.length === 0, sent: res.updatedCount, error: res.errors.join(' · ') || undefined };
        }
        const res = await deps.sendSingle(p.id, p.ebayListingId, toSend[0].newVk);
        return { ok: res.ok, sent: res.ok ? 1 : 0, error: res.error };
      };
      const adStep = async (): Promise<string | null> => {
        const r = input.toRate === 0 ? await deps.removeAds([p.ebayListingId]) : await deps.addAds([p.ebayListingId], input.toRate);
        const mine = r.results.find(x => x.listingId === p.ebayListingId);
        return r.ok && mine?.ok !== false ? null : (mine?.error ?? ('error' in r ? (r as { error?: string }).error : null) ?? 'Kampagne nicht geändert');
      };
      let sent = 0;
      if (input.toRate < fromRate) {
        const adErr = await adStep();
        if (adErr) { out.push({ ...base, status: 'ads_failed', error: `Werbung nicht entfernt: ${adErr} — Preise NICHT gesenkt` }); continue; }
        await deps.storeAdRate(p.id, input.toRate);
        const pr = await sendPrices(); sent = pr.sent;
        if (!pr.ok) { await deps.readback(p.id).catch(() => null); out.push({ ...base, status: 'prices_failed', sentCount: sent, error: `Werbung entfernt, Preise nicht vollständig gesetzt: ${pr.error ?? ''}` }); continue; }
      } else {
        const pr = await sendPrices(); sent = pr.sent;
        if (!pr.ok) { await deps.readback(p.id).catch(() => null); out.push({ ...base, status: 'prices_failed', sentCount: sent, error: `Preise nicht vollständig gesetzt: ${pr.error ?? ''} — Werbung NICHT eingeschaltet` }); continue; }
        const adErr = await adStep();
        if (adErr) { await deps.readback(p.id).catch(() => null); out.push({ ...base, status: 'ads_failed', sentCount: sent, error: `Preise angehoben, Werbung nicht eingeschaltet: ${adErr}` }); continue; }
        await deps.storeAdRate(p.id, input.toRate);
      }
      const rb = await deps.readback(p.id);
      out.push({ ...base, status: 'done', sentCount: sent, error: rb.ok ? undefined : `App-Preise nicht von eBay übernommen: ${rb.error ?? ''}` });
    } catch (e) {
      out.push({ ...base, status: 'error', error: String(e) });
    }
  }
  return out;
}
