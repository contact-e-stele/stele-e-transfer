// Fix stele-251 (Live-Fund 09.11.2026, "7 App 09:45 – 251 FUND"): für 251 lieferte die DS-API nichts, der HTML-Scraper (Fallback)
// lieferte nur den Seitenpreis "73.77 €", shipsFrom "Unknown" und KEINE Varianten-Preise. Der Preislauf nahm dann 73,77 € als Ab-Preis
// (falsch: das ist kein Einkaufspreis einer bestimmten Variante) und rechnete mit 'Unknown' als Herkunft (überschrieb die gespeicherte).
// REINE Funktionen (Grundgesetz 2) — welche AliExpress-Daten im Preislauf als "frisch und brauchbar" gelten.

export interface AliDataLike {
  price?: string | null;
  shipsFrom?: string | null;
  variantPrices?: Array<{ price?: number | null }> | null;
}

export type AliDataUsability =
  | { usable: true }
  | { usable: false; reason: string };

/** Anzahl Varianten-Einträge mit gültigem Preis (> 0). */
export function countPricedVariants(data: AliDataLike | null | undefined): number {
  return (data?.variantPrices ?? []).filter(v => typeof v?.price === 'number' && Number.isFinite(v.price) && v.price > 0).length;
}

/**
 * Varianten-Produkt: AliExpress-Daten ohne einen einzigen Varianten-Preis zählen als "keine AliExpress-Daten" — der Seitenpreis
 * wird NICHT als Ab-Preis genommen und eine leere Liste wird nicht gemergt; der Lauf geht den Weg "gespeicherter Einkaufspreis".
 * Einzelartikel: unverändert (Seitenpreis ist dort der Einkaufspreis).
 */
export function aliDataUsability(isVariant: boolean, data: AliDataLike | null | undefined): AliDataUsability {
  if (!data) return { usable: false, reason: 'keine AliExpress-Daten (DS-API und Scraper)' };
  if (isVariant && countPricedVariants(data) === 0) {
    return { usable: false, reason: `AliExpress-Daten ohne Varianten-Preise (Seitenpreis ${data.price ?? '–'}, Versand ab ${data.shipsFrom ?? '–'}) — Seitenpreis wird nicht als Einkaufspreis genommen` };
  }
  return { usable: true };
}

/** true = der Scraper kennt das Versandland nicht ('', 'Unknown', 'unbekannt' — HTML-Fallback in aliexpress.ts liefert 'Unknown'). */
export function isUnknownShipsFrom(v: string | null | undefined): boolean {
  const s = (v ?? '').trim().toLowerCase();
  return !s || s === 'unknown' || s === 'unbekannt';
}

/** Herkunft für die Rechnung: bekanntes Versandland aus AliExpress, sonst das GESPEICHERTE (K-004); beides unbekannt → was da ist. */
export function effectiveShipsFrom(scraped: string | null | undefined, stored: string | null | undefined): string | null {
  if (!isUnknownShipsFrom(scraped)) return (scraped as string);
  if (!isUnknownShipsFrom(stored)) return stored as string;
  return (stored ?? scraped ?? null) || null;
}
