// R1 Sterne-Sperre (BESCHLUSS 18.10.2026 19:21, OFFEN 006 Teil 2): ein AliExpress-Artikel wird nur importiert, wenn seine
// Artikelbewertung mindestens `min` Sterne hat (Standard 4,2, einstellbar). REINE Funktion.
export const DEFAULT_MIN_RATING = 4.2;

export function ratingGate(rating: number | null | undefined, reviewCount: number | null | undefined, min = DEFAULT_MIN_RATING): { ok: boolean; reason: string | null } {
  const fmt = (n: number) => n.toFixed(1).replace('.', ',');
  if (typeof rating !== 'number' || !Number.isFinite(rating) || rating <= 0) {
    if (reviewCount === 0) return { ok: false, reason: `Keine Bewertungen — Import erst ab ${fmt(min)} Sternen.` };
    return { ok: false, reason: `Sterne nicht lesbar — Bewertung auf der AliExpress-Seite prüfen (mindestens ${fmt(min)}).` };
  }
  if (rating < min - 1e-9) return { ok: false, reason: `Nur ${fmt(rating)} Sterne — Import erst ab ${fmt(min)} Sternen.` };
  return { ok: true, reason: null };
}

export function parseMinRating(v: string | null | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 5 ? n : DEFAULT_MIN_RATING;
}
