// Aufgabe 3 (Fix "Preisalarm nur unter Mindestpreis", 2026-09-13): reiner Leselauf, KEIN
// Schreibzugriff auf die DB, KEIN eBay-Call. Vergleicht für jedes Produkt das BESTEHENDE
// `price_changed`-Flag (geschrieben von der alten, fehlerhaften Bedingung) mit dem Ergebnis der
// NEUEN Bedingung (evaluatePriceAlarm() in shared/pricing.ts), berechnet ausschließlich aus den
// bereits in der DB gespeicherten Werten (buyPrice/sellPrice/variantPrices) — es wird NICHT erneut
// bei AliExpress nachgefragt, das ist eine reine Vorschau auf denselben Datenstand, den auch das
// Produkte-Tab gerade anzeigt.
//
// Aufruf (aus packages/web/): TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... bun run scripts/preisalarm-vorschau-report.ts
import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import { evaluatePriceAlarm, isChinaShipping, DEFAULT_PRICING_CONFIG } from '../src/shared/pricing';
import { computeVariantPriceRows } from '../src/api/price-monitor';

type Row = {
  sku: string;
  titel: string;
  typ: 'Einzelartikel' | 'Varianten';
  altesFlag: boolean;
  neuesFlag: boolean;
  aendertSich: 'bleibt Alarm' | 'wird zurückgesetzt' | 'neu Alarm' | 'bleibt kein Alarm';
  sellPrice: number | null;
  worstProfit: number | null;
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
    const versand = p.shippingCost ?? 0;
    const isChina = isChinaShipping(p.shipsFrom);
    const adRate = p.adRate ?? DEFAULT_PRICING_CONFIG.defaultAdRatePercent;
    const margin = p.targetMarginEur ?? DEFAULT_PRICING_CONFIG.targetMarginEur;

    const variants = isVariant
      ? computeVariantPriceRows(p.variantPrices, p.shippingCost, p.shipsFrom, p.adRate, p.targetMarginEur).map(r => ({ buyPrice: r.buyPrice }))
      : (p.buyPrice != null ? [{ buyPrice: p.buyPrice }] : []);

    const { isAlarm, worstProfit } = evaluatePriceAlarm({
      currentSellPrice: p.sellPrice,
      variants,
      supplierShipping: versand, isChinaOrigin: isChina, customsFlat: DEFAULT_PRICING_CONFIG.chinaCustomsFlatEur,
      ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent, ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur,
      vatFactor: DEFAULT_PRICING_CONFIG.vatFactor, adRatePercent: adRate,
      targetMarginEur: margin,
    });

    const altesFlag = !!p.priceChanged;
    const neuesFlag = isAlarm;
    const aendertSich: Row['aendertSich'] =
      altesFlag && neuesFlag ? 'bleibt Alarm' :
      altesFlag && !neuesFlag ? 'wird zurückgesetzt' :
      !altesFlag && neuesFlag ? 'neu Alarm' :
      'bleibt kein Alarm';

    rows.push({ sku, titel, typ: isVariant ? 'Varianten' : 'Einzelartikel', altesFlag, neuesFlag, aendertSich, sellPrice: p.sellPrice, worstProfit });
  }

  // Sortierung: Aenderungen zuerst (wird zurückgesetzt / neu Alarm), Rest danach.
  const prio = (r: Row) => r.aendertSich === 'wird zurückgesetzt' ? 0 : r.aendertSich === 'neu Alarm' ? 1 : r.aendertSich === 'bleibt Alarm' ? 2 : 3;
  rows.sort((a, b) => prio(a) - prio(b));

  const altGesamt = rows.filter(r => r.altesFlag).length;
  const neuGesamt = rows.filter(r => r.neuesFlag).length;
  const bleibtAlarm = rows.filter(r => r.aendertSich === 'bleibt Alarm').length;
  const wirdZurueckgesetzt = rows.filter(r => r.aendertSich === 'wird zurückgesetzt').length;
  const neuAlarm = rows.filter(r => r.aendertSich === 'neu Alarm').length;

  const fmt = (n: number | null) => n == null ? '–' : n.toFixed(2).replace('.', ',');

  const lines: string[] = [];
  lines.push('# Preisalarm-Vorschau 2026-09-13 (Aufgabe 3, nur Lesen)');
  lines.push('');
  lines.push('Reiner Leselauf, KEIN Schreibzugriff auf die DB, KEIN eBay-Call, KEINE erneute AliExpress-Abfrage — vergleicht ausschließlich das bestehende `price_changed`-Flag (alte Bedingung) gegen `evaluatePriceAlarm()` (neue Bedingung, shared/pricing.ts), beide auf demselben, bereits in der DB gespeicherten Datenstand.');
  lines.push('');
  lines.push(`Datenstand: ${new Date().toISOString()} (Live-Produktions-DB — der Hintergrund-Cron läuft parallel weiter, ein zweiter Lauf kann daher leicht andere Zahlen liefern).`);
  lines.push('');
  lines.push('| SKU | Titel | Typ | Altes Flag | Neues Flag | Änderung | VK | Gewinn (schlechteste Variante) |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    lines.push(`| ${r.sku} | ${r.titel} | ${r.typ} | ${r.altesFlag ? 'Alarm' : '–'} | ${r.neuesFlag ? 'Alarm' : '–'} | ${r.aendertSich} | ${fmt(r.sellPrice)} € | ${fmt(r.worstProfit)} € |`);
  }
  lines.push('');
  lines.push('## Zusammenfassung');
  lines.push(`- Produkte gesamt: ${rows.length}`);
  lines.push(`- Altes Flag (price_changed=true, IST-Zustand): ${altGesamt}`);
  lines.push(`- Neues Flag nach korrigierter Bedingung (Preis unter Mindestpreis): ${neuGesamt}`);
  lines.push(`  - davon bleiben Alarm (waren schon korrekt): ${bleibtAlarm}`);
  lines.push(`  - davon sind NEU Alarm (waren vorher fälschlich nicht markiert): ${neuAlarm}`);
  lines.push(`- Flags, die auf false zurückgesetzt werden müssten (waren Alarm, sind es nach neuer Bedingung nicht mehr): ${wirdZurueckgesetzt}`);
  lines.push('');
  lines.push('**Hinweis:** Diese Zahlen sind eine Vorschau auf Basis der zuletzt in der DB gespeicherten Preise — sie werden erst korrekt, sobald der reguläre Preis-Cron (price-monitor.ts, jetzt mit der korrigierten Bedingung) einmal durchgelaufen ist ODER das vorbereitete Reset-Skript (scripts/preisalarm-reset-flags.ts, NICHT ausgeführt) freigegeben und gestartet wird.');

  const report = lines.join('\n') + '\n';
  console.log(report);
  await Bun.write('../../docs/preisalarm-vorschau-2026-09-13.md', report);
  console.log('\n--- Bericht geschrieben nach docs/preisalarm-vorschau-2026-09-13.md ---');
  process.exit(0);
}
main();
