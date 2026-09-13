// Aufgabe 3 (Fix "Preisalarm nur unter Mindestpreis", 2026-09-13): DAS TATSÄCHLICHE SCHREIB-SKRIPT
// FÜR DEN ALTBESTAND — VORBEREITET, ABER NICHT AUSGEFÜHRT. Der Nutzer gibt die Ausführung separat
// frei (siehe Auftrag: "Aendere die DB NICHT... fuehre ihn aber NICHT aus. Ich gebe das separat
// frei.").
//
// Was dieses Skript tut, wenn es (nach Freigabe) läuft: setzt `price_changed = false` NUR für die
// Produkte, bei denen
//   (a) das aktuell gespeicherte Flag true ist, UND
//   (b) evaluatePriceAlarm() (neue, korrigierte Bedingung, shared/pricing.ts) auf denselben,
//       bereits gespeicherten Daten false ergibt (siehe scripts/preisalarm-vorschau-report.ts —
//       exakt dieselbe Berechnung, damit Vorschau und tatsächlicher Reset nie auseinanderlaufen).
// Fasst NICHTS anderes an: kein buyPrice/sellPrice/variantPrices-Schreibvorgang, kein eBay-Call.
// Produkte, bei denen die neue Bedingung TRUE ergibt (also stele-137 aktuell), werden nicht
// angefasst — das Flag ist dort schon korrekt bzw. wird beim nächsten reguläre Cron-Lauf gesetzt.
//
// Sicherheitssperre: das Skript bricht sofort ab, wenn nicht exakt die Umgebungsvariable
// PREISALARM_RESET_CONFIRM=yes gesetzt ist — verhindert ein versehentliches `bun run
// scripts/preisalarm-reset-flags.ts` ohne bewusste Freigabe.
//
// Aufruf NACH Freigabe (aus packages/web/):
//   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... PREISALARM_RESET_CONFIRM=yes bun run scripts/preisalarm-reset-flags.ts
import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { evaluatePriceAlarm, isChinaShipping, DEFAULT_PRICING_CONFIG } from '../src/shared/pricing';
import { computeVariantPriceRows } from '../src/api/price-monitor';

async function main() {
  if (process.env.PREISALARM_RESET_CONFIRM !== 'yes') {
    console.error('ABGEBROCHEN: PREISALARM_RESET_CONFIRM=yes ist nicht gesetzt. Dieses Skript schreibt in die Produktions-DB (price_changed=false für nicht mehr alarmwürdige Produkte) — es läuft nur nach ausdrücklicher Freigabe.');
    process.exit(1);
  }

  const all = await db.select().from(schema.products).all();
  const toReset: number[] = [];

  for (const p of all) {
    if (!p.priceChanged) continue; // nur bisher gesetzte Flags sind überhaupt Kandidaten

    let variantCount = 0;
    try { variantCount = p.variantPrices ? (JSON.parse(p.variantPrices) as unknown[]).length : 0; } catch { /* ignore */ }
    let variantGroupCount = 0;
    try { variantGroupCount = p.variants ? (JSON.parse(p.variants) as unknown[]).length : 0; } catch { /* ignore */ }
    const isVariant = variantCount > 1 || variantGroupCount > 0;
    const versand = p.shippingCost ?? 0;
    const isChina = isChinaShipping(p.shipsFrom);
    const adRate = p.adRate ?? DEFAULT_PRICING_CONFIG.defaultAdRatePercent;
    const margin = p.targetMarginEur ?? DEFAULT_PRICING_CONFIG.targetMarginEur;

    const variants = isVariant
      ? computeVariantPriceRows(p.variantPrices, p.shippingCost, p.shipsFrom, p.adRate, p.targetMarginEur).map(r => ({ buyPrice: r.buyPrice }))
      : (p.buyPrice != null ? [{ buyPrice: p.buyPrice }] : []);

    const { isAlarm } = evaluatePriceAlarm({
      currentSellPrice: p.sellPrice,
      variants,
      supplierShipping: versand, isChinaOrigin: isChina, customsFlat: DEFAULT_PRICING_CONFIG.chinaCustomsFlatEur,
      ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent, ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur,
      vatFactor: DEFAULT_PRICING_CONFIG.vatFactor, adRatePercent: adRate,
      targetMarginEur: margin,
    });

    if (!isAlarm) toReset.push(p.id);
  }

  console.log(`${toReset.length} von ${all.length} Produkten werden auf priceChanged=false zurückgesetzt: ${toReset.map(id => `stele-${id}`).join(', ')}`);

  for (const id of toReset) {
    await db.update(schema.products).set({ priceChanged: false }).where(eq(schema.products.id, id));
  }

  console.log(`Fertig — ${toReset.length} Flags zurückgesetzt.`);
  process.exit(0);
}
main();
