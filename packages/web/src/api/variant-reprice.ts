// OFFEN 033: Orchestrierung "Auswahl senken" für POST /products/variant-reprice. Ohne direkte DB-/eBay-Importe — Senden, Speichern und
// Zurücklesen kommen als `deps` (index.ts verdrahtet die echten Funktionen), damit alle Regeln mit Mocks testbar sind (Grundgesetz 2).
// Ablauf (Regeln 5–7): nur die geprüften Zeilen (status ok) senden → App-Preise NUR bei vollem Erfolg speichern (wie A-021) → eBay
// zurücklesen und je Variante "eBay = App" melden. Ob eBay überhaupt berührt werden darf: decideTierRepriceAction (eine Entscheidungsstelle).
import { planVariantDecrease, type VariantRepriceMode, type VariantRepriceRow } from '../shared/variant-reprice';
import { decideTierRepriceAction, type RepriceProduct } from '../shared/tier-reprice';
import { parseVariantSellPrices, serializeVariantSellPrices } from '../shared/pricing';
import type { VariantGroup, VariantPriceEntry } from '../shared/variant-resolver';
import type { VariantSendResult } from './variant-raise';
import { isLiveListed, parseGroups } from './tier-reprice';

export interface VariantRepriceProductRow extends RepriceProduct {
  generatedTitle: string;
  variants: string | null;
  ebayStatus: string;
  ebayListingId: string | null;
}

export interface VariantRepriceDeps {
  heldSkuIds: (product: VariantRepriceProductRow) => Promise<ReadonlySet<string>>;
  send: (productId: number, groups: VariantGroup[], entries: VariantPriceEntry[], changes: Array<{ skuId: string; newSell: number }>) => Promise<VariantSendResult>;
  store: (productId: number, variantSellPrices: string) => Promise<void>;
  readBack: (product: VariantRepriceProductRow) => Promise<{ ok: boolean; reason?: string; prices: Record<string, number | null> }>;
}

export type VariantRepriceOutcome = 'preview' | 'stored' | 'sent' | 'send_failed' | 'sent_not_stored' | 'nothing_to_do' | 'rejected' | 'not_found';

export interface VariantRepriceResultRow extends VariantRepriceRow {
  ergebnis?: 'gesetzt' | 'nicht gesendet' | 'übersprungen';
  ebay?: number | null;            // zurückgelesener Käuferpreis
  ebayGleichApp?: boolean;
}

export interface VariantRepriceResult {
  productId: number;
  title: string;
  isLive: boolean;
  status: VariantRepriceOutcome;
  rows: VariantRepriceResultRow[];
  error?: string;
  rueckgelesen?: { ok: boolean; reason?: string };
}

export async function runVariantReprice(
  product: VariantRepriceProductRow | undefined,
  input: { productId: number; prices: Record<string, number>; mode: VariantRepriceMode; confirm: boolean; sendToEbay: boolean },
  deps: VariantRepriceDeps,
): Promise<VariantRepriceResult> {
  if (!product) return { productId: input.productId, title: '', isLive: false, status: 'not_found', rows: [], error: 'Produkt nicht gefunden' };
  const isLive = isLiveListed(product);
  const base = { productId: product.id, title: product.generatedTitle, isLive };
  const groups = parseGroups(product.variants) as VariantGroup[];
  const held = await deps.heldSkuIds(product);
  const plan = planVariantDecrease(product, input.prices, groups, held);
  const rows: VariantRepriceResultRow[] = plan.rows.map(r => ({ ...r }));
  const okRows = rows.filter(r => r.status === 'ok');

  const decision = decideTierRepriceAction({ mode: input.mode, confirm: input.confirm, sendToEbay: input.sendToEbay, isLive });
  if (decision.action === 'preview') return { ...base, status: 'preview', rows };
  if (decision.action === 'rejected') return { ...base, status: 'rejected', rows, error: decision.error };
  if (okRows.length === 0) return { ...base, status: 'nothing_to_do', rows, error: 'Keine Zeile erfüllt die Regeln — nichts gesendet, nichts gespeichert.' };

  const merged = parseVariantSellPrices(product.variantSellPrices);
  for (const r of okRows) merged[r.skuId] = r.neu;
  const json = serializeVariantSellPrices(Object.entries(merged).map(([skuId, sellPrice]) => ({ skuId, sellPrice })));

  if (decision.action === 'store_only') {
    await deps.store(product.id, json);
    for (const r of okRows) r.ergebnis = 'gesetzt';
    return { ...base, status: 'stored', rows };
  }

  // store_and_send: erst eBay, nur die geprüften Zeilen.
  let entries: VariantPriceEntry[] = [];
  try { const pv = product.variantPrices ? JSON.parse(product.variantPrices) : []; entries = Array.isArray(pv) ? pv : []; } catch { entries = []; }
  let sent: VariantSendResult;
  try {
    sent = await deps.send(product.id, groups, entries, okRows.map(r => ({ skuId: r.skuId, newSell: r.neu })));
  } catch (e) {
    for (const r of okRows) r.ergebnis = 'nicht gesendet';
    return { ...base, status: 'send_failed', rows, error: 'Senden an eBay fehlgeschlagen: ' + String(e) + ' — App-Preise NICHT gespeichert (eBay-Stand unklar, bitte zurücklesen).' };
  }
  if (!sent.resolved) {
    for (const r of okRows) r.ergebnis = 'nicht gesendet';
    return { ...base, status: 'send_failed', rows, error: `Zuordnung nicht eindeutig — nichts gesendet, nichts gespeichert: ${sent.reason ?? ''}` };
  }
  for (const r of okRows) {
    const res = sent.results.find(x => x.skuId === r.skuId);
    if (res?.ok && !res.skipped) r.ergebnis = 'gesetzt';
    else if (res?.ok && res.skipped) { r.ergebnis = 'übersprungen'; r.grund = res.skipped; }
    else { r.ergebnis = 'nicht gesendet'; r.grund = res?.error ?? 'kein Ergebnis vom Senden'; }
  }
  // Regel 6: Speichern nur bei VOLLEM Erfolg (jede geprüfte Zeile wirklich gesetzt).
  if (okRows.some(r => r.ergebnis !== 'gesetzt')) {
    const n = okRows.filter(r => r.ergebnis === 'gesetzt').length;
    return { ...base, status: 'send_failed', rows, error: `${n} von ${okRows.length} Varianten bei eBay gesetzt — App-Preise NICHT gespeichert. Bereits gesetzte Preise stehen bei eBay: "App-Preise ← eBay" ausführen.` };
  }
  try { await deps.store(product.id, json); } catch (e) {
    return { ...base, status: 'sent_not_stored', rows, error: 'An eBay gesendet, aber App-Preise NICHT gespeichert (' + String(e) + ') — "App-Preise ← eBay" ausführen.' };
  }
  // Regel 7: zurücklesen. Ein Lesefehler macht das Senden nicht rückgängig, wird aber gemeldet.
  let rb: { ok: boolean; reason?: string; prices: Record<string, number | null> };
  try { rb = await deps.readBack(product); } catch (e) { rb = { ok: false, reason: String(e), prices: {} }; }
  for (const r of okRows) {
    const e = rb.prices[r.skuId];
    r.ebay = e ?? null;
    r.ebayGleichApp = e != null && Math.abs(e - r.neu) < 0.005;
  }
  return { ...base, status: 'sent', rows, rueckgelesen: { ok: rb.ok, reason: rb.reason } };
}
