// P-2611-25B GPSR-PLZ: Feld „PLZ + Stadt“ bei Hersteller und EU-Person befüllen, ohne zu raten.
// Reine Funktionen (Grundgesetz 2). Die Trennung Straße/PLZ/Stadt existiert genau einmal in gpsr-parser.ts
// (postalCityFromAddress) — hier wird nur entschieden, was im Feld steht und was angezeigt wird.
import { postalCityFromAddress, isPostalCityFormat, isMfrPostalCityFormat } from './gpsr-parser';

export const PLZ_FEHLT = 'PLZ fehlt';

export interface PlzFeldStatus {
  /** Wert für das Feld, wenn es leer ist und die Adresse schon eine PLZ enthält — sonst null. */
  ausAdresse: string | null;
  /** „PLZ fehlt“, solange im Feld keine gültige „PLZ Stadt“ steht und auch die Adresse keine liefert. */
  hinweis: string | null;
}

/**
 * Status des Feldes „PLZ + Stadt“.
 * - Feld hat schon das Format „PLZ Stadt“ → nichts zu tun.
 * - Feld leer, Adresse enthält „… Madrid 28013“ / „60325 Frankfurt am Main“ → ausAdresse = „28013 Madrid“.
 * - sonst → hinweis „PLZ fehlt“ (das Listen bleibt über die GPSR-Sperre gesperrt, bis das Feld gefüllt ist).
 */
export function plzFeldStatus(city: string | null | undefined, address: string | null | undefined, opts: { manufacturer?: boolean } = {}): PlzFeldStatus {
  const c = (city ?? '').trim();
  const valid = opts.manufacturer ? isMfrPostalCityFormat(c) : isPostalCityFormat(c);
  if (valid) return { ausAdresse: null, hinweis: null };
  const ausAdresse = c ? null : postalCityFromAddress(address, opts);
  const ok = !!ausAdresse && (opts.manufacturer ? isMfrPostalCityFormat(ausAdresse) : isPostalCityFormat(ausAdresse));
  return ok ? { ausAdresse, hinweis: null } : { ausAdresse: null, hinweis: PLZ_FEHLT };
}

/** Knopf „PLZ suchen“: Google-Suche „<Firma> <Straße> <Stadt> Postleitzahl“ in neuem Tab. Speichert nichts. */
export function plzSucheUrl(name: string | null | undefined, address: string | null | undefined, city: string | null | undefined): string {
  const q = [name, address, city, 'Postleitzahl'].map(x => (x ?? '').trim()).filter(Boolean).join(' ');
  return 'https://www.google.com/search' + '?q=' + q.split(/\s+/).map(encodeURIComponent).join('+');
}
