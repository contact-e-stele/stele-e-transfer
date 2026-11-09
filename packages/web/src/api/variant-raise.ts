// A-019 Teil 2: Preisprüfung für Varianten-Produkte — liegt der Gewinn EINER Variante unter dem Boden der Stufe (Formel v2), wird NUR
// diese Variante angehoben (raise-only, nie senken). Neuer VK = planTierReprice-Preis dieser Variante (dieselbe Funktion wie Stufenwechsel/
// "Erwartet"). Senden je Variante über updateOfferPriceBySku (GET → PUT volles Offer), NIE der Einheitspreis-Weg. Speichern in
// variant_sell_prices erst nach Erfolg. Pflicht-Log je Anhebung. Hinter AUTO_VARIANT_RAISE_ENABLED (Default AUS).
//
// Bewusst ohne direkte DB-/eBay-Importe: Senden/Speichern/Log kommen als `deps` (Grundgesetz Regel 2 — mit Mocks testbar).
import { planTierReprice, type RepriceProduct, type TierPlanRow } from '../shared/tier-reprice';
import { profitFloorFor, effectiveProfitFloor, DEFAULT_PRICING_CONFIG } from '../shared/pricing';
import { isPriceJump, priceJumpMessage } from '../shared/price-jump';

const fmt = (n: number) => n.toFixed(2);

export interface VariantRaiseProduct extends RepriceProduct {
  targetMarginEur: number | null;
  ebayStatus: string | null;
  ebayListingId: string | null;
}

export type VariantRaise = TierPlanRow & { skuId: string; oldSell: number; oldProfit: number }; // skuId, alter VK und alter Gewinn sind bekannt (Pflicht)

// Fix stele-251 (09.11.2026): warum eine Variante NICHT angehoben wird — je Zeile ein Grund (vorher still). planVariantRaises ist
// genau die Zeilen-Menge mit reason 'raise' (reiner Extract, Grundgesetz 8: die Regel steht nur hier).
export type VariantRaiseSkipReason = 'raise' | 'held' | 'no_sku' | 'no_old_sell' | 'profit_ok' | 'not_higher';
export interface VariantRaiseExplanation {
  isVariant: boolean;
  floor: number;                                  // Gewinn-Grenze (Boden − Toleranz, nie unter 1,00)
  rows: Array<TierPlanRow & { reason: VariantRaiseSkipReason }>;
}
export function explainVariantRaisePlan(product: VariantRaiseProduct, heldSkuIds?: ReadonlySet<string>): VariantRaiseExplanation {
  const target = product.targetMarginEur ?? DEFAULT_PRICING_CONFIG.targetMarginEur;
  const floor = effectiveProfitFloor(profitFloorFor(target)); // K-006: dieselbe Grenze wie die Rundung (Boden − 0,10, nie unter 1,00)
  const plan = planTierReprice(product, target);
  if (!plan.isVariant) return { isVariant: false, floor, rows: [] };
  const reasonFor = (r: TierPlanRow): VariantRaiseSkipReason => {
    if (r.skuId == null) return 'no_sku';
    if (r.oldSell == null || r.oldProfit == null) return 'no_old_sell';
    if (heldSkuIds?.has(r.skuId)) return 'held';
    if (!(r.oldProfit < floor - 1e-9)) return 'profit_ok';
    if (!(r.newSell > r.oldSell + 0.004)) return 'not_higher';
    return 'raise';
  };
  return { isVariant: true, floor, rows: plan.rows.map(r => ({ ...r, reason: reasonFor(r) })) };
}

const SKIP_TEXT: Record<VariantRaiseSkipReason, string> = {
  raise: 'wird angehoben',
  held: 'Preis gehalten (K-008)',
  no_sku: 'keine skuId',
  no_old_sell: 'kein alter VK bekannt',
  profit_ok: 'Gewinn nicht unter der Grenze',
  not_higher: 'Formelpreis nicht höher als der VK',
};
/** Log-Zeilen: je Variante der Grund (für den Weg "gespeicherter Einkaufspreis", Fix 251). */
export function describeVariantRaiseExplanation(productId: number, ex: VariantRaiseExplanation): string[] {
  if (!ex.isVariant) return [`[VariantRaise] stele-${productId}: kein Varianten-Produkt — nichts angehoben`];
  if (ex.rows.length === 0) return [`[VariantRaise] stele-${productId}: keine Variante mit gespeichertem Einkaufspreis > 0 — nichts angehoben`];
  return ex.rows.map(r => `[VariantRaise] stele-${productId} ${r.label || r.skuId} (skuId ${r.skuId ?? '–'}): EK ${fmt(r.ware)}, VK ${r.oldSell != null ? fmt(r.oldSell) : '–'}, Gewinn ${r.oldProfit != null ? fmt(r.oldProfit) : '–'} € (Grenze ${fmt(ex.floor)}), Formel ${fmt(r.newSell)} € — ${SKIP_TEXT[r.reason]}`);
}

