// Preis-Fundament Teil 4/5 (2026-09-13) — Pflichtbestandteil #6: Tabelle für ALLE aktuell live
// gelisteten Produkte mit SKU, aktuellem Preis, berechnetem Mindestpreis und der Aktion, die die
// jetzt scharfgeschaltete Automatik (price-monitor.ts checkOne(), index.ts check-all-prices)
// ausführen würde: "anheben" oder "nichts tun" — NIE "senken".
//
// NUR LESEND — kein Preis wird geschrieben, kein eBay-Schreib-Call ausgelöst. eBay-Zugriff
// beschränkt sich auf getAllSellerListings() (GET), damit "aktueller Preis" den ECHTEN Live-Preis
// zeigt statt des ggf. veralteten gespeicherten product.sellPrice — Fallback auf product.sellPrice,
// falls der eBay-Call ausfällt (Muster von export-decrease-cap-audit.ts, Teil 2D).
//
// Varianten-Produkte werden gesondert ausgewiesen: sie erhalten (unverändert seit vor Teil 4/5,
// s. price-monitor.ts checkOne()) NIE automatisch einen an eBay gepushten Verkaufspreis — die
// Preisänderung läuft dort ausschließlich über die manuell bestätigte Vorschau
// (recalculate-preview/-apply). Für sie zeigt die Tabelle "n/a (Varianten, nie automatisch)".
//
// Aufruf (aus packages/web/): bun --env-file=<repo>/.env scripts/export-raise-only-audit.ts

import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { computeMinSellPrice, applyRaiseOnly, isChinaShipping, DEFAULT_PRICING_CONFIG } from '../src/shared/pricing';
import { getAllSellerListings } from '../src/api/ebay';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';

console.error('Lade alle live gelisteten Produkte…');
const listedProducts = await db.select().from(schema.products).where(eq(schema.products.ebayStatus, 'listed'));
console.error(`${listedProducts.length} Produkte in der DB als "listed" markiert.`);

let livePriceByListingId = new Map<string, number>();
try {
  const listings = await getAllSellerListings();
  livePriceByListingId = new Map(listings.map(l => [l.itemId, l.currentPrice]));
  console.error(`${livePriceByListingId.size} Live-Preise von eBay geladen.`);
} catch (e) {
  console.error(`eBay-Abruf fehlgeschlagen (${String(e)}) — es wird durchgehend der gespeicherte sellPrice verwendet.`);
}

const lines: string[] = ['SKU,Titel,aktueller_Preis,Preisquelle,berechneter_Mindestpreis,Aktion,wasBelowBreakEven'];
let skipped = 0;
let raiseCount = 0;
let noneCount = 0;
let variantCount = 0;

for (const p of listedProducts) {
  let variantGroupCount = 0;
  try { variantGroupCount = p.variants ? (JSON.parse(p.variants) as unknown[]).length : 0; } catch { /* ignore */ }
  let variantEntryCount = 0;
  try { variantEntryCount = p.variantPrices ? (JSON.parse(p.variantPrices) as unknown[]).length : 0; } catch { /* ignore */ }
  const hasVariants = variantGroupCount > 0 || variantEntryCount > 1;

  const livePrice = p.ebayListingId ? livePriceByListingId.get(p.ebayListingId) : undefined;
  const currentPrice = livePrice ?? p.sellPrice ?? null;
  const priceSource = livePrice != null ? 'eBay-live' : (p.sellPrice != null ? 'DB-sellPrice' : 'keiner');

  if (hasVariants) {
    variantCount++;
    lines.push([`stele-${p.id}`, (p.generatedTitle ?? p.title ?? '').replace(/,/g, ';').slice(0, 60), currentPrice?.toFixed(2) ?? '–', priceSource, '–', 'n/a (Varianten, nie automatisch)', ''].join(','));
    continue;
  }

  if (p.buyPrice == null || p.buyPrice <= 0 || currentPrice == null) { skipped++; continue; }

  const computedMinPrice = computeMinSellPrice({
    buyPrice: p.buyPrice, supplierShipping: p.shippingCost ?? 0,
    isChinaOrigin: isChinaShipping(p.shipsFrom), customsFlat: DEFAULT_PRICING_CONFIG.chinaCustomsFlatEur,
    ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent, ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur,
    vatFactor: DEFAULT_PRICING_CONFIG.vatFactor, adRatePercent: p.adRate ?? DEFAULT_PRICING_CONFIG.defaultAdRatePercent,
    targetMarginEur: p.targetMarginEur ?? DEFAULT_PRICING_CONFIG.targetMarginEur,
    safetyBufferEur: DEFAULT_PRICING_CONFIG.safetyBufferEur,
    rounding: 'nearest95',
  }).minSellPrice;

  const decision = applyRaiseOnly(currentPrice, computedMinPrice);
  if (decision.action === 'raise') raiseCount++; else noneCount++;

  lines.push([
    `stele-${p.id}`,
    (p.generatedTitle ?? p.title ?? '').replace(/,/g, ';').slice(0, 60),
    currentPrice.toFixed(2),
    priceSource,
    computedMinPrice.toFixed(2),
    decision.action === 'raise' ? 'anheben' : 'nichts tun',
    decision.wasBelowBreakEven ? 'ja' : 'nein',
  ].join(','));
}

const csv = lines.join('\n');
console.log(csv);

const outDir = resolve(import.meta.dir, 'output');
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, 'raise-only-audit.csv');
writeFileSync(outPath, csv, 'utf-8');

console.error(`\nFertig — ${lines.length - 1} Zeilen. anheben: ${raiseCount}, nichts tun: ${noneCount}, Varianten (n/a): ${variantCount}, übersprungen (kein EK/kein Preis): ${skipped}.`);
console.error(`Datei geschrieben: ${outPath}`);
console.error('Es wurde NICHTS geschrieben und KEIN eBay-Preis-Call ausgelöst (nur GET getAllSellerListings).');
