// EAN-Merkmal prüfen (Live-Fund stele-228, 19.10.2026): im Pflichtfeld „EAN" stand die Kategorie-Nummer „101406" (von Hand in
// manualAspects eingetragen) → eBay zeigte EAN 101406. Gültig sind nur echte GTIN-Nummern (8/12/13/14 Ziffern mit GS1-Prüfziffer)
// oder der für eBay.de vorgeschriebene Ersatztext „Nicht zutreffend". Alles andere wird zu „Nicht zutreffend". REINE Funktionen.
export const IDENTIFIER_NOT_APPLICABLE = 'Nicht zutreffend';
const IDENTIFIER_NAMES = new Set(['EAN', 'GTIN', 'UPC', 'ISBN']);

export function isValidGtin(v: string): boolean {
  const s = v.trim();
  if (!/^\d+$/.test(s) || ![8, 12, 13, 14].includes(s.length)) return false;
  const digits = s.split('').map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((a, d, i) => a + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

export function isValidIdentifierValue(v: string): boolean {
  return v.trim() === IDENTIFIER_NOT_APPLICABLE || isValidGtin(v);
}

/** Ersetzt ungültige EAN/GTIN/UPC/ISBN-Werte durch „Nicht zutreffend". `changed` nennt die ersetzten Werte. */
export function fixIdentifierAspects(aspects: Record<string, string[]> | undefined | null): { aspects: Record<string, string[]>; changed: string[] } {
  const out: Record<string, string[]> = { ...(aspects ?? {}) };
  const changed: string[] = [];
  for (const [name, values] of Object.entries(out)) {
    if (!IDENTIFIER_NAMES.has(name) || !Array.isArray(values)) continue;
    const bad = values.filter(v => !isValidIdentifierValue(String(v)));
    if (bad.length === 0) continue;
    changed.push(`${name}: ${bad.join(', ')}`);
    const good = values.filter(v => isValidIdentifierValue(String(v)));
    out[name] = good.length > 0 ? good : [IDENTIFIER_NOT_APPLICABLE];
  }
  return { aspects: out, changed };
}
