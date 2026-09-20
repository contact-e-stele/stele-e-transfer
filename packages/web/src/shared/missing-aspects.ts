// P-88 Nacharbeit Punkt 2 (20.09.2026): mehrere gleichzeitig fehlende eBay-Pflichtmerkmale werden
// kommagetrennt in products.ebayMissingAspect gespeichert (keine DB-Migration). Reine, von
// Frontend (produkte.tsx) UND Backend (index.ts PATCH /products/:id) geteilte Logik — vorher gab
// es nur EIN gespeichertes Feld, der Nutzer musste nach jedem einzeln ausgefüllten Feld erneut
// auf "Listen" klicken, um das nächste zu sehen (Grundgesetz Regel 8: einmal statt zweimal).
export function parseMissingAspectNames(raw: string | null | undefined): string[] {
  return (raw ?? '').split(',').map(s => s.trim()).filter(Boolean);
}

// Welche der aktuell gespeicherten fehlenden Namen sind nach dem Speichern der übergebenen
// manualAspects immer noch ohne nicht-leeren Wert?
export function stillMissingAspectNames(
  raw: string | null | undefined,
  manualAspects: Record<string, string> | null | undefined,
): string[] {
  return parseMissingAspectNames(raw).filter(n => !manualAspects?.[n]?.trim());
}
