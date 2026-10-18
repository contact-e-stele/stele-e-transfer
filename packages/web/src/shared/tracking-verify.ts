// Sendungsnummer bei eBay prüfen (18.10.2026): Vergleich App-Nummer ↔ von eBay gelesene Nummern. REINE Funktion.
// Vergleich ohne Leerzeichen/Bindestriche, Groß-/Kleinschreibung egal (eBay speichert die Nummer, wie sie übermittelt wurde).
export type TrackingVerifyResult = 'match' | 'missing' | 'different';

export const normalizeTracking = (t: string) => t.replace(/[\s-]/g, '').toUpperCase();

export function compareTracking(local: string, onEbay: Array<{ trackingNumber: string }>): TrackingVerifyResult {
  if (onEbay.length === 0) return 'missing';
  const want = normalizeTracking(local);
  return onEbay.some(f => normalizeTracking(f.trackingNumber) === want) ? 'match' : 'different';
}
