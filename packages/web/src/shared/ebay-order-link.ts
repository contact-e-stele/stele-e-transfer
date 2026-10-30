// Bestellungen-Tab (Inhaber 30.10.2026): Klick auf die Bestellnummer öffnet genau diese Bestellung bei eBay in neuem Tab.
// Live geprüft 30.10.2026: /sh/ord/details?orderid=09-15365-02551 leitet auf /mesh/ord/details ("Einzelheiten zum Kauf") mit dieser Bestellung.
/** eBay-Bestelldetails-Link für den Verkäufer; null, wenn keine Bestellnummer im eBay-Format (z. B. 09-15365-02551). */
export function ebayOrderDetailsUrl(orderId: string | null | undefined): string | null {
  const id = (orderId ?? '').trim();
  if (!/^\d{2}-\d{5}-\d{5}$/.test(id)) return null;
  return `https://www.ebay.de/sh/ord/details?orderid=${encodeURIComponent(id)}`;
}
