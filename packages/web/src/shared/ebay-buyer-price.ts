// K-011 (Kalkulator 15.10.2026): eBay hat für ein Angebot ZWEI Preise — den Käuferpreis (was auf der Angebotsseite steht, Trading
// GetItem → Variations/Variation/StartPrice bzw. Item/StartPrice) und die Angebotsdaten der Inventory-API (offer.pricingSummary).
// Wird ein Preis im Seller Hub geändert, ändert sich nur der Käuferpreis (Handbuch H-080). Live-Fund stele-220: Käufer 19,95/21,95/20,95,
// Angebotsdaten 20,95/22,95/21,95. Wahrheit ist der KÄUFERPREIS. Solange beide abweichen, sendet die App keine Preise (Sperre).
// REINE Funktionen (Grundgesetz 2).

export const PRICE_LOCKS_SETTING_KEY = 'ebay_price_locks';
export const PRICE_MISMATCH_TOLERANCE_EUR = 0.01;

export interface BuyerVariationPrice { sku: string; price: number; quantity: number | null; quantitySold: number | null }

const tag = (xml: string, name: string): string | null => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`));
  return m ? m[1].trim() : null;
};
const num = (s: string | null): number | null => { if (s == null || s === '') return null; const n = parseFloat(s); return Number.isFinite(n) ? n : null; };

/** Käuferpreise aus GetItem-XML: je <Variation> SKU + StartPrice; ohne Varianten der Item-StartPrice (sku = Item-SKU oder ''). */
export function parseGetItemBuyerPrices(xml: string): { ack: string | null; isVariation: boolean; rows: BuyerVariationPrice[]; error?: string } {
  const ack = tag(xml, 'Ack');
  if (ack === 'Failure') return { ack, isVariation: false, rows: [], error: tag(xml, 'LongMessage') ?? 'GetItem fehlgeschlagen' };
  const rows: BuyerVariationPrice[] = [];
  for (const m of xml.matchAll(/<Variation>([\s\S]*?)<\/Variation>/g)) {
    const block = m[1];
    const sku = tag(block, 'SKU');
    const price = num(tag(block, 'StartPrice'));
    if (!sku || price == null) continue;
    const sold = block.match(/<SellingStatus>[\s\S]*?<QuantitySold>(\d+)<\/QuantitySold>/)?.[1];
    rows.push({ sku, price, quantity: num(tag(block, 'Quantity')), quantitySold: sold != null ? Number(sold) : null });
  }
  if (rows.length > 0) return { ack, isVariation: true, rows };
  const itemBlock = xml.replace(/<Variations>[\s\S]*<\/Variations>/, '');
  const price = num(tag(itemBlock, 'StartPrice'));
  if (price == null) return { ack, isVariation: false, rows: [], error: 'Kein StartPrice im GetItem' };
  return { ack, isVariation: false, rows: [{ sku: tag(itemBlock, 'SKU') ?? '', price, quantity: num(tag(itemBlock, 'Quantity')), quantitySold: null }] };
}

export interface PriceCompareRow { skuId: string | null; sku: string; label: string; buyerPrice: number | null; offerPrice: number | null; appPrice: number | null; error?: string }

/** Abweichung Käuferpreis ↔ Angebotsdaten (> 0,01 €). Fehlt einer der beiden Preise, zählt das NICHT als Abweichung (unbekannt ≠ falsch). */
export function priceMismatches(rows: PriceCompareRow[]): PriceCompareRow[] {
  return rows.filter(r => r.buyerPrice != null && r.offerPrice != null && Math.abs(r.buyerPrice - r.offerPrice) > PRICE_MISMATCH_TOLERANCE_EUR + 1e-9);
}

export interface PriceLock { at: string; rows: Array<{ sku: string; label: string; buyerPrice: number; offerPrice: number }> }
export type PriceLocks = Record<string, PriceLock>;

export function parsePriceLocks(json: string | null | undefined): PriceLocks {
  if (!json) return {};
  try { const o = JSON.parse(json) as unknown; return o && typeof o === 'object' && !Array.isArray(o) ? o as PriceLocks : {}; } catch { return {}; }
}

/** Produkt-ID aus einer App-SKU ("stele-220", "stele-220-GRAY", "stele-220-GROUP"). */
export function productIdFromSku(sku: string): number | null {
  const m = sku.match(/^stele-(\d+)(?:-|$)/);
  return m ? Number(m[1]) : null;
}
