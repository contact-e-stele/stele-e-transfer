// Multi-Rabatt (eBay-Mengenrabatt, VOLUME_DISCOUNT) — Beschluss Inhaber 18.10.2026: höchstens 3 Stück, Regel als fester EURO-Betrag
// (2 Stück 3 € billiger, 3 Stück 5 € billiger), weil bei mehreren Stück in einer Bestellung Versand und Einfuhr nur einmal anfallen.
// eBay nimmt nur ganze Prozent je Angebot (ein Satz für alle Varianten) → diese Datei rechnet Euro in Prozent um und prüft den Gewinn
// der GANZEN Bestellung je Variante. REINE Funktionen, keine DB, kein eBay. Gewinn ausschließlich über profitAtSellPrice (Grundgesetz 8).
//
// Regeln laut eBay (developer.ebay.com, pm-volume-discounts): Stufe 1 = 1 Stück 0 %; Stufe 2 = 5–79 %; Stufe 3 = 6–80 % und höher als Stufe 2.
import { profitAtSellPrice, effectiveProfitFloor, DEFAULT_PRICING_CONFIG } from './pricing';

export const MAX_DISCOUNT_QUANTITY = 3;
export const EBAY_TIER_MIN_PERCENT: Record<2 | 3, number> = { 2: 5, 3: 6 };
export const EBAY_TIER_MAX_PERCENT: Record<2 | 3, number> = { 2: 79, 3: 80 };

/** Euro-Regel: so viel ist die GANZE Bestellung mit 2 bzw. 3 Stück billiger als 2×/3× der Einzelpreis. */
export interface VolumeDiscountRule { eur2: number; eur3: number }
export const DEFAULT_VOLUME_DISCOUNT_RULE: VolumeDiscountRule = { eur2: 3, eur3: 5 };

export function validateVolumeDiscountRule(v: unknown): { ok: true; rule: VolumeDiscountRule } | { ok: false; error: string } {
  const o = v as Partial<VolumeDiscountRule> | null;
  const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x > 0 && Math.round(x * 100) === x * 100;
  if (!o || !num(o.eur2) || !num(o.eur3)) return { ok: false, error: 'eur2 und eur3 müssen Beträge > 0 € mit höchstens 2 Nachkommastellen sein' };
  if (o.eur3! <= o.eur2!) return { ok: false, error: '3 Stück muss mehr Rabatt haben als 2 Stück' };
  return { ok: true, rule: { eur2: o.eur2!, eur3: o.eur3! } };
}

/** app_settings-Wert lesen; leer/kaputt → Standardregel (3 € / 5 €). */
export function parseVolumeDiscountRule(json: string | null | undefined): VolumeDiscountRule {
  if (!json) return { ...DEFAULT_VOLUME_DISCOUNT_RULE };
  try {
    const r = validateVolumeDiscountRule(JSON.parse(json));
    return r.ok ? r.rule : { ...DEFAULT_VOLUME_DISCOUNT_RULE };
  } catch { return { ...DEFAULT_VOLUME_DISCOUNT_RULE }; }
}

export interface VolumeDiscountVariant { label: string; skuId?: string; sellPrice: number; buyPrice: number; isChinaOrigin: boolean }
export interface VolumeDiscountInput {
  rule: VolumeDiscountRule;
  variants: VolumeDiscountVariant[];
  adRatePercent: number;
  floorEur: number;               // Boden der Margen-Stufe (profitFloorFor); geprüft wird effectiveProfitFloor(floorEur) je Bestellung
  checkoutFactor?: number | null; // K-005
  earUmlageEur?: number;          // A-029: je Stück
}
export interface VolumeDiscountRow { label: string; skuId?: string; unitPrice: number; total: number; saving: number; profit: number; belowFloor: boolean }
export interface VolumeDiscountTier { qty: 2 | 3; targetEur: number; wantedPercent: number; percent: number; reason: string | null; rows: VolumeDiscountRow[] }
export interface VolumeDiscountPlan {
  ok: boolean;                    // true = so an eBay sendbar
  error: string | null;
  percents: { 2: number; 3: number } | null;
  tiers: VolumeDiscountTier[];
  singleRows: Array<{ label: string; skuId?: string; profit: number }>; // 1 Stück zum Vergleich
  basePrice: number | null;       // höchster VK, an dem die Prozent bemessen werden
}

