// P71-B Teil 2, Regel 5: aspects.MPN ist öffentlich sichtbar und darf nie die AliExpress-Produkt-ID
// (Live-Fund 2026-09-28, Partner-ID im Angebot sichtbar) oder eine andere lange Zahl aus der
// AliExpress-URL sein. Reine Funktion (GRUNDGESETZ Regel 2), einzige Prüfstelle (Regel 8).

// AliExpress-Produkt-IDs haben 12–16 Stellen; ab 8 rein numerischen Stellen gilt ein MPN als ID-verdächtig.
/** true, wenn der Wert wie eine AliExpress-ID aussieht oder eine Zahl aus sourceUrl enthält. */
export function isForbiddenMpn(mpn: string, sourceUrl?: string | null): boolean {
  const value = mpn.trim();
  if (value === '') return true;
  if (/^\d{8,}$/.test(value)) return true;
  const digitRuns = (sourceUrl ?? '').match(/\d{5,}/g) ?? [];
  return digitRuns.some(run => value.includes(run));
}

/** Liefert den MPN nur, wenn er zulässig ist — sonst undefined (dann greift der Default "Nicht zutreffend"). */
export function safeMpn(mpn: string | undefined, sourceUrl?: string | null): string | undefined {
  return mpn !== undefined && !isForbiddenMpn(mpn, sourceUrl) ? mpn.trim() : undefined;
}
