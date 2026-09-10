// Preis-Fundament Teil 2C (2026-09-10) — Pflichtbestandteil #5/#6, hier als Live-Variante:
// zeigt für JEDES live gelistete Produkt mit bekanntem EK, wie der NEUE Verkaufspreis (Teil 2C:
// kein Sicherheitspuffer, 'nearest95'-Rundung, product.targetMarginEur statt globalem Default)
// aussähe und welcher tatsächliche Gewinn nach allen Abzügen dabei herauskäme — inkl. Abweichung
// zum gewählten Zielgewinn in Cent. NUR LESEND, KEIN Preis wird geschrieben oder an eBay gesendet
// (identisches Sicherheitsprinzip wie scripts/export-pricing-comparison.ts aus Teil 2B).
//
// Voraussetzung: muss dort laufen, wo TURSO_DATABASE_URL/TURSO_AUTH_TOKEN gesetzt sind (z.B.
// Render-Shell).
//
// Aufruf (aus packages/web/): bun run scripts/export-target-margin-audit.ts > zielgewinn-audit.csv

import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { computeMinSellPrice, isChinaShipping, DEFAULT_PRICING_CONFIG } from '../src/shared/pricing';

console.error('Lade alle live gelisteten Produkte mit bekanntem Einkaufspreis…');
const listedProducts = await db.select().from(schema.products).where(eq(schema.products.ebayStatus, 'listed'));
console.error(`${listedProducts.length} Produkte gefunden. Berechne Zielgewinn-Audit…\n`);

const rows: string[] = ['SKU,EK,Zielgewinn,neuer_VK,tatsaechlicher_Gewinn,Abweichung_Cent'];
let skipped = 0;
let maxAbsDeviationCent = 0;

for (const p of listedProducts) {
  if (p.buyPrice == null || p.buyPrice <= 0) { skipped++; continue; }
  const targetMarginEur = p.targetMarginEur ?? DEFAULT_PRICING_CONFIG.targetMarginEur;
  const adRate = p.adRate ?? DEFAULT_PRICING_CONFIG.defaultAdRatePercent;
  const versand = p.shippingCost ?? 0;
  const isChina = isChinaShipping(p.shipsFrom);

  const result = computeMinSellPrice({
    buyPrice: p.buyPrice, supplierShipping: versand,
    isChinaOrigin: isChina, customsFlat: DEFAULT_PRICING_CONFIG.chinaCustomsFlatEur,
    ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent, ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur,
    vatFactor: DEFAULT_PRICING_CONFIG.vatFactor, adRatePercent: adRate,
    targetMarginEur, safetyBufferEur: DEFAULT_PRICING_CONFIG.safetyBufferEur,
    rounding: 'nearest95',
  });
  const newSellPrice = result.minSellPrice;
  const customs = isChina ? DEFAULT_PRICING_CONFIG.chinaCustomsFlatEur : 0;
  const fee = newSellPrice * result.totalFeeRateGross + result.fixedFeeGross;
  const actualProfit = newSellPrice - p.buyPrice - versand - customs - fee;
  const deviationCent = Math.round((actualProfit - targetMarginEur) * 100);
  maxAbsDeviationCent = Math.max(maxAbsDeviationCent, Math.abs(deviationCent));

  rows.push(`stele-${p.id},${p.buyPrice.toFixed(2)},${targetMarginEur.toFixed(2)},${newSellPrice.toFixed(2)},${actualProfit.toFixed(2)},${deviationCent >= 0 ? '+' : ''}${deviationCent}`);
}

console.log(rows.join('\n'));
console.error(`\nFertig — ${rows.length - 1} Produkte, ${skipped} übersprungen (kein EK gespeichert).`);
console.error(`Größte absolute Abweichung: ${maxAbsDeviationCent} Cent. Laut Auftrag zulässig: nur aus ,95-Rundung, max. ~40 Cent — jede größere Abweichung ist ein Fehler und muss erklärt werden.`);
