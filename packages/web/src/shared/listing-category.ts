// OFFEN 020 Befund 2 (02.11.2026, stele-248 Hausschuhe): ohne eigene Kategorie fiel das Listen still auf die feste
// Kategorie 79720 zurück — die eBay-Kategorie-Vorschläge für Hausschuhe ("Schuhe") werden im Vorschlag als
// "junk" verworfen, also null → 79720 → fremdes Pflichtmerkmal "Rahmenfarbe". Jetzt: keine geratene Kategorie mehr.

export type ListingCategory =
  | { ok: true; categoryId: string; source: 'produkt' | 'vorschlag' }
  | { ok: false; error: string };

export const CATEGORY_MISSING_MESSAGE =
  'Keine eBay-Kategorie: im Produkt ist keine hinterlegt und eBay schlägt keine passende vor. Bitte im Produkte-Tab eine Kategorie wählen — es wird keine Ersatz-Kategorie geraten.';

/** Kategorie fürs Listen/Prüfen: eigene des Produkts, sonst eBay-Vorschlag, sonst Fehler (nie eine feste Ersatz-Kategorie). */
export function resolveListingCategory(productCategory: string | null | undefined, suggested: string | null | undefined): ListingCategory {
  const own = (productCategory ?? '').trim();
  if (own) return { ok: true, categoryId: own, source: 'produkt' };
  const sug = (suggested ?? '').trim();
  if (sug) return { ok: true, categoryId: sug, source: 'vorschlag' };
  return { ok: false, error: CATEGORY_MISSING_MESSAGE };
}

/** Letzte Verteidigung in listOnEbay: ohne Kategorie wird nicht gesendet (früher stiller Ersatz 79720). */
export function requireCategoryId(categoryId: string | null | undefined): string {
  const id = (categoryId ?? '').trim();
  if (!id) throw new Error(CATEGORY_MISSING_MESSAGE);
  return id;
}
