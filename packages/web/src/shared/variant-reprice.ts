// OFFEN 033 (Aufsicht 07.11.2026 10:25): "Auswahl senken" — nur ausgewählte Varianten eines Produkts auf einen vorgegebenen, NIEDRIGEREN
// VK setzen. Anlass: der Stufenwechsel (tier-reprice) setzt ALLE Varianten auf den Formelpreis und kennt keine Senkungsbremse — er hätte
// nicht freigegebene Varianten mitgesenkt (120/123/127/224) und die Bremse übersprungen.
// REINE Funktionen (Grundgesetz 2). Gewinn = Formel v2 mit denselben Parametern wie planTierReprice (repriceFeesFor, Grundgesetz 8).
// Regeln (OFFEN 033):
//  1. nur senken (neuer VK ≥ alter VK → abgelehnt)
//  2. höchstens 8 % unter dem alten VK je Lauf (Senkungsbremse, wie firstStepSell im Senk-Bericht)
//  3. Gewinn beim neuen VK ≥ 1,00 € (Mindestgewinn, Inhaber 14.10.)
//  4. "Preis halten" → ausgelassen und gemeldet
// Dazu (nichts raten, Grundgesetz 4): unbekannte skuId und Varianten ohne eigenen VK (variant_sell_prices/ebayPrice) → abgelehnt.
import { planTierReprice, repriceFeesFor, type RepriceProduct } from './tier-reprice';
import { profitAtSellPrice, parseVariantSellPrices, resolveVariantSellPrice, DEFAULT_PRICING_CONFIG } from './pricing';
import { MAX_PRICE_DECREASE_PERCENT } from './constants';
import { productTarget } from './target-margin-bulk';
import { isPriceJump, MAX_AUTO_RAISE_PCT } from './price-jump';
import type { VariantGroup } from './variant-resolver';

export const VARIANT_REPRICE_MIN_PROFIT_EUR = 1.0;
export const VARIANT_REPRICE_MAX_DECREASE_PERCENT = MAX_PRICE_DECREASE_PERCENT; // 8 % (Teil 2D) — eine Quelle

export type VariantRepriceMode = 'preview' | 'apply';
// OFFEN 034 (Aufsicht 07.11. 12:24, Kalkulator 12:20 "Weg B JA"): "Auswahl anheben" = Spiegelbild von "Auswahl senken".
export type VariantRepriceDirection = 'down' | 'up';
export type VariantRepriceStatus = 'ok' | 'abgelehnt' | 'gehalten';

export interface VariantRepriceRow {
  skuId: string;
  label: string;
  attrs?: Record<string, string>;
  displayValues?: Record<string, string>;
  ware: number | null;
  alt: number | null;
  neu: number;
  gewinnAlt: number | null;
  gewinnNeu: number | null;
  gewinnOhneFaktor?: number | null; // OFFEN 033b (Kalkulator 07.11. 11:05): Gewinn beim neuen VK OHNE Kassen-Faktor (Fund K-018 c1)
  mindestGewinn?: number;           // max(1,00; Ziel des Produkts)
  hinweis?: string;                 // Warnung, lehnt nicht ab
  status: VariantRepriceStatus;
  grund?: string;
}

