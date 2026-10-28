// Suche im Produkte-Tab: Titel (generiert + Original) und Produktnummer.
// Nummer: "71", "stele-71" oder "stele 71" trifft genau Produkt 71 (nicht 171).

export interface SearchableProduct {
  id: number;
  title: string;
  generatedTitle: string;
}

const NUMBER_QUERY = /^(?:stele[-\s]?)?(\d+)$/;

export function matchesProductSearch(p: SearchableProduct, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  const num = NUMBER_QUERY.exec(q);
  if (num && Number(num[1]) === p.id) return true;
  return (p.generatedTitle ?? "").toLowerCase().includes(q) || (p.title ?? "").toLowerCase().includes(q);
}

/** Import-Tab „Bereits importiert“ (Inhaber 28.10.2026): Link in den Produkte-Tab mit vorausgefüllter Suche. */
export function produkteSearchHref(productId: number): string {
  return `/produkte?suche=stele-${productId}`;
}

/** Produkte-Tab: Suchbegriff aus "?suche=…" (leer, wenn nicht gesetzt). */
export function searchFromQuery(query: string): string {
  return (new URLSearchParams(query).get("suche") ?? "").trim().slice(0, 100);
}
