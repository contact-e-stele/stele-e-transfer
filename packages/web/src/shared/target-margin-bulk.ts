// A-016: gemeinsame, REINE Bausteine für die Margen-Stufen A–D außerhalb von Rechnern — Gewinn-Zeilen je Produkt/Variante
// (vorher inline in produkte.tsx TargetBadge, jetzt EINE Quelle für Produkte-Tab und Listings-Tab, Grundgesetz Regel 8),
// Vorschau "was wird rot nach einem Stufenwechsel", Validierung des Sammel-Endpunkts und der Filter "neu eingestellt".
// Nichts hier schreibt an eBay oder in die DB.
import { MARGIN_TIERS } from './constants';
import { isVariantProduct } from './variant-product';
import { activeCheckoutFactor } from './checkout-factor';
import {
  profitAtSellPrice, evaluateTargetDisplay, isChinaOriginForVariant,
  parseVariantSellPrices, resolveVariantSellPrice, DEFAULT_PRICING_CONFIG,
  effectiveProfitFloor, profitFloorFor,
} from './pricing';
import { buildCombinations, entryMatchesCombo, type VariantGroup, type VariantPriceEntry } from './variant-resolver';

export interface ProfitProduct {
  id: number;
  variants: unknown;                  // product.variants (JSON-Text oder geparst) — für isVariantProduct (A-019)
  targetMarginEur?: number | null;
  shipsFrom?: string | null;
  adRate: number | null;
  sellPrice: number | null;
  buyPrice: number | null;
  variantPrices: string | null;       // JSON [{skuId, attrs, price, ebayPrice?}]
  variantSellPrices?: string | null;  // JSON {skuId: VK}
  aliCheckoutFactor?: number | null;  // K-005: Kassen-Faktor (gilt nur, wenn ≤ 14 Tage alt)
  aliCheckoutFactorAt?: string | null;
}

// skuId/sellPrice nur bei Varianten-Zeilen bzw. immer der VK, mit dem gerechnet wurde (A-017: Gewinn-Spalte der Varianten-Tabelle)
// profitWithoutFactor: K-005 — Gewinn ohne Kassen-Faktor (gleich profit, wenn kein Faktor angewendet wurde); < 0 → Warnhinweis
// buyPrice/isChinaOrigin (Multi-Rabatt 18.10.2026): EK und Herkunft, mit denen gerechnet wurde — für die Mehrstück-Rechnung in volume-discount.ts
export interface ProfitRow { label: string; profit: number; skuId?: string; sellPrice: number; profitWithoutFactor?: number; buyPrice?: number; isChinaOrigin?: boolean }

// K-014 Schritt 2 (Kalkulator 28.10.2026): Varianten, die NICHT ins "Erwartet"/den Preisalarm zählen — nicht bei eBay angeboten
// (keine Kombination der eBay-Gruppe passt, Zuordnung wie VariantRaise: entryMatchesCombo) oder ohne eigenen Verkaufspreis.
// Sie werden grau angezeigt, nie mit product.sellPrice gerechnet (vorher: 119 "Erwartet −5,33" aus 500PCs @ 14,95).
export type ExcludedReason = 'nicht bei eBay' | 'ohne eigenen VK' | 'Dublette mit altem VK';
export interface ExcludedVariant { skuId: string; label: string; reason: ExcludedReason; storedSellPrice: number | null }

function parseGroups(v: unknown): VariantGroup[] {
  let g: unknown = v;
  if (typeof g === 'string') { try { g = JSON.parse(g); } catch { g = []; } }
  return Array.isArray(g) ? (g as VariantGroup[]).filter(x => x && typeof x.name === 'string' && Array.isArray(x.values) && x.values.length > 0) : [];
}

