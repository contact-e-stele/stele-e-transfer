// OFFEN 017 (stele-243, 29.10.2026): Ein live gelistetes Produkt (ebayListingId gesetzt, eBay aktiv 198755130523) stand plötzlich auf
// "Nicht gelistet" mit Knopf "Bei eBay listen" — App-Datensatz: ebayStatus 'none', ebayListingId noch 198755130523 (updatedAt 18:32:36).
// Nur zwei Code-Stellen setzen 'none' OHNE die eBay-Nr zu löschen: POST /products/:id/reset-error ("Fehler zurücksetzen") und
// PATCH /products/:id mit manualAspects (Pflichtfeld nachgetragen). Beide liefen aus einer veralteten Ansicht (zweites Gerät) blind.
// Regel (rein): Hat ein Produkt eine eBay-Nr, bleibt bzw. wird der Status 'listed' — Fehler werden nur geleert.

export type EbayStatus = 'none' | 'listed' | 'error' | string | null;

/** Status nach "Fehler zurücksetzen" / nach behobenem Pflichtfeld. */
export function statusAfterErrorCleared(current: { ebayStatus: EbayStatus; ebayListingId: string | null }): 'listed' | 'none' {
  return current.ebayListingId ? 'listed' : 'none';
}