export type VariantRepriceParse =
  | { ok: true; productId: number; prices: Record<string, number>; mode: VariantRepriceMode; confirm: boolean; sendToEbay: boolean; direction: VariantRepriceDirection }
  | { ok: false; error: string };

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Validierung für POST /products/variant-reprice. 'apply' nur mit confirm === true; Preise > 0, höchstens 2 Nachkommastellen. */
export function parseVariantRepriceBody(body: unknown): VariantRepriceParse {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Body fehlt' };
  const b = body as Record<string, unknown>;
  if (typeof b.productId !== 'number' || !Number.isInteger(b.productId) || b.productId <= 0) return { ok: false, error: '"productId" muss eine positive ganze Zahl sein' };
  if (b.mode !== 'preview' && b.mode !== 'apply') return { ok: false, error: '"mode" muss "preview" oder "apply" sein' };
  const pr = b.prices;
  if (!pr || typeof pr !== 'object' || Array.isArray(pr) || Object.keys(pr).length === 0) return { ok: false, error: '"prices" muss { skuId: neuerVK } mit mindestens einer Zeile sein' };
  const prices: Record<string, number> = {};
  for (const [k, v] of Object.entries(pr as Record<string, unknown>)) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return { ok: false, error: `Preis für ${k} ist keine positive Zahl` };
    if (Math.abs(v * 100 - Math.round(v * 100)) > 1e-6) return { ok: false, error: `Preis für ${k} hat mehr als 2 Nachkommastellen` };
    prices[k] = v;
  }
  if (b.sendToEbay !== undefined && typeof b.sendToEbay !== 'boolean') return { ok: false, error: '"sendToEbay" muss true oder false sein' };
  if (b.direction !== undefined && b.direction !== 'down' && b.direction !== 'up') return { ok: false, error: '"direction" muss "down" (senken, Standard) oder "up" (anheben) sein' };
  const confirm = b.confirm === true;
  if (b.mode === 'apply' && !confirm) return { ok: false, error: '"confirm": true fehlt — es wird nichts gespeichert oder gesendet' };
  return { ok: true, productId: b.productId, prices, mode: b.mode, confirm, sendToEbay: b.sendToEbay === true, direction: b.direction === 'up' ? 'up' : 'down' };
}

/** Prüft jede gewünschte Zeile gegen die Regeln. heldSkuIds = wirksames "Preis halten" (resolvePriceHolds().heldKeys). */
export function planVariantDecrease(
  product: RepriceProduct & { targetMarginEur?: number | null },
  prices: Record<string, number>,
  groups: VariantGroup[],
  heldSkuIds: ReadonlySet<string> = new Set(),
): { isVariant: boolean; rows: VariantRepriceRow[] } {
  return planVariantReprice(product, prices, groups, heldSkuIds, 'down');
}

