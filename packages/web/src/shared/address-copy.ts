// Bestellungen-Tab (Inhaber 30.10.2026): drei Kopier-Knöpfe für die AliExpress-Bestellung — Name, Telefon, Adresse.
// Inhaber: "Adresse kann man in einem kopieren, Name Vorname auch, Tel. kannst du so lassen".
export interface ShippingAddressLite {
  fullName: string; addressLine1: string; addressLine2: string | null; city: string; postalCode: string; phone: string | null;
}

/** Texte für die drei Knöpfe; leere Teile → null (Knopf wird dann nicht gezeigt). Telefon unverändert wie von eBay. */
export function addressCopyParts(a: ShippingAddressLite): { name: string | null; phone: string | null; address: string | null } {
  const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
  const street = [clean(a.addressLine1), clean(a.addressLine2)].filter(Boolean).join(', ');
  const place = [clean(a.postalCode), clean(a.city)].filter(Boolean).join(' ');
  const address = [street, place].filter(Boolean).join(', ');
  return { name: clean(a.fullName) || null, phone: clean(a.phone) || null, address: address || null };
}
