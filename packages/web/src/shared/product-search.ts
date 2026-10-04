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