/** Senken (down) oder Anheben (up) ausgewählter Varianten — dieselben Prüfungen, spiegelbildlich. */
export function planVariantReprice(
  product: RepriceProduct & { targetMarginEur?: number | null },
  prices: Record<string, number>,
  groups: VariantGroup[],
  heldSkuIds: ReadonlySet<string> = new Set(),
  direction: VariantRepriceDirection = 'down',
): { isVariant: boolean; rows: VariantRepriceRow[] } {
  // Zielgewinn ist hier egal (wir übernehmen ware/alt/attrs aus dem Plan, nicht den Formelpreis); Dubletten wie im Senk-Bericht zusammengelegt.
  const plan = planTierReprice(product, DEFAULT_PRICING_CONFIG.targetMarginEur, groups);
  const feesFor = repriceFeesFor(product);
  // OFFEN 033b: nie unter das Ziel des Produkts senken (Regel 07.11.) — Mindestgewinn = max(1,00; Ziel), Ziel wie im Senk-Bericht (productTarget).
  const mindestGewinn = Math.max(VARIANT_REPRICE_MIN_PROFIT_EUR, productTarget(product));
  const stored = parseVariantSellPrices(product.variantSellPrices);
  let legacy: Array<{ skuId: string; ebayPrice?: number }> = [];
  try { legacy = product.variantPrices ? JSON.parse(product.variantPrices) : []; } catch { legacy = []; }

  const rows: VariantRepriceRow[] = [];
  for (const [skuId, neu] of Object.entries(prices)) {
    const pr = plan.rows.find(r => r.skuId === skuId);
    const reject = (grund: string, extra: Partial<VariantRepriceRow> = {}): VariantRepriceRow =>
      ({ skuId, label: pr?.label ?? skuId, ware: pr?.ware ?? null, alt: null, neu, gewinnAlt: null, gewinnNeu: null, status: 'abgelehnt', grund, ...extra });
    if (!plan.isVariant) { rows.push(reject('kein Varianten-Produkt (Einzelartikel: Preis über den Artikel-Preis ändern)')); continue; }
    if (!pr) { rows.push(reject('Variante nicht im Produkt (oder ohne Einkaufspreis)')); continue; }
    const vk = resolveVariantSellPrice(skuId, stored, legacy.find(e => e.skuId === skuId));
    if (vk.source === 'none' || vk.sellPrice == null) { rows.push(reject('kein eigener VK je Variante in der App — nichts geraten')); continue; }
    const fees = feesFor(pr.attrs);
    const alt = vk.sellPrice;
    const gewinnAlt = r2(profitAtSellPrice({ ...fees, sellPrice: alt, buyPrice: pr.ware }));
    const gewinnNeu = r2(profitAtSellPrice({ ...fees, sellPrice: neu, buyPrice: pr.ware }));
    const gewinnOhneFaktor = r2(profitAtSellPrice({ ...fees, checkoutFactor: null, sellPrice: neu, buyPrice: pr.ware }));
    const hinweis = gewinnOhneFaktor < mindestGewinn - 1e-9 && gewinnNeu >= mindestGewinn - 1e-9
      ? `Warnung: ohne Kassen-Faktor nur ${gewinnOhneFaktor.toFixed(2)} € (Faktor ungeklärt, K-018 c1)` : undefined;
    const base = { skuId, label: pr.label, attrs: pr.attrs, displayValues: pr.displayValues, ware: pr.ware, alt, neu, gewinnAlt, gewinnNeu, gewinnOhneFaktor, mindestGewinn, ...(hinweis ? { hinweis } : {}) };
    if (heldSkuIds.has(skuId)) { rows.push({ ...base, status: 'gehalten', grund: '"Preis halten" aktiv — nicht geändert' }); continue; }
    if (direction === 'down') {
      if (neu >= alt - 0.004) { rows.push({ ...base, status: 'abgelehnt', grund: `nur senken: neu ${neu.toFixed(2)} € ist nicht niedriger als alt ${alt.toFixed(2)} €` }); continue; }
      const untergrenze = alt * (1 - VARIANT_REPRICE_MAX_DECREASE_PERCENT / 100);
      if (neu < untergrenze - 0.005) { rows.push({ ...base, status: 'abgelehnt', grund: `Senkungsbremse: höchstens ${VARIANT_REPRICE_MAX_DECREASE_PERCENT} % je Lauf (nicht unter ${untergrenze.toFixed(2)} €)` }); continue; }
    } else {
      if (neu <= alt + 0.004) { rows.push({ ...base, status: 'abgelehnt', grund: `nur anheben: neu ${neu.toFixed(2)} € ist nicht höher als alt ${alt.toFixed(2)} €` }); continue; }
      // Kalkulator 12:20: Anheben ohne Senkungsbremse. Schutz vor Fehl-Zuordnung bleibt die bestehende Grenze OFFEN 010 (Preissprung > 15 %).
      if (isPriceJump(alt, neu)) { rows.push({ ...base, status: 'abgelehnt', grund: `Preissprung: mehr als +${MAX_AUTO_RAISE_PCT} % (OFFEN 010) — bitte prüfen` }); continue; }
    }
    if (gewinnNeu < mindestGewinn - 1e-9) {
      // Kalkulator 07.11.2026 13:50 (OFFEN 035): Anheben, das den Gewinn verbessert, ist auch unter dem Mindestgewinn ok — mit Hinweis.
      // Senken bleibt streng (abgelehnt).
      if (direction === 'up' && gewinnNeu > gewinnAlt + 1e-9) {
        rows.push({ ...base, status: 'ok', hinweis: `noch unter Mindestgewinn: ${gewinnNeu.toFixed(2)} € < ${mindestGewinn.toFixed(2)} € (Gewinn steigt von ${gewinnAlt.toFixed(2)} €)` });
        continue;
      }
      rows.push({ ...base, status: 'abgelehnt', grund: `Gewinn ${gewinnNeu.toFixed(2)} € unter Mindestgewinn ${mindestGewinn.toFixed(2)} € (max(1,00; Ziel))` }); continue;
    }
    rows.push({ ...base, status: 'ok' });
  }
  return { isVariant: plan.isVariant, rows };
}
