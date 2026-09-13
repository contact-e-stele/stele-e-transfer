// Reines Leseskript fuer den Preis-Trockenlauf ("Freigabe der automatischen Preisschreibung
// vorbereiten", Aufgabe 1). KEIN DB-Schreibzugriff, KEIN eBay-Call — bewusst NICHT
// recalculate-preview verwendet, weil das intern getAllSellerListings() aufruft, also einen
// echten eBay-Request absetzt. "Heutiger Verkaufspreis" kommt daher aus der lokalen DB-Spalte
// sellPrice, nicht von der eBay-Live-Notierung.
//
// Aufruf (aus packages/web/): TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... bun run scripts/preis-trockenlauf-report.ts
import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import { computeMinSellPrice, profitAtSellPrice, isChinaShipping, DEFAULT_PRICING_CONFIG } from '../src/shared/pricing';
import { computeVariantPriceRows, safeUniformVariantPrice } from '../src/api/price-monitor';

type Row = {
  sku: string; titel: string; typ: 'Einzelartikel' | 'Varianten';
  automatikBetrifft: boolean;
  heutigerVk: number | null; neuerVk: number;
  diffEur: number | null; diffPercent: number | null;
  gewinnHeute: number | null; gewinnNeu: number;
  unterEinstandHeute: boolean;
};