const cents = (x: number) => Math.round(x * 100) / 100;

/** Preis je Stück nach Rabatt, wie eBay ihn zeigt (auf Cent gerundet). */
export function discountedUnitPrice(sellPrice: number, percent: number): number {
  return cents(sellPrice * (1 - percent / 100));
}

function orderProfit(v: VolumeDiscountVariant, qty: number, percent: number, inp: VolumeDiscountInput) {
  const unitPrice = discountedUnitPrice(v.sellPrice, percent);
  const total = cents(unitPrice * qty);
  const profit = profitAtSellPrice({
    sellPrice: total, buyPrice: v.buyPrice * qty, isChinaOrigin: v.isChinaOrigin,
    ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent, ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur,
    vatFactor: DEFAULT_PRICING_CONFIG.vatFactor, adRatePercent: inp.adRatePercent, checkoutFactor: inp.checkoutFactor,
    earUmlageEur: (inp.earUmlageEur ?? 0) * qty,
  });
  return { unitPrice, total, saving: cents(v.sellPrice * qty - total), profit };
}

/** Euro → ganze Prozent, gemessen am höchsten VK, aufgerundet (der teuerste Artikel erreicht den Euro-Betrag mindestens). */
export function percentForEur(eur: number, qty: number, basePrice: number): number {
  return Math.ceil((eur / (qty * basePrice)) * 100 - 1e-9);
}

/**
 * Plan je Angebot: Wunsch-Prozent aus der Euro-Regel, dann eBay-Grenzen (Stufe 2 ≥ 5 %, Stufe 3 ≥ 6 % und > Stufe 2), dann
 * Gewinnprüfung je Variante (ganze Bestellung ≥ Boden). Liegt eine Variante darunter, wird das Prozent gesenkt; ist dann die
 * eBay-Untergrenze nicht mehr erreichbar → ok = false (kein Multi-Rabatt für dieses Angebot).
 */
