// K-009 (Kalkulator 15.10.2026): Auswahl des Anzeigensatzes im Listings-Tab. "0 % (aus)" steht zuerst — unbeworbene Angebote
// (stele-220, stele-97) müssen mit 0 % gerechnet werden. null = nicht gesetzt (Formel rechnet dann mit dem Standard 5 %),
// wird aber als "—" gezeigt statt fälschlich als 5 %. Ein gespeicherter Sonderwert (z. B. 4) bleibt sichtbar statt still auf
// die erste Option zu springen.
export const AD_RATE_OPTIONS: readonly number[] = [0, 2, 3, 5, 8, 10];

export function adRateOptions(current: number | null | undefined): number[] {
  if (current == null || AD_RATE_OPTIONS.includes(current)) return [...AD_RATE_OPTIONS];
  return [...AD_RATE_OPTIONS, current].sort((a, b) => a - b);
}

export function adRateLabel(rate: number | null | undefined): string {
  if (rate == null) return '—';
  return rate === 0 ? '0 % (aus)' : `${rate}%`;
}
