// K-018 PR B (Kalkulator PLAN OK 07.11.2026 14:55): automatisch senken im Tages-Preislauf — REINE Funktion (Grundgesetz 2/8).
// Keine eigene Preisrechnung: Kandidaten + Vorschlag aus buildSenkBericht (Schwelle 0,20 statt 1,00, Senkungsbremse 8 % je Lauf → firstStepSell),
// Prüfung je Variante durch planVariantReprice(…, 'down') (nur senken, Bremse, Mindestgewinn max(1,00; Ziel), Preis halten, eigener VK,
// ohne Kassen-Faktor „inkl. Rabatt“ seit #281). Dazu die Bedingungen des Kalkulators:
//   c2 EK frisch: nur Produkte, deren AliExpress-Daten IN DIESEM LAUF gelesen wurden (freshEk, mit den gelesenen Varianten-EK).
//      NICHT frisch: der Weg #205 „ohne AliExpress-Daten mit gespeichertem EK“ und `lastPriceCheck` (wird auch bei Preis-Änderungen
//      von Hand gesetzt, api/index.ts) — beide zählen hier nie.
//   c3 kein Hin und Her: Varianten, deren VK in diesem Lauf schon geändert wurde (Anheben, K-011, Übernahme), werden übersprungen.
//   c4 Multi-Rabatt: läuft bei eBay ein Mengenrabatt, muss je Stück (2 und 3 Stück, mit den LIVE-Prozent) ≥ 1,00 € bleiben — sonst nicht senken.
// Einzelartikel: nicht in diesem PR (planVariantReprice ist nur für Varianten) → „nicht gesenkt“ mit Grund.
import { buildSenkBericht, type SenkProduct } from './senk-kandidaten';
import { planVariantReprice } from './variant-reprice';
import { planTierReprice } from './tier-reprice';
import { withoutFactorForLowering } from './checkout-factor';
import { isChinaOriginForVariant, DEFAULT_PRICING_CONFIG } from './pricing';
import { volumeOrderProfit } from './volume-discount';
import { earUmlageFor } from './electric';
import type { VariantGroup } from './variant-resolver';

export const AUTO_LOWER_SCHWELLE_EUR = 0.2;            // Kalkulator 14:55: eigene Konstante; der Senk-Bericht bleibt bei 1,00
export const AUTO_LOWER_MIN_PER_PIECE_EUR = 1.0;       // c4: 2/3 Stück je Stück nie unter 1,00 €

export type AutoLowerProduct = SenkProduct & { groups?: VariantGroup[]; isElectric?: number | null };

export interface AutoLowerInput {
  products: AutoLowerProduct[];
  /** c2: Produkt-ID → in diesem Lauf von AliExpress gelesene Varianten-EK (variantPrices-JSON). Fehlt die ID → EK nicht frisch. */
  freshEk: ReadonlyMap<number, string>;
  /** c3: Schlüssel `${productId}:${skuId}` aller Varianten, deren VK in diesem Lauf schon geändert wurde. */
  changedThisRun: ReadonlySet<string>;
  /** wirksames „Preis halten“ je Produkt (resolvePriceHolds().heldKeys). */
  held: ReadonlyMap<number, ReadonlySet<string>>;
  /** c4: laufende Mengenrabatte bei eBay je Produkt-ID (Prozent für 2 und 3 Stück). */
  promotions: ReadonlyMap<number, { 2: number; 3: number }>;
  /** gesperrte Produkte mit Grund (K-011 Käuferpreis-Sperre, OFFEN-010-Ausnahmeliste) — nie senken. */
  gesperrt?: ReadonlyMap<number, string>;
}

export interface AutoLowerRow { productId: number; skuId: string | null; label: string; alt: number; neu: number; gewinnAlt: number | null; gewinnNeu: number | null }
export interface AutoLowerSkip { productId: number; skuId: string | null; label: string; alt: number; vorschlag: number; grund: string }
export interface AutoLowerPlan {
  senken: Array<{ productId: number; prices: Record<string, number>; rows: AutoLowerRow[] }>;
  nichtGesenkt: AutoLowerSkip[];
}