/** Rein: teilt die Varianten-Einträge in "gelistet mit eigenem VK" (zählt) und ausgeschlossene (grau). */
export function classifyListedVariants<T extends { skuId: string; attrs?: Record<string, string>; price: number; ebayPrice?: number; displayValues?: Record<string, string> }>(
  variants: unknown, entries: T[], variantSellPricesJson: string | null | undefined,
): { counted: Array<{ entry: T; sellPrice: number }>; excluded: ExcludedVariant[] } {
  const combos = buildCombinations(parseGroups(variants));
  const stored = parseVariantSellPrices(variantSellPricesJson ?? null);
  const counted: Array<{ entry: T; sellPrice: number }> = [];
  const excluded: ExcludedVariant[] = [];
  const matched: Array<{ e: T; label: string; combo: number; own: number | null; source: string }> = [];
  for (const e of entries) {
    if (typeof e.price !== 'number' || e.price <= 0) continue;
    const label = Object.values(e.attrs ?? {}).join(' / ') || `…${String(e.skuId).slice(-6)}`;
    const r = resolveVariantSellPrice(e.skuId, stored, e);
    const combo = combos.findIndex(c => entryMatchesCombo(c, e as unknown as VariantPriceEntry));
    if (combo < 0) { excluded.push({ skuId: e.skuId, label, reason: 'nicht bei eBay', storedSellPrice: r.sellPrice }); continue; }
    if (r.sellPrice == null) { excluded.push({ skuId: e.skuId, label, reason: 'ohne eigenen VK', storedSellPrice: null }); continue; }
    matched.push({ e, label, combo, own: r.sellPrice, source: r.source });
  }
  // Dubletten (mehrere AliExpress-Einträge für dieselbe eBay-Variante): hat einer einen aktuellen VK aus variantSellPrices, zählen alte
  // Einträge, die nur noch den früheren ebayPrice tragen, nicht (Live-Fund 28.10. stele-189 L/Green: alter ebayPrice 16,95 ↔ eBay 18,95).
  const comboHasColumn = new Set(matched.filter(m => m.source === 'column').map(m => m.combo));
  for (const m of matched) {
    if (m.source !== 'column' && comboHasColumn.has(m.combo)) { excluded.push({ skuId: m.e.skuId, label: m.label, reason: 'Dublette mit altem VK', storedSellPrice: m.own }); continue; }
    counted.push({ entry: m.e, sellPrice: m.own as number });
  }
  return { counted, excluded };
}

export function productTarget(p: Pick<ProfitProduct, 'targetMarginEur'>): number {
  return p.targetMarginEur ?? DEFAULT_PRICING_CONFIG.targetMarginEur;
}

// Gewinn beim heutigen VK je Variante (Varianten-Produkt: variant_sell_prices → alter ebayPrice → Produkt-VK) bzw. je
// Einzelartikel. Formel v2 über profitAtSellPrice. Zeilen ohne VK oder ohne Einkaufspreis fehlen (nichts geraten).
export function productProfitRows(p: ProfitProduct): { rows: ProfitRow[]; isVariant: boolean; excluded: ExcludedVariant[] } {
  const adRate = p.adRate ?? DEFAULT_PRICING_CONFIG.defaultAdRatePercent;
  const checkoutFactor = activeCheckoutFactor(p.aliCheckoutFactor, p.aliCheckoutFactorAt); // K-005
  // K-004: Herkunft je Variante ("Ships From"), sonst Produkt-Herkunft; leer → China.
  const profitWith = (f: number | null, sellPrice: number, buyPrice: number, attrs?: Record<string, string>) => profitAtSellPrice({
    sellPrice, buyPrice, isChinaOrigin: isChinaOriginForVariant(attrs, p.shipsFrom),
    ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent, ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur,
    vatFactor: DEFAULT_PRICING_CONFIG.vatFactor, adRatePercent: adRate, checkoutFactor: f,
  });
  const profitAt = (sellPrice: number, buyPrice: number, attrs?: Record<string, string>) => profitWith(checkoutFactor, sellPrice, buyPrice, attrs);
  const profitRaw = (sellPrice: number, buyPrice: number, attrs?: Record<string, string>) => profitWith(null, sellPrice, buyPrice, attrs);

  let entries: Array<{ skuId: string; attrs?: Record<string, string>; price: number; ebayPrice?: number }> = [];
  try { entries = p.variantPrices ? JSON.parse(p.variantPrices) : []; } catch { entries = []; }
  const isVariant = isVariantProduct(p.variants, p.variantPrices);
  const rows: ProfitRow[] = [];
  let excluded: ExcludedVariant[] = [];
  if (isVariant) {
    // K-014: nur bei eBay angebotene Varianten mit eigenem VK — kein Rückfall auf product.sellPrice (der gilt nur für Einzelartikel).
    const cls = classifyListedVariants(p.variants, entries, p.variantSellPrices);
    excluded = cls.excluded;
    for (const { entry: v, sellPrice: sell } of cls.counted) {
      const label = Object.values(v.attrs ?? {}).join(' / ') || `…${v.skuId.slice(-6)}`;
      rows.push({ label, profit: profitAt(sell, v.price, v.attrs), skuId: v.skuId, sellPrice: sell, profitWithoutFactor: profitRaw(sell, v.price, v.attrs), buyPrice: v.price, isChinaOrigin: isChinaOriginForVariant(v.attrs, p.shipsFrom) });
    }
  } else if (p.sellPrice && p.buyPrice) {
    rows.push({ label: '', profit: profitAt(p.sellPrice, p.buyPrice), sellPrice: p.sellPrice, profitWithoutFactor: profitRaw(p.sellPrice, p.buyPrice), buyPrice: p.buyPrice, isChinaOrigin: isChinaOriginForVariant(undefined, p.shipsFrom) });
  }
  return { rows, isVariant, excluded };
}

