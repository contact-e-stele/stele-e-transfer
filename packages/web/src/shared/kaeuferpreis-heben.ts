// AUFTRAG Kalkulator an 7 App – 162/208 (09.11.2026 07:00): "Käuferpreis auf Angebotsdaten heben" — Gegenstück zu "Angleichen"
// (K-011 Punkt 4, align-offers-to-buyer-price). Lage: die Anhebung hat die Inventory-Angebotsdaten (Offer) geschrieben, eBay hat den
// sichtbaren Käuferpreis (GetItem StartPrice) aber NICHT übernommen (stele-162 "10": Käufer 15,45 / Offer 16,45; stele-208 SILVER:
// Käufer 16,95 / Offer 17,45; bei 208 eBay-Fehler 25019). K-011 sperrt zu Recht. "Angleichen" würde das Offer auf den ALTEN, niedrigeren
// Preis zurücksetzen — hier die falsche Richtung.
//
// Regeln je SKU — ALLE müssen gelten, sonst wird die SKU übersprungen und der Grund gemeldet:
//  (a) Angebotsdaten > Käuferpreis (nur nach oben)
//  (b) Angebotsdaten == Zielpreis der App (planTierReprice, Formel v2, Ziel des Produkts) ± 0,01 €
//  (c) Sprung ≤ 15 % gegenüber dem Käuferpreis (OFFEN 010, isPriceJump — eine Quelle)
// Zusätzlich (nicht im Auftrag, offengelegt): "Preis halten" (K-008) aktiv → übersprungen; unbekannte Preise → übersprungen (nichts geraten).
// REINE Funktionen (Grundgesetz 2) — kein DB-, kein eBay-Zugriff.
import { PRICE_MISMATCH_TOLERANCE_EUR } from './ebay-buyer-price';
import { isPriceJump, MAX_AUTO_RAISE_PCT } from './price-jump';
import { expectedKey, type TierPlan } from './tier-reprice';

export const RAISE_TARGET_TOLERANCE_EUR = 0.01;
const EPS = 1e-9;

export interface RaiseBuyerInputRow {
  skuId: string | null;        // null = Einzelartikel
  sku: string;                 // eBay-SKU (stele-…)
  label: string;
  buyerPrice: number | null;   // Käuferpreis (GetItem StartPrice) — was der Käufer sieht
  offerPrice: number | null;   // Angebotsdaten (Inventory offer.pricingSummary)
  targetVk: number | null;     // Zielpreis der App (planTierReprice newSell); null = ohne EK → nichts geraten
  held?: boolean;              // "Preis halten" aktiv
}

export type RaiseBuyerStatus = 'heben' | 'gleich' | 'uebersprungen';
export type RaiseSkipCode = 'unbekannt' | 'nicht_hoeher' | 'kein_ziel' | 'ziel_abweichend' | 'preissprung' | 'gehalten';

export interface RaiseBuyerAction extends RaiseBuyerInputRow {
  status: RaiseBuyerStatus;
  to: number | null;           // neuer Käuferpreis (= Angebotsdaten) bei 'heben'
  jumpPct: number | null;      // (Offer / Käufer − 1) × 100, gerundet auf 2 Stellen
  code?: RaiseSkipCode;
  grund?: string;
}

