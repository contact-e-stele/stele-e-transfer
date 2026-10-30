// Bestellungen-Tab (Inhaber 30.10.2026): "Retoure: <Rücksendenummer>" an der Bestellung, Klick öffnet die Rückgabe bei eBay in neuem Tab.
// Live geprüft 30.10.2026: /rt/ReturnDetails?returnId=5332416921 zeigt genau diese Rückgabe (Bestellung 04-15332-43723).

/** eBay-Rückgabe-Link für den Verkäufer; null bei leerer/ungültiger Rücksendenummer (nur Ziffern). */
export function ebayReturnDetailsUrl(returnId: string | null | undefined): string | null {
  const id = (returnId ?? '').trim();
  if (!/^\d{6,}$/.test(id)) return null;
  return `https://www.ebay.de/rt/ReturnDetails?returnId=${id}`;
}

/** Rücksendenummern je eBay-Bestellnummer (eine Bestellung kann mehrere Rückgaben haben). */
export function returnIdsByOrderId(returns: ReadonlyArray<{ returnId?: string | null; orderId?: string | null }>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const r of returns) {
    const o = (r.orderId ?? '').trim(), id = (r.returnId ?? '').trim();
    if (!o || !id) continue;
    (out[o] ??= []).includes(id) || out[o].push(id);
  }
  return out;
}

/** Post-Order API verlangt "IAF <OAuth-User-Token>", nicht "Bearer" (developer.ebay.com/Devzone/post-order/concepts/MakingACall.html). */
export function postOrderAuthHeader(token: string): string {
  return `IAF ${token}`;
}

/** Hat diese Bestellung eine eBay-Rückgabe? (Filter "Retoure" im Bestellungen-Tab, Inhaber 30.10.2026) */
export function hasReturn(orderId: string | null | undefined, byOrder: Readonly<Record<string, string[]>>): boolean {
  return (byOrder[(orderId ?? '').trim()]?.length ?? 0) > 0;
}