async function main() {
  const all = await db.select().from(schema.products).all();
  const rows: Row[] = [];

  for (const p of all) {
    let variantCount = 0;
    try { variantCount = p.variantPrices ? (JSON.parse(p.variantPrices) as unknown[]).length : 0; } catch { /* ignore */ }
    let variantGroupCount = 0;
    try { variantGroupCount = p.variants ? (JSON.parse(p.variants) as unknown[]).length : 0; } catch { /* ignore */ }
    const isVariant = variantCount > 1 || variantGroupCount > 0;
    const sku = `stele-${p.id}`;
    const titel = (p.generatedTitle || p.title || '').slice(0, 40);
    const heutigerVk = p.sellPrice ?? null;

    if (isVariant) {
      const variantRows = computeVariantPriceRows(p.variantPrices, p.shippingCost, p.shipsFrom, p.adRate, p.targetMarginEur);
      const neuerVk = safeUniformVariantPrice(variantRows);
      if (neuerVk == null) continue; // keine gueltigen Varianten-Einkaufspreise, ueberspringen
      // Anker = teuerste Variante (max buyPrice) -> exakt die Zeile, deren correctSellPrice das Maximum ist.
      const anchorRow = variantRows.reduce((best, r) => (r.buyPrice > best.buyPrice ? r : best), variantRows[0]);
      const zoll = isChinaShipping(p.shipsFrom) ? DEFAULT_PRICING_CONFIG.chinaCustomsFlatEur : 0;
      const versand = p.shippingCost ?? 0;
      const adRate = p.adRate ?? DEFAULT_PRICING_CONFIG.defaultAdRatePercent;
      const gewinnNeu = profitAtSellPrice({
        sellPrice: neuerVk, buyPrice: anchorRow.buyPrice, supplierShipping: versand,
        isChinaOrigin: isChinaShipping(p.shipsFrom), customsFlat: zoll,
        ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent, ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur,
        vatFactor: DEFAULT_PRICING_CONFIG.vatFactor, adRatePercent: adRate,
      });
      const gewinnHeute = heutigerVk == null ? null : profitAtSellPrice({
        sellPrice: heutigerVk, buyPrice: anchorRow.buyPrice, supplierShipping: versand,
        isChinaOrigin: isChinaShipping(p.shipsFrom), customsFlat: zoll,
        ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent, ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur,
        vatFactor: DEFAULT_PRICING_CONFIG.vatFactor, adRatePercent: adRate,
      });
      const diffEur = heutigerVk == null ? null : Math.round((neuerVk - heutigerVk) * 100) / 100;
      const diffPercent = heutigerVk == null || heutigerVk === 0 ? null : Math.round((diffEur! / heutigerVk) * 1000) / 10;
      rows.push({
        sku, titel, typ: 'Varianten', automatikBetrifft: false, // Teil 4/5: automatischer Pfad schreibt sellPrice NIE bei Varianten-Produkten
        heutigerVk, neuerVk, diffEur, diffPercent,
        gewinnHeute, gewinnNeu,
        unterEinstandHeute: gewinnHeute != null && gewinnHeute < 0,
      });
      continue;
    }

    if (p.buyPrice == null) continue;
    const zoll = isChinaShipping(p.shipsFrom) ? DEFAULT_PRICING_CONFIG.chinaCustomsFlatEur : 0;
    const versand = p.shippingCost ?? 0;
    const adRate = p.adRate ?? DEFAULT_PRICING_CONFIG.defaultAdRatePercent;
    const neuerVk = computeMinSellPrice({
      buyPrice: p.buyPrice, supplierShipping: versand,
      isChinaOrigin: isChinaShipping(p.shipsFrom), customsFlat: DEFAULT_PRICING_CONFIG.chinaCustomsFlatEur,
      ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent, ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur,
      vatFactor: DEFAULT_PRICING_CONFIG.vatFactor, adRatePercent: adRate,
      targetMarginEur: p.targetMarginEur ?? DEFAULT_PRICING_CONFIG.targetMarginEur, safetyBufferEur: DEFAULT_PRICING_CONFIG.safetyBufferEur,
      rounding: 'nearest95',
    }).minSellPrice;
    const gewinnNeu = profitAtSellPrice({
      sellPrice: neuerVk, buyPrice: p.buyPrice, supplierShipping: versand,
      isChinaOrigin: isChinaShipping(p.shipsFrom), customsFlat: zoll,
      ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent, ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur,
      vatFactor: DEFAULT_PRICING_CONFIG.vatFactor, adRatePercent: adRate,
    });
    const gewinnHeute = heutigerVk == null ? null : profitAtSellPrice({
      sellPrice: heutigerVk, buyPrice: p.buyPrice, supplierShipping: versand,
      isChinaOrigin: isChinaShipping(p.shipsFrom), customsFlat: zoll,
      ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent, ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur,
      vatFactor: DEFAULT_PRICING_CONFIG.vatFactor, adRatePercent: adRate,
    });
    const diffEur = heutigerVk == null ? null : Math.round((neuerVk - heutigerVk) * 100) / 100;
    const diffPercent = heutigerVk == null || heutigerVk === 0 ? null : Math.round((diffEur! / heutigerVk) * 1000) / 10;
    rows.push({
      sku, titel, typ: 'Einzelartikel', automatikBetrifft: true,
      heutigerVk, neuerVk, diffEur, diffPercent,
      gewinnHeute, gewinnNeu,
      unterEinstandHeute: gewinnHeute != null && gewinnHeute < 0,
    });
  }

  // Sortierung: groesste Preissenkung zuerst (diffEur aufsteigend; null/ "kein bisheriger Preis" ans Ende)
  rows.sort((a, b) => {
    if (a.diffEur == null && b.diffEur == null) return 0;
    if (a.diffEur == null) return 1;
    if (b.diffEur == null) return -1;
    return a.diffEur - b.diffEur;
  });

  const teurer = rows.filter(r => r.diffEur != null && r.diffEur > 0.001).length;
  const guenstiger = rows.filter(r => r.diffEur != null && r.diffEur < -0.001).length;
  const unveraendert = rows.filter(r => r.diffEur != null && Math.abs(r.diffEur) <= 0.001).length;
  const keinBisherigerPreis = rows.filter(r => r.diffEur == null).length;
  const unterEinstand = rows.filter(r => r.unterEinstandHeute).length;

  const fmt = (n: number | null) => n == null ? '–' : n.toFixed(2).replace('.', ',');
  const fmtPct = (n: number | null) => n == null ? '–' : (n > 0 ? '+' : '') + n.toFixed(1).replace('.', ',') + '%';

  const lines: string[] = [];
  lines.push('# Preis-Trockenlauf 2026-09-13');
  lines.push('');
  lines.push('Reiner Leselauf, KEIN Schreibzugriff auf die DB, KEIN eBay-Call. "Heutiger VK" stammt aus der lokalen DB-Spalte `sellPrice` (nicht von der eBay-Live-Notierung, um keinen eBay-Request abzusetzen). Berechnungsgrundlage: `computeMinSellPrice()`/`profitAtSellPrice()` aus `shared/pricing.ts`, DEFAULT_PRICING_CONFIG (15% + 0,30€ eBay-Gebuehr, 19% MwSt), Rundung `nearest95`.');
  lines.push('');
  lines.push(`Datenstand: ${new Date().toISOString()} (Live-Produktions-DB — der Hintergrund-Cron laeuft parallel weiter, ein zweiter Lauf dieses Skripts kann daher leicht andere Zahlen liefern).`);
  lines.push('');
  lines.push('**Wichtig:** Der automatische, unbeaufsichtigte Pfad (`price-monitor.ts checkOne()`, `POST /products/check-all-prices`) schreibt `sellPrice` NUR bei Einzelartikel-Produkten (kein Varianten-Produkt) — bei den 42 Varianten-Produkten aendert die Automatik `sellPrice` nie, unabhaengig von `AUTO_PRICE_WRITE_ENABLED` (siehe Aufgabe 3). Spalte "Automatik betrifft" zeigt das pro Zeile. Zusaetzlich gilt fuer die betroffenen Einzelartikel-Produkte die Anheben-Nur-Regel (`applyRaiseOnly`): der hier gezeigte "neuer Preis" ist der ROHE `computeMinSellPrice()`-Wert, ungeachtet dieser Richtungs-Sperre — sinkt der Wert gegenueber "heutiger VK", wuerde der automatische Pfad ihn tatsaechlich NICHT schreiben (nur beobachten).');
  lines.push('');
  lines.push('| SKU | Titel | Typ | Automatik betrifft | Heute VK | Neu VK | Diff € | Diff % | Gewinn heute | Gewinn neu | Unter Einstand heute |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    lines.push(`| ${r.sku} | ${r.titel} | ${r.typ} | ${r.automatikBetrifft ? 'ja' : 'nein'} | ${fmt(r.heutigerVk)} € | ${fmt(r.neuerVk)} € | ${r.diffEur == null ? '–' : fmt(r.diffEur) + ' €'} | ${fmtPct(r.diffPercent)} | ${fmt(r.gewinnHeute)} € | ${fmt(r.gewinnNeu)} € | ${r.unterEinstandHeute ? '⚠️ ja' : 'nein'} |`);
  }
  lines.push('');
  lines.push('## Zusammenfassung');
  lines.push(`- Produkte gesamt: ${rows.length}`);
  lines.push(`- Wuerden teurer: ${teurer}`);
  lines.push(`- Wuerden guenstiger: ${guenstiger}`);
  lines.push(`- Unveraendert: ${unveraendert}`);
  lines.push(`- Kein bisheriger Verkaufspreis (Erst-Setzung): ${keinBisherigerPreis}`);
  lines.push(`- Stehen HEUTE unter Einstand (Gewinn heute < 0€, inkl. Gebuehren): ${unterEinstand}`);

  const report = lines.join('\n') + '\n';
  console.log(report);
  await Bun.write('../../docs/preis-trockenlauf-2026-09-13.md', report);
  console.log('\n--- Bericht geschrieben nach docs/preis-trockenlauf-2026-09-13.md ---');
  process.exit(0);
}
main();