/** c4: Gewinn je Stück bei 2 und 3 Stück mit den LIVE-Prozent; null = ok, sonst Grund. */
export function multiRabattPerPieceProblem(
  product: AutoLowerProduct, ware: number, sell: number, attrs: Record<string, string> | undefined, percents: { 2: number; 3: number },
): string | null {
  const p = withoutFactorForLowering(product);
  for (const qty of [2, 3] as const) {
    const r = volumeOrderProfit({ label: '', sellPrice: sell, buyPrice: ware, isChinaOrigin: isChinaOriginForVariant(attrs, p.shipsFrom) }, qty, percents[qty], {
      adRatePercent: p.adRate ?? DEFAULT_PRICING_CONFIG.defaultAdRatePercent, checkoutFactor: null, earUmlageEur: earUmlageFor(p.isElectric),
    });
    const perPiece = Math.round((r.profit / qty) * 100) / 100;
    if (perPiece < AUTO_LOWER_MIN_PER_PIECE_EUR - 1e-9) {
      return `Multi-Rabatt: ${qty} Stück (${percents[qty]} %) nur ${perPiece.toFixed(2)} € je Stück (< ${AUTO_LOWER_MIN_PER_PIECE_EUR.toFixed(2)} €) — nicht gesenkt, bitte prüfen`;
    }
  }
  return null;
}

export function planAutoLower(inp: AutoLowerInput): AutoLowerPlan {
  const byId = new Map(inp.products.map(p => [p.id, p]));
  // c2: mit den IN DIESEM LAUF gelesenen EK rechnen (die DB wird bei kleinen Änderungen nicht immer neu geschrieben).
  const withFresh = inp.products.map(p => (inp.freshEk.has(p.id) ? { ...p, variantPrices: inp.freshEk.get(p.id)! } : p));
  const bericht = buildSenkBericht(withFresh, AUTO_LOWER_SCHWELLE_EUR);
  const nichtGesenkt: AutoLowerSkip[] = [];
  const perProduct = new Map<number, typeof bericht.kandidaten>();
  for (const k of bericht.kandidaten) {
    const skip = (grund: string) => nichtGesenkt.push({ productId: k.productId, skuId: k.skuId, label: k.label, alt: k.currentSell, vorschlag: k.firstStepSell, grund });
    const sperre = inp.gesperrt?.get(k.productId);
    if (sperre) { skip(sperre); continue; }
    if (k.skuId == null) { skip('Einzelartikel — automatisches Senken nur für Varianten (K-018 PR B)'); continue; }
    if (!inp.freshEk.has(k.productId)) { skip('EK nicht frisch (AliExpress in diesem Lauf nicht gelesen) — c2'); continue; }
    if (inp.changedThisRun.has(`${k.productId}:${k.skuId}`)) { skip('VK in diesem Lauf schon geändert (kein Hin und Her) — c3'); continue; }
    if (!perProduct.has(k.productId)) perProduct.set(k.productId, []);
    perProduct.get(k.productId)!.push(k);
  }
  const senken: AutoLowerPlan['senken'] = [];
  for (const [productId, rows] of perProduct) {
    const product = { ...byId.get(productId)!, variantPrices: inp.freshEk.get(productId)! };
    const wanted = Object.fromEntries(rows.map(r => [r.skuId!, r.firstStepSell]));
    const plan = planVariantReprice(product, wanted, product.groups ?? [], inp.held.get(productId) ?? new Set(), 'down');
    const tier = planTierReprice(withoutFactorForLowering(product), product.targetMarginEur ?? DEFAULT_PRICING_CONFIG.targetMarginEur, product.groups);
    const promo = inp.promotions.get(productId);
    const ok: AutoLowerRow[] = [];
    for (const r of plan.rows) {
      const k = rows.find(x => x.skuId === r.skuId)!;
      const skip = (grund: string) => nichtGesenkt.push({ productId, skuId: r.skuId, label: r.label, alt: k.currentSell, vorschlag: r.neu, grund });
      if (r.status === 'gehalten') { skip('"Preis halten" aktiv'); continue; }
      if (r.status !== 'ok') { skip(r.grund ?? 'abgelehnt'); continue; }
      if (promo) {
        const tr = tier.rows.find(t => t.skuId === r.skuId);
        const problem = multiRabattPerPieceProblem(product, r.ware!, r.neu, tr?.attrs, promo);
        if (problem) { skip(problem + ' — c4'); continue; }
      }
      ok.push({ productId, skuId: r.skuId, label: r.label, alt: r.alt!, neu: r.neu, gewinnAlt: r.gewinnAlt, gewinnNeu: r.gewinnNeu });
    }
    if (ok.length > 0) senken.push({ productId, prices: Object.fromEntries(ok.map(o => [o.skuId!, o.neu])), rows: ok });
  }
  return { senken, nichtGesenkt };
}