// Nur Zeilen mit bekanntem alten VK, Gewinn < Boden und höherem Formelpreis — nie senken, nie raten (kein alter VK → keine Zeile).
// K-008: heldSkuIds = gehaltene Varianten (Gewinn ≥ 0,90 €) — werden nicht angehoben.
export function planVariantRaises(product: VariantRaiseProduct, heldSkuIds?: ReadonlySet<string>): VariantRaise[] {
  return explainVariantRaisePlan(product, heldSkuIds).rows
    .filter(r => r.reason === 'raise')
    .map(({ reason: _r, ...row }) => row as VariantRaise);
}

export interface VariantSendResult {
  resolved: boolean;                       // false → Zuordnung nicht eindeutig: NICHTS wurde gesendet
  reason?: string;                         // Klartext, warum nicht eindeutig
  results: Array<{ skuId: string; sku?: string; ok: boolean; skipped?: string; error?: string }>;
}

export interface VariantRaiseDeps {
  enabled: boolean;
  send: (raises: VariantRaise[]) => Promise<VariantSendResult>;
  // Nur die tatsächlich angehobenen Einträge (skuId → neuer VK). Der Aufrufer MERGT gegen den frischen DB-Stand der Spalte (nicht gegen den
  // Snapshot vom Lauf-Anfang), damit z. B. ein zwischenzeitlicher Stufenwechsel nicht überschrieben wird.
  store: (updates: Record<string, number>) => Promise<void>;
  log: (msg: string) => void;
  heldSkuIds?: ReadonlySet<string>; // K-008: "Preis halten" (nur Varianten mit Gewinn ≥ 0,90 €)
}

export type VariantRaiseStatus = 'disabled' | 'not_live' | 'nothing' | 'ambiguous' | 'sent' | 'partial' | 'failed' | 'error';
export interface VariantRaiseOutcome { status: VariantRaiseStatus; raises: VariantRaise[]; sentSkuIds: string[]; jumps?: VariantRaise[] }


export async function runVariantRaise(product: VariantRaiseProduct, deps: VariantRaiseDeps): Promise<VariantRaiseOutcome> {
  const live = product.ebayStatus === 'listed' && !!product.ebayListingId;
  if (!live) return { status: 'not_live', raises: [], sentSkuIds: [] };
  const planned = planVariantRaises(product, deps.heldSkuIds);
  for (const k of deps.heldSkuIds ?? []) deps.log(`[K-008] stele-${product.id} Variante ${k}: Preis gehalten — nicht angehoben`);
  // OFFEN 010: Anhebung um mehr als 15 % nie automatisch senden — Meldung "PREISSPRUNG", nichts gesendet/gespeichert.
  const jumps = planned.filter(r => isPriceJump(r.oldSell, r.newSell));
  for (const r of jumps) deps.log(`[VariantRaise] ⚠️ ${priceJumpMessage(product.id, `${r.label || r.skuId} (skuId ${r.skuId})`, r.oldSell, r.newSell)}`);
  const raises = planned.filter(r => !jumps.includes(r));
  if (raises.length === 0) return { status: 'nothing', raises, sentSkuIds: [], jumps };

  const describe = (r: VariantRaise) => `${r.label || r.skuId} (skuId ${r.skuId}): ${fmt(r.oldSell)} → ${fmt(r.newSell)} € (EK ${fmt(r.ware)}, Gewinn ${fmt(r.oldProfit)} → ${fmt(r.newProfit)} €)`;

  // Schalter AUS: nur beobachten (Log), 0 Sende-/Speicher-Aufrufe.
  if (!deps.enabled) {
    for (const r of raises) deps.log(`[VariantRaise AUS] stele-${product.id} würde anheben: ${describe(r)}`);
    return { status: 'disabled', raises, sentSkuIds: [], jumps };
  }

  try {
    const res = await deps.send(raises);
    if (!res.resolved) {
      deps.log(`[VariantRaise] stele-${product.id}: SKU-Zuordnung nicht eindeutig — NICHTS getan. ${res.reason ?? ''}`);
      return { status: 'ambiguous', raises, sentSkuIds: [] };
    }
    const okIds = new Set<string>();
    for (const r of raises) {
      const x = res.results.find(y => y.skuId === r.skuId);
      if (x?.ok && !x.skipped) { okIds.add(r.skuId); deps.log(`[VariantRaise] stele-${product.id} ANGEHOBEN ${describe(r)}`); }
      else deps.log(`[VariantRaise] stele-${product.id} NICHT angehoben ${describe(r)} — ${x?.skipped ?? x?.error ?? 'kein Ergebnis'}${x?.skipped ? ' (App-Preis weicht von eBay ab — bitte im Produkte-Tab abgleichen)' : ''}`);
    }
    if (okIds.size === 0) return { status: 'failed', raises, sentSkuIds: [] };
    // Speichern erst nach Erfolg und nur für die tatsächlich gesendeten Varianten.
    const updates: Record<string, number> = {};
    for (const r of raises) if (okIds.has(r.skuId)) updates[r.skuId] = r.newSell;
    await deps.store(updates);
    return { status: okIds.size === raises.length ? 'sent' : 'partial', raises, sentSkuIds: [...okIds], jumps };
  } catch (e) {
    deps.log(`[VariantRaise] stele-${product.id}: Fehler — ${String(e)} (App-Preise nicht gespeichert, eBay-Stand ggf. teilweise geändert, bitte prüfen)`);
    return { status: 'error', raises, sentSkuIds: [] };
  }
}
