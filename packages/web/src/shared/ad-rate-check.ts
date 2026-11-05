// K-017 Punkt 5 (Kalkulator 05.11.2026): täglicher Abgleich App-adRate ↔ eBay-Kampagne, Warnung als Kachel im Produkte-Tab.
// Reine Funktionen (Grundgesetz 2): Zusammenfassung des Abgleichs (compareAdRates) zum Speichern und zum Anzeigen. Geschrieben wird
// nur der Prüfbericht (app_settings 'ad_rate_check'), nie products.adRate und nie etwas bei eBay.
import type { AdRateCheckRow } from './promoted-status';

export const AD_RATE_CHECK_KEY = 'ad_rate_check';

export interface AdRateCheckReport {
  at: string;                    // ISO-Zeitpunkt des Laufs
  ok: boolean;                   // false = eBay nicht lesbar (error gesetzt), Abweichungen unbekannt
  error: string | null;
  geprueft: number;
  abweichend: Array<{ productId: number; ebayListingId: string; app: number | null; ebay: number | null; ebayKind: string }>;
}

export function summarizeAdRateCheck(rows: AdRateCheckRow[], at: string): AdRateCheckReport {
  return {
    at, ok: true, error: null, geprueft: rows.length,
    abweichend: rows.filter(r => r.differs || r.ebayKind === 'CPC')
      .map(r => ({ productId: r.productId, ebayListingId: r.ebayListingId, app: r.storedAdRate, ebay: r.ebayAdRate, ebayKind: r.ebayKind })),
  };
}

export function failedAdRateCheck(error: string, at: string): AdRateCheckReport {
  return { at, ok: false, error, geprueft: 0, abweichend: [] };
}

export function parseAdRateCheck(value: string | null | undefined): AdRateCheckReport | null {
  if (!value) return null;
  try {
    const r = JSON.parse(value) as AdRateCheckReport;
    return r && typeof r.at === 'string' && Array.isArray(r.abweichend) ? r : null;
  } catch { return null; }
}

/** Kachel: rot bei Abweichung oder Lesefehler; älter als 36 h → „veraltet“ (der tägliche Lauf fehlt). */
export function adRateTile(r: AdRateCheckReport | null, now: number = Date.now()): { value: string; level: 'ok' | 'warn' | 'unknown'; title: string } {
  if (!r) return { value: '–', level: 'unknown', title: 'Anzeige-Abgleich App ↔ eBay ist noch nicht gelaufen' };
  const stale = now - Date.parse(r.at) > 36 * 60 * 60 * 1000;
  if (!r.ok) return { value: '!', level: 'warn', title: `Anzeige-Abgleich fehlgeschlagen (${r.at.slice(0, 16).replace('T', ' ')}): ${r.error ?? ''}` };
  const list = r.abweichend.map(a => `stele-${a.productId}: App ${a.app ?? '5 (Standard)'} % · eBay ${a.ebay == null ? a.ebayKind : `${a.ebay} %`}`).join('\n');
  const when = r.at.slice(0, 16).replace('T', ' ');
  if (r.abweichend.length > 0) return { value: String(r.abweichend.length), level: 'warn', title: `Abweichung App ↔ eBay (Stand ${when} UTC):\n${list}` };
  return { value: '0', level: stale ? 'unknown' : 'ok', title: `${r.geprueft} Angebote geprüft, 0 Abweichungen (Stand ${when} UTC)${stale ? ' — veraltet, täglicher Lauf fehlt' : ''}` };
}
