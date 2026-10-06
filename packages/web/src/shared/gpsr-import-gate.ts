// A-040 (Inhaber 06.10.2026): Hersteller UND EU-verantwortliche Person müssen beim Import vollständig sein —
// sonst geht der Import nicht weiter (kein Speichern, kein Override). Dieselbe Regel sperrt das ERSTE Listen.
// Eine Regel, genau einmal (Grundgesetz 8): baut auf gpsrAmpel()/resolveGpsrForListing() auf, keine zweite Prüfung.
// Vollständig = Ampel GRÜN für beide Blöcke:
//   EU-Person: Name, Straße, PLZ+Stadt, Land (EU/EWR), E-Mail (Telefon optional)
//   Hersteller: Name, Straße, PLZ+Ort, Land, E-Mail ODER Kontakt-URL (GPSR Art. 9 Abs. 6: Post- und elektronische Adresse)
import { gpsrAmpel } from './gpsr-ampel';
import type { GpsrProductFields } from './gpsr-parser';
import { toFlatFields, toProductFields, type GpsrFormValues } from './gpsr-import-fields';

export interface GpsrGateResult { ok: boolean; missing: string[] }

const HINWEIS = /^Folge: /; // Ampel-Hinweis "Hersteller wird weggelassen" passt hier nicht — hier wird gesperrt.

export function gpsrCompleteGate(p: GpsrProductFields): GpsrGateResult {
  const a = gpsrAmpel(p);
  const missing = [...a.eu.missing, ...a.manufacturer.missing].filter(m => !HINWEIS.test(m));
  const ok = a.eu.ampel === 'GRUEN' && a.manufacturer.ampel === 'GRUEN';
  return { ok, missing: ok ? [] : missing };
}

export const GPSR_IMPORT_BLOCKED_PREFIX = 'Import gestoppt — Hersteller und EU-Person müssen vollständig sein';
export const GPSR_LISTING_BLOCKED_PREFIX = 'Listen gesperrt — Hersteller und EU-Person müssen vollständig sein';

export function gpsrGateMessage(prefix: string, r: GpsrGateResult): string {
  return `${prefix}: ${r.missing.join('; ')}`;
}

type Flat = Partial<Record<Exclude<keyof GpsrProductFields, 'gpsrRaw'>, string | null | undefined>>;
const GPSR_KEYS = ['gpsrName', 'gpsrAddress', 'gpsrCity', 'gpsrCountry', 'gpsrEmail', 'gpsrPhone',
  'gpsrMfrName', 'gpsrMfrAddress', 'gpsrMfrCity', 'gpsrMfrCountry', 'gpsrMfrEmail', 'gpsrMfrPhone', 'gpsrMfrUrl'] as const;

/** Endwerte wie sie POST /products speichert: bestehende DB-Zeile, darüber die aufgelösten Import-Felder (undefined = unverändert). */
export function gpsrFinalFields(
  existing: (Flat & { gpsrRaw?: string | null }) | undefined,
  raw: string | null | undefined,
  eu: Flat,
  mfr: Flat,
): GpsrProductFields {
  const out: Record<string, string | null> = {};
  for (const k of GPSR_KEYS) {
    const v = mfr[k] !== undefined ? mfr[k] : eu[k] !== undefined ? eu[k] : existing?.[k];
    out[k] = v ?? null;
  }
  return { ...(out as unknown as GpsrProductFields), gpsrRaw: raw ?? existing?.gpsrRaw ?? null };
}

/** Import-Tab: dieselbe Sperre auf den Formularwerten (Rohtext + Eingaben) — nur Anzeige/Knopf, der Server prüft die Endwerte erneut. */
export function gpsrFormGate(raw: string | null | undefined, form: GpsrFormValues): GpsrGateResult {
  return gpsrCompleteGate(toProductFields(raw, toFlatFields(form)));
}
