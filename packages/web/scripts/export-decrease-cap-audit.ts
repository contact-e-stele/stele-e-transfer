// Preis-Fundament Teil 2D (2026-09-10) — Pflichtbestandteil #5: Tabelle für ALLE aktuell live
// gelisteten Produkte mit SKU, aktuellem eBay-Preis, berechnetem Mindestpreis, Preis nach Deckel
// und gedeckelt ja/nein.
//
// NUR LESEND — kein Preis wird geschrieben, kein eBay-Schreib-Call ausgelöst. Der eBay-Zugriff
// beschränkt sich auf getAllSellerListings() (GET, holt die aktuell live stehenden Preise), damit
// die Spalte "aktueller eBay-Preis" den ECHTEN Live-Preis zeigt und nicht den ggf. veralteten
// gespeicherten product.sellPrice. Fällt der eBay-Call aus, wird product.sellPrice als Rückfall
// genutzt und die Zeile entsprechend markiert.
//
// Voraussetzung: muss dort laufen, wo die echten Produktions-Env-Vars gesetzt sind
// (TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, eBay-OAuth) — z.B. über die Render-Shell des App-Diensts.
//
// Aufruf (aus packages/web/): bun run scripts/export-decrease-cap-audit.ts > senkungsbremse.csv

import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { computeMinSellPrice, applyDecreaseCap, isChinaShipping, DEFAULT_PRICING_CONFIG } from '../src/shared/pricing';
import { MAX_PRICE_DECREASE_PERCENT } from '../src/shared/constants';
import { getAllSellerListings } from '../src/api/ebay';

console.error('Lade alle live gelisteten Produkte…');
const listedProducts = await db.select().from(schema.products).where(eq(schema.products.ebayStatus, 'listed'));
console.error(`${listedProducts.length} Produkte in der DB als "listed" markiert.`);

// Live-Preise von eBay holen (nur lesend) — Fallback auf den gespeicherten sellPrice.
let livePriceByListingId = new Map<string, number>();
try {
  const listings = await getAllSellerListings();
  livePriceByListingId = new Map(listings.map(l => [l.itemId, l.currentPrice]));
  console.error(`${livePriceByListingId.size} Live-Preise von eBay geladen.`);
} catch (e) {
  console.error(`eBay-Abruf fehlgeschlagen (${String(e)}) — es wird durchgehend der gespeicherte sellPrice verwendet.`);
}

const rows: string[] = ['SKU,aktueller_eBay_Preis,berechneter_Mindestpreis,Preis_nach_Deckel,gedeckelt,Absenkung_Prozent,Preisquelle'];
let skipped = 0;
let cappedCount = 0;
let maxDecreasePercentSeen = 0;

for (const p of listedProducts) {
  if (p.buyPrice == null || p.buyPrice <= 0) { skipped++; continue; }

  const livePrice = p.ebayListingId ? livePriceByListingId.get(p.ebayListingId) : undefined;
  const currentPrice = livePrice ?? p.sellPrice ?? null;
  const priceSource = livePrice != null ? 'eBay-live' : (p.sellPrice != null ? 'DB-sellPrice' : 'keiner');
  if (currentPrice == null) { skipped++; continue; }

  const computedMinPrice = computeMinSellPrice({
    buyPrice: p.buyPrice, supplierShipping: p.shippingCost ?? 0,
    isChinaOrigin: isChinaShipping(p.shipsFrom), customsFlat: DEFAULT_PRICING_CONFIG.chinaCustomsFlatEur,
    ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent, ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur,
    vatFactor: DEFAULT_PRICING_CONFIG.vatFactor, adRatePercent: p.adRate ?? DEFAULT_PRICING_CONFIG.defaultAdRatePercent,
    targetMarginEur: p.targetMarginEur ?? DEFAULT_PRICING_CONFIG.targetMarginEur,
    safetyBufferEur: DEFAULT_PRICING_CONFIG.safetyBufferEur,
    rounding: 'nearest95',
  }).minSellPrice;

  const { price: finalPrice, wasCapped } = applyDecreaseCap(currentPrice, computedMinPrice, MAX_PRICE_DECREASE_PERCENT);
  const decreasePercent = finalPrice < currentPrice ? ((currentPrice - finalPrice) / currentPrice) * 100 : 0;
  if (wasCapped) cappedCount++;
  maxDecreasePercentSeen = Math.max(maxDecreasePercentSeen, decreasePercent);

  rows.push([
    `stele-${p.id}`,
    currentPrice.toFixed(2),
    computedMinPrice.toFixed(2),
    finalPrice.toFixed(2),
    wasCapped ? 'ja' : 'nein',
    decreasePercent.toFixed(2),
    priceSource,
  ].join(','));
}

console.log(rows.join('\n'));
console.error(`\nFertig — ${rows.length - 1} Produkte in der Tabelle, ${skipped} übersprungen (kein EK oder kein aktueller Preis).`);
console.error(`Gedeckelt: ${cappedCount} Produkte. Größte Absenkung in einem Lauf: ${maxDecreasePercentSeen.toFixed(2)}%.`);
console.error(maxDecreasePercentSeen > MAX_PRICE_DECREASE_PERCENT + 0.001
  ? `⚠️ FEHLER: Die Senkungsbremse (${MAX_PRICE_DECREASE_PERCENT}%) wurde überschritten — das darf laut Auftrag nicht vorkommen und muss untersucht werden.`
  : `✓ Kein Produkt fällt in einem Lauf um mehr als ${MAX_PRICE_DECREASE_PERCENT}%.`);
