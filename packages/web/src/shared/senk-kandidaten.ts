// K-005 Punkt 3 (Kalkulator, 11.10.2026): Nur-Lese-Bericht "Senk-Kandidaten" — Angebote/Varianten, deren erwarteter Gewinn beim
// heutigen VK mehr als 1,00 € über dem Zielgewinn der Stufe liegt, mit dem Formelpreis der Stufe als Vorschlag.
// REINE Funktion, keine eigene Rechnung (Grundgesetz 8): Erwartet und Vorschlag kommen aus planTierReprice() (shared/tier-reprice.ts),
// derselben Stelle wie Listings-Tab/Stufenwechsel (Formel v2, floor95 mit Boden, Herkunft je Variante, Anzeigensatz des Produkts).
// Es wird nichts geschrieben und nichts gesendet. Die Senkungsbremse (max. 8 % je Lauf) wird nur angezeigt (applyDecreaseCap).
import { planTierReprice, type RepriceProduct } from './tier-reprice';
import { productTarget } from './target-margin-bulk';
import { applyDecreaseCap, DEFAULT_PRICING_CONFIG } from './pricing';
import type { VariantGroup } from './variant-resolver';

export const SENK_SCHWELLE_EUR = 1.0;          // Auftrag K-005: Erwartet > Ziel + 1,00 €
export const SENK_BREMSE_PROZENT = 8;          // Teil 2D: max. 8 % Absenkung je Lauf (nur Anzeige)

export interface SenkProduct extends RepriceProduct {
  targetMarginEur?: number | null;
  ebayListingId?: string | null;
  title?: string | null;
}

export interface SenkRow {
  productId: number;
  ebayListingId: string | null;
  title: string | null;
  skuId: string | null;
  label: string;
  ware: number;
  adRate: number;                 // mit diesem Satz gerechnet (null in DB → 5)
  targetEur: number;
  currentSell: number;
  expectedEur: number;            // Gewinn beim heutigen VK
  overTargetEur: number;          // expectedEur − targetEur
  suggestedSell: number;          // Formelpreis der Stufe (floor95, Boden)
  suggestedProfit: number;
  firstStepSell: number;          // mit Senkungsbremse (8 %) im ersten Lauf
  firstStepCapped: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function buildSenkKandidaten(products: Array<SenkProduct & { groups?: VariantGroup[] }>, schwelle = SENK_SCHWELLE_EUR): SenkRow[] {
  const out: SenkRow[] = [];
  for (const p of products) {
    const target = productTarget(p);
    const plan = planTierReprice(p, target, p.groups);
    for (const row of plan.rows) {
      if (row.oldSell == null || row.oldProfit == null) continue;   // ohne heutigen VK kein Vergleich (nichts geraten)
      if (!(row.oldProfit > target + schwelle + 1e-9)) continue;
      if (!(row.newSell < row.oldSell - 1e-9)) continue;             // Formel liefert keinen niedrigeren Preis → kein Kandidat
      const cap = applyDecreaseCap(row.oldSell, row.newSell, SENK_BREMSE_PROZENT);
      out.push({
        productId: p.id, ebayListingId: p.ebayListingId ?? null, title: p.title ?? null,
        skuId: row.skuId, label: row.label, ware: row.ware, adRate: p.adRate ?? DEFAULT_PRICING_CONFIG.defaultAdRatePercent, targetEur: target,
        currentSell: row.oldSell, expectedEur: r2(row.oldProfit), overTargetEur: r2(row.oldProfit - target),
        suggestedSell: row.newSell, suggestedProfit: r2(row.newProfit),
        firstStepSell: cap.price, firstStepCapped: cap.wasCapped,
      });
    }
  }
  return out.sort((a, b) => b.overTargetEur - a.overTargetEur);
}