// K-014 Schritt 2: Preisalarm für Varianten-Produkte = schlechteste GELISTETE Variante mit IHREM VK unter dem Boden (wie die Anzeige).
// Gehaltene Varianten (K-008) zählen nicht. Keine zählende Variante → kein Alarm (nichts geraten).
export function variantPriceAlarm(p: ProfitProduct, heldSkuIds?: ReadonlySet<string>): { isAlarm: boolean; worstProfit: number | null; worstProfitWithoutFactor: number | null; lossWithoutFactor: boolean; excluded: ExcludedVariant[] } {
  const { rows, excluded } = productProfitRows(p);
  const use = rows.filter(r => !(r.skuId && heldSkuIds?.has(r.skuId)));
  if (use.length === 0) return { isAlarm: false, worstProfit: null, worstProfitWithoutFactor: null, lossWithoutFactor: false, excluded };
  const worstProfit = Math.min(...use.map(r => r.profit));
  const worstProfitWithoutFactor = Math.min(...use.map(r => r.profitWithoutFactor ?? r.profit));
  const floor = effectiveProfitFloor(profitFloorFor(productTarget(p)));
  return { isAlarm: worstProfit < floor - 1e-9, worstProfit, worstProfitWithoutFactor, lossWithoutFactor: worstProfitWithoutFactor < -1e-9 && worstProfit > worstProfitWithoutFactor + 1e-9, excluded };
}

export interface TierChangePreview {
  total: number;          // Produkte in der Auswahl
  red: number;            // davon: schlechtester Gewinn liegt nach dem Wechsel unter dem Boden der neuen Stufe
  redSingle: number;      // davon Einzelartikel → die automatische Preisprüfung hebt sie beim nächsten Lauf an
  redVariant: number;     // davon Varianten-Produkte → nur markiert, die Automatik hebt sie NICHT an
  yellow: number;         // unter dem Ziel, aber über dem Boden
  unknown: number;        // nicht berechenbar (kein VK/EK) — weder rot noch gelb
  redIds: number[];
}