export function planVolumeDiscount(inp: VolumeDiscountInput): VolumeDiscountPlan {
  const variants = inp.variants.filter(v => v.sellPrice > 0 && v.buyPrice > 0);
  const empty = (error: string): VolumeDiscountPlan => ({ ok: false, error, percents: null, tiers: [], singleRows: [], basePrice: null });
  if (variants.length === 0) return empty('Kein Verkaufspreis oder Einkaufspreis bekannt — nichts berechenbar.');
  const minProfit = effectiveProfitFloor(inp.floorEur);
  const basePrice = Math.max(...variants.map(v => v.sellPrice));
  const singleRows = variants.map(v => ({ label: v.label, skuId: v.skuId, profit: cents(orderProfit(v, 1, 0, inp).profit) }));
  const singleProfit = new Map(variants.map(v => [v, orderProfit(v, 1, 0, inp).profit]));
  // Inhaber 25.10.2026 (Regel 6 €/11 €): Mehrstück darf je Stück nie weniger bringen als ein Einzelkauf. Sonst lohnt der Rabatt nicht
  // (betrifft Artikel ohne gesparten Versand/Einfuhr, z. B. EU-Lager: 77, 92, 95, 97, 139, 140, 145 am 25.10.).
  const unitNotWorse = (v: VolumeDiscountVariant, qty: number, p: number) => orderProfit(v, qty, p, inp).profit / qty >= singleProfit.get(v)! - 1e-9;
  const floorOk = (qty: number, p: number) => variants.every(v => orderProfit(v, qty, p, inp).profit >= minProfit - 1e-9);
  const unitOk = (qty: number, p: number) => variants.every(v => unitNotWorse(v, qty, p));
  const allAboveFloor = (qty: number, p: number) => floorOk(qty, p) && unitOk(qty, p);

  const percents = { 2: 0, 3: 0 } as { 2: number; 3: number };
  const tiers: VolumeDiscountTier[] = [];
  let error: string | null = null;
  for (const qty of [2, 3] as const) {
    const targetEur = qty === 2 ? inp.rule.eur2 : inp.rule.eur3;
    const wanted = percentForEur(targetEur, qty, basePrice);
    const lower = qty === 3 ? Math.max(EBAY_TIER_MIN_PERCENT[3], percents[2] + 1) : EBAY_TIER_MIN_PERCENT[2];
    let p = Math.min(Math.max(wanted, lower), EBAY_TIER_MAX_PERCENT[qty]);
    let reason: string | null = p > wanted ? (wanted < EBAY_TIER_MIN_PERCENT[qty] ? `eBay-Minimum ${EBAY_TIER_MIN_PERCENT[qty]} %` : 'muss höher sein als 2 Stück')
      : p < wanted ? `eBay-Maximum ${EBAY_TIER_MAX_PERCENT[qty]} %` : null;
    while (p > lower && !allAboveFloor(qty, p)) { p--; reason = floorOk(qty, p + 1) ? 'gesenkt: Gewinn je Stück sonst unter Einzelkauf' : 'gesenkt: Gewinn sonst unter dem Boden'; }
    if (!floorOk(qty, p) && !error) error = `${qty} Stück: schon bei ${p} % (kleinster erlaubter Wert) liegt der Gewinn einer Variante unter ${minProfit.toFixed(2).replace('.', ',')} €.`;
    else if (!unitOk(qty, p) && !error) error = `${qty} Stück: schon bei ${p} % (kleinster erlaubter Wert) bringt jedes Stück weniger als ein Einzelkauf — Mengenrabatt lohnt hier nicht (Rabatt größer als der gesparte Versand/Einfuhr, z. B. EU-Lager oder teurer Artikel).`;
    percents[qty] = p;
    const rows = variants.map(v => {
      const r = orderProfit(v, qty, p, inp);
      return { label: v.label, skuId: v.skuId, unitPrice: r.unitPrice, total: r.total, saving: r.saving, profit: cents(r.profit), belowFloor: r.profit < minProfit - 1e-9 };
    });
    tiers.push({ qty, targetEur, wantedPercent: wanted, percent: p, reason, rows });
  }
  return { ok: error === null, error, percents: error === null ? percents : null, tiers, singleRows, basePrice };
}

/** Request-Körper für createItemPromotion/updateItemPromotion (Marketing API, VOLUME_DISCOUNT, nur dieses Angebot). */
export function buildVolumeDiscountPromotion(args: { listingId: string; productLabel: string; percents: { 2: number; 3: number }; start: Date; end: Date }) {
  const name = `Multi-Rabatt ${args.productLabel}`.slice(0, 90);
  const rule = (minQuantity: number, percent: number, ruleOrder: number) => ({
    discountSpecification: { minQuantity }, discountBenefit: { percentageOffOrder: String(percent) }, ruleOrder,
  });
  return {
    name,
    marketplaceId: 'EBAY_DE',
    promotionStatus: 'SCHEDULED',
    promotionType: 'VOLUME_DISCOUNT',
    startDate: args.start.toISOString(),
    endDate: args.end.toISOString(),
    applyDiscountToSingleItemOnly: true,
    inventoryCriterion: { inventoryCriterionType: 'INVENTORY_BY_VALUE', listingIds: [args.listingId] },
    discountRules: [rule(1, 0, 1), rule(2, args.percents[2], 2), rule(3, args.percents[3], 3)],
  };
}