const f2 = (n: number) => n.toFixed(2).replace('.', ',');
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Plan je SKU. Reihenfolge der Prüfungen: Preise lesbar → gleich? → (a) → "Preis halten" → (b) → (c). */
export function planBuyerPriceRaise(rows: RaiseBuyerInputRow[]): { actions: RaiseBuyerAction[]; raiseCount: number; skipCount: number } {
  const actions: RaiseBuyerAction[] = rows.map(row => {
    const base = { ...row, to: null, jumpPct: null };
    const skip = (code: RaiseSkipCode, grund: string, extra: Partial<RaiseBuyerAction> = {}): RaiseBuyerAction =>
      ({ ...base, ...extra, status: 'uebersprungen', code, grund });
    const { buyerPrice: buyer, offerPrice: offer, targetVk } = row;
    if (buyer == null || offer == null) return skip('unbekannt', `Preis nicht lesbar (Käufer ${buyer == null ? '–' : f2(buyer)}, Angebotsdaten ${offer == null ? '–' : f2(offer)}) — nichts geraten`);
    const jumpPct = buyer > 0 ? r2((offer / buyer - 1) * 100) : null;
    if (Math.abs(offer - buyer) <= PRICE_MISMATCH_TOLERANCE_EUR + EPS) return { ...base, jumpPct, status: 'gleich' };
    if (!(offer > buyer + PRICE_MISMATCH_TOLERANCE_EUR + EPS)) {
      return skip('nicht_hoeher', `(a) nur anheben: Angebotsdaten ${f2(offer)} € liegen UNTER dem Käuferpreis ${f2(buyer)} € — dafür "Angleichen"`, { jumpPct });
    }
    if (row.held) return skip('gehalten', '"Preis halten" aktiv (K-008) — Käuferpreis nicht geändert', { jumpPct });
    if (targetVk == null) return skip('kein_ziel', '(b) kein Zielpreis der App (ohne Einkaufspreis) — nichts geraten', { jumpPct });
    if (Math.abs(offer - targetVk) > RAISE_TARGET_TOLERANCE_EUR + EPS) {
      return skip('ziel_abweichend', `(b) Angebotsdaten ${f2(offer)} € ≠ Zielpreis der App ${f2(targetVk)} € (± 0,01) — nicht gesendet`, { jumpPct });
    }
    if (isPriceJump(buyer, offer)) {
      return skip('preissprung', `(c) Preissprung +${jumpPct?.toFixed(2).replace('.', ',')} % > ${MAX_AUTO_RAISE_PCT} % gegenüber Käuferpreis ${f2(buyer)} € (OFFEN 010) — bitte prüfen`, { jumpPct });
    }
    return { ...base, jumpPct, status: 'heben', to: offer };
  });
  return { actions, raiseCount: actions.filter(a => a.status === 'heben').length, skipCount: actions.filter(a => a.status === 'uebersprungen').length };
}

/** Zielpreis je Zeile aus dem Plan von planTierReprice (Varianten: skuId; Einzelartikel: die eine Zeile, skuId null). */
export function targetVkFor(plan: TierPlan, skuId: string | null): number | null {
  const row = plan.rows.find(r => expectedKey(r.skuId) === expectedKey(skuId));
  return row ? row.newSell : null;
}

/** Log-Zeile je übersprungener SKU (Pflicht laut Auftrag Punkt 4). */
export function skipLogLine(productId: number, a: RaiseBuyerAction): string {
  return `[Käuferpreis heben] stele-${productId} ${a.sku}: übersprungen [${a.code}] — ${a.grund}`;
}

// Bestätigung aus der Vorschau: { sku: neuer Käuferpreis }. Beim Senden wird neu gerechnet; weicht der Plan ab → nichts senden.
export function expectedFromRaisePlan(actions: RaiseBuyerAction[]): Record<string, number> {
  return Object.fromEntries(actions.filter(a => a.status === 'heben' && a.to != null).map(a => [a.sku, a.to as number]));
}
export function compareRaiseExpected(actions: RaiseBuyerAction[], expected: Record<string, number> | undefined): string | null {
  if (!expected) return null;
  const now = expectedFromRaisePlan(actions);
  for (const k of new Set([...Object.keys(now), ...Object.keys(expected)])) {
    if (now[k] == null || expected[k] == null || Math.round(now[k] * 100) !== Math.round(expected[k] * 100)) {
      return `Der Plan hat sich seit der Vorschau geändert (${k}: bestätigt ${expected[k] ?? '–'}, jetzt ${now[k] ?? '–'}) — bitte Vorschau neu laden.`;
    }
  }
  return null;
}

export type RaiseBuyerBodyParse = { ok: true; expected?: Record<string, number> } | { ok: false; error: string };
/** POST-Body: confirm === true Pflicht (strikt), expected optional { sku: Preis }. */
export function parseRaiseBuyerBody(body: unknown): RaiseBuyerBodyParse {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'confirm: true fehlt — nichts gesendet' };
  const b = body as Record<string, unknown>;
  if (b.confirm !== true) return { ok: false, error: 'confirm: true fehlt — nichts gesendet' };
  if (b.expected === undefined) return { ok: true };
  const e = b.expected;
  if (!e || typeof e !== 'object' || Array.isArray(e) || !Object.values(e as Record<string, unknown>).every(v => typeof v === 'number' && Number.isFinite(v))) {
    return { ok: false, error: '"expected" muss { sku: Preis } sein' };
  }
  return { ok: true, expected: e as Record<string, number> };
}

