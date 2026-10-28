// A-019 Teil 2: Preisprüfung für Varianten-Produkte — liegt der Gewinn EINER Variante unter dem Boden der Stufe (Formel v2), wird NUR
// diese Variante angehoben (raise-only, nie senken). Neuer VK = planTierReprice-Preis dieser Variante (dieselbe Funktion wie Stufenwechsel/
// "Erwartet"). Senden je Variante über updateOfferPriceBySku (GET → PUT volles Offer), NIE der Einheitspreis-Weg. Speichern in
// variant_sell_prices erst nach Erfolg. Pflicht-Log je Anhebung. Hinter AUTO_VARIANT_RAISE_ENABLED (Default AUS).
//
// Bewusst ohne direkte DB-/eBay-Importe: Senden/Speichern/Log kommen als `deps` (Grundgesetz Regel 2 — mit Mocks testbar).
import { planTierReprice, type RepriceProduct, type TierPlanRow } from '../shared/tier-reprice';
import { profitFloorFor, effectiveProfitFloor, DEFAULT_PRICING_CONFIG } from '../shared/pricing';
import { isPriceJump, priceJumpMessage } from '../shared/price-jump';

export interface VariantRaiseProduct extends RepriceProduct {
  targetMarginEur: number | null;
  ebayStatus: string | null;
  ebayListingId: string | null;
}

export type VariantRaise = TierPlanRow & { skuId: string; oldSell: number; oldProfit: number }; // skuId, alter VK und alter Gewinn sind bekannt (Pflicht)

// Nur Zeilen mit bekanntem alten VK, Gewinn < Boden und höherem Formelpreis — nie senken, nie raten (kein alter VK → keine Zeile).
// K-008: heldSkuIds = gehaltene Varianten (Gewinn ≥ 0,90 €) — werden nicht angehoben.
export function planVariantRaises(product: VariantRaiseProduct, heldSkuIds?: ReadonlySet<string>): VariantRaise[] {
  const target = product.targetMarginEur ?? DEFAULT_PRICING_CONFIG.targetMarginEur;
  const floor = effectiveProfitFloor(profitFloorFor(target)); // K-006: dieselbe Grenze wie die Rundung (Boden − 0,10, nie unter 1,00)
  const plan = planTierReprice(product, target);
  if (!plan.isVariant) return [];
  return plan.rows.filter((r): r is VariantRaise =>
    r.skuId != null && r.oldSell != null && r.oldProfit != null
    && !(heldSkuIds?.has(r.skuId))
    && r.oldProfit < floor - 1e-9
    && r.newSell > r.oldSell + 0.004);
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

const fmt = (n: number) => n.toFixed(2);

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
