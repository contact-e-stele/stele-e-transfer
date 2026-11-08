// Fix 251 (08.11.2026): der Preislauf brach still ab, wenn AliExpress keinen Ab-Preis (data.price) lieferte —
// auch bei Varianten-Produkten, deren Varianten-Preise vorhanden waren. Dann liefen weder Mengen-Sync noch
// Preisalarm noch Anhebung (stele-251: lastPriceCheck blieb stehen, Gewinn −0,95 je Verkauf).
// Reine Funktion: welcher Ab-Preis gilt, und warum keiner.

export interface AbPriceVariant { price?: number | null }

export type AbPriceResult =
  | { ok: true; price: number; source: 'data.price' | 'min(variantPrices)' }
  | { ok: false; reason: string };

/** parsedDataPrice = geparster data.price (0/NaN = fehlt). Varianten-Produkt ohne Ab-Preis → kleinster gültiger Varianten-Preis. */
export function resolveAbPrice(parsedDataPrice: number | null | undefined, isVariant: boolean, variantPrices: AbPriceVariant[] | null | undefined): AbPriceResult {
  if (typeof parsedDataPrice === 'number' && Number.isFinite(parsedDataPrice) && parsedDataPrice > 0) {
    return { ok: true, price: parsedDataPrice, source: 'data.price' };
  }
  if (!isVariant) return { ok: false, reason: 'kein Ab-Preis in den AliExpress-Daten (Einzelartikel)' };
  const prices = (variantPrices ?? [])
    .map(v => (typeof v?.price === 'number' ? v.price : NaN))
    .filter(p => Number.isFinite(p) && p > 0);
  if (prices.length === 0) return { ok: false, reason: 'weder Ab-Preis noch Varianten-Preise in den AliExpress-Daten' };
  return { ok: true, price: Math.min(...prices), source: 'min(variantPrices)' };
}
