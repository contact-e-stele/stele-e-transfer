// Preis-Fundament Teil 2B (2026-09-10) — Pflichtbestandteil #4: Vorher/Nachher-Tabelle für ALLE
// aktiven Produkte (SKU, EK, aktueller VK, alte Marge, neue Marge, Differenz).
//
// NUR LESEND — keine Preisänderung, kein eBay-API-Call. Rechnet für jedes aktuell live gelistete
// Produkt die Marge auf dem TATSÄCHLICH GESPEICHERTEN VK zweimal: einmal mit den alten
// Gebühren-Annahmen (13% + 0,45€, Stand vor Teil 2B) und einmal mit den real gemessenen Werten
// (15% + 0,30€, DEFAULT_PRICING_CONFIG nach Teil 2B) — zeigt also, wie sich die Margen-EINSCHÄTZUNG
// für bereits live stehende Verkaufspreise durch die Korrektur ändert. KEIN neuer VK wird
// berechnet oder vorgeschlagen — das ist bewusst außerhalb dieses Skripts (reine Kalkulation/
// Anzeige, kein Preis wird geschrieben oder gesendet, siehe Teil-2B-Auftrag).
//
// Voraussetzung: muss dort laufen, wo die echten Produktions-Env-Vars gesetzt sind
// (TURSO_DATABASE_URL, TURSO_AUTH_TOKEN) — z.B. über die Render-Shell des App-Diensts.
//
// Aufruf (aus packages/web/): bun run scripts/export-pricing-comparison.ts
// Schreibt eine CSV nach stdout — zum Speichern: bun run scripts/export-pricing-comparison.ts > vorher-nachher.csv

import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { computeMinSellPrice, DEFAULT_PRICING_CONFIG } from '../src/shared/pricing';

// Stand vor Teil 2B (Teil 2A / P-27/P-28-Konsolidierung 08.09.) — nur für diesen Vergleich hier
// noch einmal als Literal, NICHT mehr im Produktivcode verwendet.
const OLD_CONFIG = { ebayFeeRatePercent: 13, ebayFixedFeeEur: 0.45, vatFactor: 1.19 };

function marginPercentAt(sellPrice: number, buyPrice: number, ebayFeeRatePercent: number, ebayFixedFeeEur: number, vatFactor: number, adRatePercent: number): number {
  const rates = computeMinSellPrice({
    buyPrice: 0, supplierShipping: 0, isChinaOrigin: false, customsFlat: 0,
    ebayFeeRatePercent, ebayFixedFeeEur, vatFactor, adRatePercent,
    targetMarginEur: 0, safetyBufferEur: 0, rounding: 'none',
  });
  const fee = sellPrice * rates.baseFeeRateGross + rates.fixedFeeGross; // adRate bewusst NICHT in baseFeeRateGross enthalten — Marge hier ohne Anzeigengebühr, konsistent mit produkte.tsx PriceBadge
  return ((sellPrice - buyPrice - fee) / sellPrice) * 100;
}

console.error('Lade alle live gelisteten Produkte…');
const listedProducts = await db.select().from(schema.products).where(eq(schema.products.ebayStatus, 'listed'));
console.error(`${listedProducts.length} Produkte gefunden. Berechne Vorher/Nachher-Margen…\n`);

const rows: string[] = ['SKU,EK,aktueller_VK,alte_Marge_Prozent,neue_Marge_Prozent,Differenz_Prozentpunkte'];
let skipped = 0;

for (const p of listedProducts) {
  if (p.buyPrice == null || p.sellPrice == null || p.sellPrice <= 0) { skipped++; continue; }
  const adRate = p.adRate ?? DEFAULT_PRICING_CONFIG.defaultAdRatePercent;
  const oldMargin = marginPercentAt(p.sellPrice, p.buyPrice, OLD_CONFIG.ebayFeeRatePercent, OLD_CONFIG.ebayFixedFeeEur, OLD_CONFIG.vatFactor, adRate);
  const newMargin = marginPercentAt(p.sellPrice, p.buyPrice, DEFAULT_PRICING_CONFIG.ebayFeeRatePercent, DEFAULT_PRICING_CONFIG.ebayFixedFeeEur, DEFAULT_PRICING_CONFIG.vatFactor, adRate);
  const diff = newMargin - oldMargin;
  rows.push(`stele-${p.id},${p.buyPrice.toFixed(2)},${p.sellPrice.toFixed(2)},${oldMargin.toFixed(1)},${newMargin.toFixed(1)},${diff >= 0 ? '+' : ''}${diff.toFixed(1)}`);
}

console.log(rows.join('\n'));
console.error(`\nFertig — ${rows.length - 1} Produkte in der Tabelle, ${skipped} übersprungen (kein EK oder VK gespeichert).`);
