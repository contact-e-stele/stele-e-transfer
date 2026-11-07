// K-005 Punkt 3 (Kalkulator, 11.10.2026): Nur-Lese-Bericht "Senk-Kandidaten" — Angebote/Varianten, deren erwarteter Gewinn beim
// heutigen VK mehr als 1,00 € über dem Zielgewinn der Stufe liegt, mit dem Formelpreis der Stufe als Vorschlag.
// REINE Funktion, keine eigene Rechnung (Grundgesetz 8): Erwartet und Vorschlag kommen aus planTierReprice() (shared/tier-reprice.ts),
// derselben Stelle wie Listings-Tab/Stufenwechsel (Formel v2, floor95 mit Boden, Herkunft je Variante, Anzeigensatz des Produkts).
// Es wird nichts geschrieben und nichts gesendet. Die Senkungsbremse (max. 8 % je Lauf) wird nur angezeigt (applyDecreaseCap).
import { planTierReprice, type RepriceProduct } from './tier-reprice';
import { withoutFactorForLowering } from './checkout-factor';
import { productTarget } from './target-margin-bulk';
import { applyDecreaseCap, DEFAULT_PRICING_CONFIG, parseVariantSellPrices, resolveVariantSellPrice } from './pricing';
import { buildCombinations, entryMatchesCombo, NON_VARIATION_ASPECTS, type VariantGroup, type VariantPriceEntry } from './variant-resolver';

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

// Live-Fund 12.10.2026 (Inhaber: "so große Gewinne?"): 94 von 111 Zeilen kamen aus Varianten OHNE eigenen gespeicherten VK —
// planTierReprice fällt dann auf den Produkt-VK zurück (stele-123: alle 6 Varianten 36,95 €, bei eBay ab 13,95 €). Das ist nicht der
// echte Preis der Variante → solche Zeilen sind KEINE Kandidaten, sondern werden als "VK je Variante unbekannt" gezählt.
// Live-Fund 07.11.2026 (119/245/228): ohneVariantenVk zählte auch AliExpress-Einträge, die bei eBay gar NICHT angeboten werden (passen auf
// keine Kombination aus product.variants) — das sah aus wie eine Lücke beim VK und hat Kalkulator und Aufsicht in die Irre geführt.
// Jetzt getrennt: ohneVariantenVk = angebotene Varianten ohne eigenen VK (echte Lücke); nichtBeiEbay = nicht angebotene Einträge (nur Info,
// nie Kandidat). Nur Anzeige, keine Geld-Logik (Kalkulator 07.11. 11:35 „JA“).
export interface SenkBericht {
  kandidaten: SenkRow[];
  ohneVariantenVk: Array<{ productId: number; varianten: number }>;
  nichtBeiEbay: Array<{ productId: number; varianten: number; labels: string[] }>;
}

export function buildSenkBericht(products: Array<SenkProduct & { groups?: VariantGroup[] }>, schwelle = SENK_SCHWELLE_EUR): SenkBericht {
  const out: SenkRow[] = [];
  const ohne: Array<{ productId: number; varianten: number }> = [];
  const nichtBeiEbay: SenkBericht['nichtBeiEbay'] = [];
  for (const p of products) {
    const target = productTarget(p);
    // K-018 c1: Senken rechnet ohne Kassen-Faktor „inkl. Rabatt“ (withoutFactorForLowering).
    const plan = planTierReprice(withoutFactorForLowering(p), target, p.groups);
    const stored = parseVariantSellPrices(p.variantSellPrices);
    let legacy: Array<{ skuId: string; ebayPrice?: number }> = [];
    try { legacy = p.variantPrices ? JSON.parse(p.variantPrices) : []; } catch { legacy = []; }
    let unknown = 0;
    const notOffered: string[] = [];
    // Herkunfts-Gruppen ("Ships From" …) sind keine eBay-Varianten — wie beim Abgleich der attrs ausgeblendet.
    const varGroups = (p.groups ?? []).filter(g => !NON_VARIATION_ASPECTS.has(g.name.trim()));
    const combos = plan.isVariant && varGroups.length > 0 ? buildCombinations(varGroups) : null;
    for (const row of plan.rows) {
      if (combos && row.skuId != null
        && !combos.some(c => entryMatchesCombo(c, { skuId: row.skuId!, attrs: row.attrs ?? {}, displayValues: row.displayValues, price: row.ware } as VariantPriceEntry))) {
        notOffered.push(row.label); continue;                        // bei eBay nicht angeboten → weder Lücke noch Kandidat
      }
      if (plan.isVariant && row.skuId != null
        && resolveVariantSellPrice(row.skuId, stored, legacy.find(e => e.skuId === row.skuId)).source === 'none') { unknown++; continue; }
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
    if (unknown > 0) ohne.push({ productId: p.id, varianten: unknown });
    if (notOffered.length > 0) nichtBeiEbay.push({ productId: p.id, varianten: notOffered.length, labels: notOffered });
  }
  return { kandidaten: out.sort((a, b) => b.overTargetEur - a.overTargetEur), ohneVariantenVk: ohne, nichtBeiEbay };
}

export function buildSenkKandidaten(products: Array<SenkProduct & { groups?: VariantGroup[] }>, schwelle = SENK_SCHWELLE_EUR): SenkRow[] {
  return buildSenkBericht(products, schwelle).kandidaten;
}
