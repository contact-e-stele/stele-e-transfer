// A-038 (AH-02): eine AliExpress-Bestellnummer ist NIE eine Sendungsnummer. Diese Regel existiert genau
// einmal (Grundgesetz 8) und wird vom Gmail-Parser, vom Tracking-Sync-Cron, von PATCH /order-notes
// und von der Vorschlags-Route genutzt. Reine Funktionen — kein DB-/Netz-Zugriff.

export const ALI_ORDER_ID_AS_TRACKING_ERROR = 'Sendungsnummer ist die AliExpress-Bestellnummer – nicht übernommen';

const norm = (s: string | null | undefined): string => (s ?? '').trim();

/** true, wenn `tracking` (getrimmt) gleich einer bekannten AliExpress-Bestellnummer ist. */
export function isAliOrderIdNotTracking(tracking: string | null | undefined, aliOrderIds: ReadonlyArray<string | null | undefined>): boolean {
  const t = norm(tracking);
  if (!t) return false;
  return aliOrderIds.some(id => norm(id) === t);
}

export interface TrackingGuardNote {
  ebayOrderId: string;
  aliexpressOrderId: string | null;
  trackingNumber: string | null;
  trackingEbaySubmitted?: boolean | null;
  createdAt?: string | null;
}

export interface AliAsTrackingFinding {
  ebayOrderId: string;
  trackingNumber: string;
  kind: 'eigene-bestellnummer' | 'bestellnummer-einer-anderen-bestellung';
  trackingEbaySubmitted: boolean | null;
  createdAt: string | null;
}

/**
 * Bericht (nur lesen): order_notes, bei denen die Sendungsnummer gleich der eigenen aliexpress_order_id
 * ODER gleich der aliexpress_order_id einer ANDEREN Bestellung ist.
 */
export function findAliAsTrackingNotes(notes: ReadonlyArray<TrackingGuardNote>): AliAsTrackingFinding[] {
  const out: AliAsTrackingFinding[] = [];
  for (const n of notes) {
    const t = norm(n.trackingNumber);
    if (!t) continue;
    let kind: AliAsTrackingFinding['kind'] | null = null;
    if (norm(n.aliexpressOrderId) === t) kind = 'eigene-bestellnummer';
    else if (notes.some(o => o.ebayOrderId !== n.ebayOrderId && norm(o.aliexpressOrderId) === t)) kind = 'bestellnummer-einer-anderen-bestellung';
    if (kind) out.push({ ebayOrderId: n.ebayOrderId, trackingNumber: t, kind, trackingEbaySubmitted: n.trackingEbaySubmitted ?? null, createdAt: n.createdAt ?? null });
  }
  return out;
}
