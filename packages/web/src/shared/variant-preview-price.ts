// AUFSICHT 21.11.2026 14:10: Vorschau-Preis je Variante = gesendeter VK (variantSellPrices) vor altem Import-Vorschlag (ebayPrice)
// vor AliExpress-Preis. Rein (Grundgesetz 2).
export function variantPreviewPrice(sent: unknown, ebayPrice: unknown, aliPrice: unknown): number {
  for (const x of [sent, ebayPrice, aliPrice]) if (typeof x === 'number' && Number.isFinite(x) && x > 0) return x;
  return 0;
}
