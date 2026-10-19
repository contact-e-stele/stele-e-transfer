// Sendungsnummer bei eBay prüfen (18.10.2026): Vergleich App-Nummer ↔ von eBay gelesene Nummern. REINE Funktion.
// Vergleich ohne Leerzeichen/Bindestriche, Groß-/Kleinschreibung egal (eBay speichert die Nummer, wie sie übermittelt wurde).
// Hermes (19.10.2026, Bestellung 01-15317-84805): dieselbe Hermes-Nummer steht mal mit, mal ohne vorangestelltes "H".
// Nur wenn der Versender Hermes ist (App-Notiz oder eBay-Fulfillment) gilt "H" + Ziffern = dieselben Ziffern.
export type TrackingVerifyResult = 'match' | 'missing' | 'different';

export const normalizeTracking = (t: string) => t.replace(/[\s-]/g, '').toUpperCase();

export const isHermes = (carrier: string | null | undefined) => (carrier ?? '').trim().toUpperCase().startsWith('HERMES');

// "H12345" → "12345"; alles andere unverändert (nur ein einzelnes H vor reinen Ziffern).
export const stripHermesH = (normalized: string) => (/^H\d+$/.test(normalized) ? normalized.slice(1) : normalized);

export function compareTracking(
  local: string,
  onEbay: Array<{ trackingNumber: string; carrier?: string | null }>,
  localCarrier?: string | null,
): TrackingVerifyResult {
  if (onEbay.length === 0) return 'missing';
  const want = normalizeTracking(local);
  return onEbay.some(f => {
    const got = normalizeTracking(f.trackingNumber);
    if (got === want) return true;
    if (!isHermes(localCarrier) && !isHermes(f.carrier)) return false;
    return stripHermesH(got) === stripHermesH(want);
  }) ? 'match' : 'different';
}