/**
 * Nach dem Senden: Käuferpreis frisch per GetItem zurückgelesen. Bestätigt ist eine SKU nur, wenn der gelesene Käuferpreis dem gesendeten
 * Preis entspricht (± 0,01). Sperre aufheben nur, wenn danach bei ALLEN bei eBay angebotenen Varianten (Käuferpreis gelesen) die
 * Angebotsdaten lesbar und gleich sind (strenger als priceMismatches: unlesbare Angebotsdaten zählen als "nicht gleich", wie bei "Angleichen").
 */
export function evaluateRaiseReadback(
  sent: Array<{ sku: string; skuId: string | null; to: number; ok: boolean }>,
  after: Array<{ sku: string; buyerPrice: number | null; offerPrice: number | null }>,
): { confirmed: Array<{ sku: string; skuId: string | null; price: number }>; notConfirmed: Array<{ sku: string; reason: string }>; liftLock: boolean; stillMismatched: typeof after } {
  const confirmed: Array<{ sku: string; skuId: string | null; price: number }> = [];
  const notConfirmed: Array<{ sku: string; reason: string }> = [];
  for (const s of sent) {
    const a = after.find(x => x.sku === s.sku);
    if (!s.ok) { notConfirmed.push({ sku: s.sku, reason: 'eBay hat das Senden abgelehnt' }); continue; }
    if (!a || a.buyerPrice == null) { notConfirmed.push({ sku: s.sku, reason: 'Käuferpreis nach dem Senden nicht lesbar' }); continue; }
    if (Math.abs(a.buyerPrice - s.to) > PRICE_MISMATCH_TOLERANCE_EUR + EPS) {
      notConfirmed.push({ sku: s.sku, reason: `Käuferpreis nach dem Senden ${f2(a.buyerPrice)} € statt ${f2(s.to)} € — eBay hat nicht übernommen` });
      continue;
    }
    confirmed.push({ sku: s.sku, skuId: s.skuId, price: s.to });
  }
  // Wie "Angleichen": maßgeblich sind die Varianten, die eBay im GetItem anbietet (Käuferpreis gelesen). Zeilen ohne Käuferpreis (z. B. nicht
  // in der eBay-Gruppe) blockieren die Aufhebung nicht; ist dort aber die Angebotsdaten-Seite unlesbar → bleibt gesperrt.
  const offered = after.filter(r => r.buyerPrice != null);
  const stillMismatched = offered.filter(r => r.offerPrice == null || Math.abs((r.buyerPrice as number) - r.offerPrice) > PRICE_MISMATCH_TOLERANCE_EUR + EPS);
  return { confirmed, notConfirmed, liftLock: offered.length > 0 && stillMismatched.length === 0, stillMismatched };
}

// ─── Trading API ReviseInventoryStatus (Preis je SKU) — XML bauen / Antwort lesen, rein ─────────────────────────────────────────
const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Varianten: ItemID + SKU + StartPrice. Einzelartikel (sku null): ItemID + StartPrice (wie updateEbayPriceTrading). */
export function buildReviseInventoryStatusPriceXml(token: string, itemId: string, sku: string | null, price: number): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<ReviseInventoryStatusRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${token}</eBayAuthToken></RequesterCredentials>
  <InventoryStatus>
    <ItemID>${xmlEscape(itemId)}</ItemID>${sku ? `\n    <SKU>${xmlEscape(sku)}</SKU>` : ''}
    <StartPrice>${price.toFixed(2)}</StartPrice>
  </InventoryStatus>
</ReviseInventoryStatusRequest>`;
}

/** Ack Failure → Fehler mit eBay-Fehlercode(s) und LongMessage. Warning/Success → ok (Warnungen werden mitgegeben). */
export function parseTradingAck(xml: string): { ok: boolean; ack: string | null; errorCodes: string[]; message: string | null } {
  const ack = xml.match(/<Ack>([^<]*)<\/Ack>/)?.[1] ?? null;
  const errorCodes = [...xml.matchAll(/<ErrorCode>([^<]*)<\/ErrorCode>/g)].map(m => m[1]);
  const message = xml.match(/<LongMessage>([^<]*)<\/LongMessage>/)?.[1] ?? null;
  return { ok: ack === 'Success' || ack === 'Warning', ack, errorCodes, message };
}