// Vorschau für den Bestätigungsdialog "N Listings → Stufe X. Davon rot nach Wechsel: M". Rechnet nichts selbst:
// Gewinn aus productProfitRows (Formel v2), Bewertung aus evaluateTargetDisplay/profitFloorFor (shared/pricing.ts).
export function previewTierChange(products: ProfitProduct[], newTargetEur: number): TierChangePreview {
  const out: TierChangePreview = { total: products.length, red: 0, redSingle: 0, redVariant: 0, yellow: 0, unknown: 0, redIds: [] };
  for (const p of products) {
    const { rows, isVariant } = productProfitRows(p);
    if (rows.length === 0) { out.unknown++; continue; }
    const level = evaluateTargetDisplay(newTargetEur, Math.min(...rows.map(r => r.profit))).level;
    if (level === 'red') {
      out.red++; out.redIds.push(p.id);
      if (isVariant) out.redVariant++; else out.redSingle++;
    } else if (level === 'yellow') out.yellow++;
  }
  return out;
}

export const BULK_TARGET_MARGIN_MAX = 200;

export type BulkTargetMarginParse =
  | { ok: true; productIds: number[]; targetMarginEur: number }
  | { ok: false; error: string };

// Validierung des Sammel-Endpunkts PATCH /products/target-margin. Nur die Stufen A–D (MARGIN_TIERS; die ausgeblendete 4,50
// ist NICHT wählbar), ausdrückliche Bestätigung (confirm === true), begrenzte Anzahl, nur ganze positive IDs, keine Dubletten.
export function parseBulkTargetMarginBody(body: unknown): BulkTargetMarginParse {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Body fehlt' };
  const b = body as Record<string, unknown>;
  if (b.confirm !== true) return { ok: false, error: '"confirm": true fehlt — Stufenwechsel für mehrere Produkte nur nach Bestätigung' };
  const t = b.targetMarginEur;
  const tier = typeof t === 'number' ? MARGIN_TIERS.find(x => Math.abs(x.targetEur - t) < 0.005) : undefined;
  if (!tier) {
    return { ok: false, error: '"targetMarginEur" muss eine Margen-Stufe sein (1,00 / 1,50 / 2,00 / 3,00)' };
  }
  const ids = b.productIds;
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false, error: '"productIds" muss eine nicht-leere Liste sein' };
  if (ids.length > BULK_TARGET_MARGIN_MAX) return { ok: false, error: `Höchstens ${BULK_TARGET_MARGIN_MAX} Produkte je Aufruf (übergeben: ${ids.length})` };
  if (!ids.every(i => typeof i === 'number' && Number.isInteger(i) && i > 0)) return { ok: false, error: '"productIds" darf nur positive ganze Zahlen enthalten' };
  // Kanonischer Stufenwert (nicht der Rohwert): 2.004 würde sonst als 2.004 gespeichert.
  return { ok: true, productIds: [...new Set(ids as number[])], targetMarginEur: tier.targetEur };
}

// Filter "Neu eingestellt": Die eBay-Anzeige trägt StartTime (Listings-API). days = 0 → heute (lokaler Kalendertag), sonst
// "innerhalb der letzten N Tage" (N × 24 h). Ungültiges/leeres Datum → false (nicht geraten).
export function isListedWithin(startTimeIso: string | null | undefined, days: number, now: Date = new Date()): boolean {
  if (!startTimeIso) return false;
  const t = new Date(startTimeIso);
  if (isNaN(t.getTime())) return false;
  if (t.getTime() > now.getTime() + 60_000) return false; // Zukunftsdatum = kein "bereits eingestellt"
  if (days <= 0) {
    return t.getFullYear() === now.getFullYear() && t.getMonth() === now.getMonth() && t.getDate() === now.getDate();
  }
  return now.getTime() - t.getTime() <= days * 24 * 60 * 60 * 1000;
}

// Vergleichsfunktion "neueste zuerst": fehlende/ungültige StartTime sortiert ans Ende; zwei fehlende sind gleich (kein NaN).
export function compareStartTimeDesc(a: string | null | undefined, b: string | null | undefined): number {
  const ta = startTimeMillis(a), tb = startTimeMillis(b);
  return ta === tb ? 0 : tb - ta;
}

export function startTimeMillis(startTimeIso: string | null | undefined): number {
  if (!startTimeIso) return -Infinity;
  const t = new Date(startTimeIso).getTime();
  return isNaN(t) ? -Infinity : t;
}
