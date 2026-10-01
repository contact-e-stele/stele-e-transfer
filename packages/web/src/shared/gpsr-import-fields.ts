// A-010 — GPSR-Einzelfelder im Import-Tab: Vorbefüllung aus dem Rohtext-Parser, Feldwerte mit Vorrang,
// Validierung (dieselben Regeln wie Produkte-Tab/Senden), Feld-Probleme für die Anzeige und Auswahllisten
// gespeicherter Personen (Nachtrag). Alles reine Funktionen: kein DB-/Netz-/React-Zugriff, damit testbar (Regel 2).
import {
  parseGpsrRaw, mfrFieldsFromRaw, planMfrBackfill, resolveGpsrForListing, isPostalCityFormat, isMfrPostalCityFormat, isEmailShape,
  isEuEeaCountry, normalizeCountryCode, normalizeCompanyName, sameCompanyName,
  type GpsrProductFields,
} from './gpsr-parser';
import { gpsrAmpel } from './gpsr-ampel';
import { parseMfrPatch } from './gpsr-mfr-patch';

export const EU_KEYS = ['name', 'address', 'city', 'country', 'email', 'phone'] as const;
export const MFR_KEYS = ['name', 'address', 'city', 'country', 'email', 'phone', 'url'] as const;
export type EuKey = typeof EU_KEYS[number];
export type MfrKey = typeof MFR_KEYS[number];
export interface GpsrFormValues { eu: Record<EuKey, string>; mfr: Record<MfrKey, string> }
export interface GpsrFormOverrides { eu: Partial<Record<EuKey, string>>; mfr: Partial<Record<MfrKey, string>> }

/** Flaches Format, wie es POST /api/products und die DB (gpsr_*, gpsr_mfr_*) benutzen. */
export type GpsrFlatFields = {
  gpsrName?: string; gpsrAddress?: string; gpsrCity?: string; gpsrCountry?: string; gpsrEmail?: string; gpsrPhone?: string;
  gpsrMfrName?: string; gpsrMfrAddress?: string; gpsrMfrCity?: string; gpsrMfrCountry?: string;
  gpsrMfrEmail?: string; gpsrMfrPhone?: string; gpsrMfrUrl?: string;
};
const EU_FLAT: Record<EuKey, keyof GpsrFlatFields> = { name: 'gpsrName', address: 'gpsrAddress', city: 'gpsrCity', country: 'gpsrCountry', email: 'gpsrEmail', phone: 'gpsrPhone' };
const MFR_FLAT: Record<MfrKey, keyof GpsrFlatFields> = { name: 'gpsrMfrName', address: 'gpsrMfrAddress', city: 'gpsrMfrCity', country: 'gpsrMfrCountry', email: 'gpsrMfrEmail', phone: 'gpsrMfrPhone', url: 'gpsrMfrUrl' };

const blankEu = (): Record<EuKey, string> => ({ name: '', address: '', city: '', country: '', email: '', phone: '' });
const blankMfr = (): Record<MfrKey, string> => ({ name: '', address: '', city: '', country: '', email: '', phone: '', url: '' });
export const emptyOverrides = (): GpsrFormOverrides => ({ eu: {}, mfr: {} });

/** Was der Parser aus dem Rohtext sicher erkennt (nie geraten). EU-Land nur, wenn EU/EWR. */
export function parserPrefill(raw: string | null | undefined): GpsrFormValues {
  const g = parseGpsrRaw(raw);
  const eu = blankEu();
  if (g.euBlockFound) {
    eu.name = g.name ?? ''; eu.address = g.address ?? ''; eu.city = g.city ?? ''; eu.email = g.email ?? ''; eu.phone = g.phone ?? '';
    eu.country = isEuEeaCountry(g.country) ? (g.country as string) : '';
  }
  const m = mfrFieldsFromRaw(raw);
  const mfr = blankMfr();
  mfr.name = m.gpsrMfrName ?? ''; mfr.address = m.gpsrMfrAddress ?? ''; mfr.city = m.gpsrMfrCity ?? '';
  mfr.country = m.gpsrMfrCountry ?? ''; mfr.email = m.gpsrMfrEmail ?? ''; mfr.phone = m.gpsrMfrPhone ?? ''; mfr.url = m.gpsrMfrUrl ?? '';
  return { eu, mfr };
}

/** Anzeige-/Speicherwert je Feld: nicht-leere Eingabe schlägt den Parser; leer = Parser-Wert (wie beim Speichern). */
export function effectiveForm(raw: string | null | undefined, overrides: GpsrFormOverrides): GpsrFormValues {
  const base = parserPrefill(raw);
  // Nie zwei Personen mischen: nennt der Nutzer (oder die Auswahlliste) einen ANDEREN Namen als der Rohtext, füllt der Parser
  // für diesen Block keine Lücken mehr (sonst stünde z. B. die Telefonnummer des Lieferanten bei einer fremden Person).
  const euOther = !!overrides.eu.name?.trim() && !!base.eu.name && !sameCompanyName(overrides.eu.name, base.eu.name);
  const mfrOther = !!overrides.mfr.name?.trim() && !!base.mfr.name && !sameCompanyName(overrides.mfr.name, base.mfr.name);
  const eu = euOther ? blankEu() : { ...base.eu };
  const mfr = mfrOther ? blankMfr() : { ...base.mfr };
  for (const k of EU_KEYS) { const v = overrides.eu[k]?.trim(); if (v) eu[k] = v; }
  for (const k of MFR_KEYS) { const v = overrides.mfr[k]?.trim(); if (v) mfr[k] = v; }
  return { eu, mfr };
}

/** Nicht-leere Formularwerte als flaches Body-Objekt (leere Felder fehlen → serverseitig Parser-Fallback). */
export function toFlatFields(form: GpsrFormValues): GpsrFlatFields {
  const out: GpsrFlatFields = {};
  for (const k of EU_KEYS) { const v = form.eu[k].trim(); if (v) out[EU_FLAT[k]] = v; }
  for (const k of MFR_KEYS) { const v = form.mfr[k].trim(); if (v) out[MFR_FLAT[k]] = v; }
  return out;
}

/** Flaches Format → resolveGpsrForListing/gpsrAmpel-Eingabe (Rohtext bleibt Fallback für leere Felder). */
export function toProductFields(raw: string | null | undefined, flat: GpsrFlatFields): GpsrProductFields {
  return {
    gpsrRaw: raw ?? null,
    gpsrName: flat.gpsrName ?? null, gpsrAddress: flat.gpsrAddress ?? null, gpsrCity: flat.gpsrCity ?? null,
    gpsrEmail: flat.gpsrEmail ?? null, gpsrPhone: flat.gpsrPhone ?? null, gpsrCountry: flat.gpsrCountry ?? null,
    gpsrMfrName: flat.gpsrMfrName ?? null, gpsrMfrAddress: flat.gpsrMfrAddress ?? null, gpsrMfrCity: flat.gpsrMfrCity ?? null,
    gpsrMfrCountry: flat.gpsrMfrCountry ?? null, gpsrMfrEmail: flat.gpsrMfrEmail ?? null, gpsrMfrPhone: flat.gpsrMfrPhone ?? null,
    gpsrMfrUrl: flat.gpsrMfrUrl ?? null,
  };
}

/** Live-Ampel aus den Formularwerten (dieselbe Funktion wie der Produkte-Tab). */
export function ampelForForm(raw: string | null | undefined, form: GpsrFormValues) {
  return gpsrAmpel(toProductFields(raw, toFlatFields(form)));
}

// ── Server: was beim Import in die DB geschrieben wird ──────────────────────────────────────────
// Feldwerte haben Vorrang vor dem Parser; leere Felder → Parser-Fallback wie bisher. Ein Hersteller aus dem Formular, der
// nicht zum Rohtext-Hersteller passt, bekommt KEINE Parser-Felder dazu (nie zwei Hersteller mischen).
const FLAT_EU_KEYS = Object.values(EU_FLAT) as Array<keyof GpsrFlatFields>;
const FLAT_MFR_KEYS = Object.values(MFR_FLAT) as Array<keyof GpsrFlatFields>;
const nonEmpty = (flat: GpsrFlatFields, keys: Array<keyof GpsrFlatFields>): GpsrFlatFields => {
  const out: GpsrFlatFields = {};
  for (const k of keys) { const v = flat[k]?.trim(); if (v) out[k] = v; }
  return out;
};

export function resolveMfrImportFields(raw: string | null | undefined, body: GpsrFlatFields): GpsrFlatFields {
  const parsed = mfrFieldsFromRaw(raw) as GpsrFlatFields;
  const given = nonEmpty(body, FLAT_MFR_KEYS);
  const mixes = given.gpsrMfrName && parsed.gpsrMfrName && !sameCompanyName(given.gpsrMfrName, parsed.gpsrMfrName);
  return { ...(mixes ? {} : parsed), ...given };
}

/** Re-Import eines bestehenden Produkts: Formularwerte gelten; der Parser füllt nur noch LEERE Felder und nie einen anderen Hersteller dazu. */
export function resolveMfrUpdateFields(existing: Partial<Record<keyof GpsrFlatFields, string | null>>, raw: string | null | undefined, body: GpsrFlatFields): GpsrFlatFields {
  const given = nonEmpty(body, FLAT_MFR_KEYS);
  return { ...planMfrBackfill({ ...existing, ...given }, raw), ...given };
}

export function resolveEuImportFields(parserEu: GpsrFlatFields, body: GpsrFlatFields): GpsrFlatFields {
  const given = nonEmpty(body, FLAT_EU_KEYS);
  const mixes = given.gpsrName && parserEu.gpsrName && !sameCompanyName(given.gpsrName, parserEu.gpsrName);
  return { ...(mixes ? {} : parserEu), ...given };
}

// ── Validierung (gleiche Regeln wie Produkte-Tab/Senden) ────────────────────────────────────────
const MAX = { name: 100, address: 180, city: 74, email: 180, phone: 64, url: 250 };

/** Formatfehler der gelieferten Felder (fehlende Felder sind KEIN Fehler — die Ampel zeigt sie, Listen wird später geprüft). */
export function validateGpsrFlat(flat: GpsrFlatFields): string[] {
  const errors: string[] = [];
  const eu = nonEmpty(flat, FLAT_EU_KEYS);
  if (eu.gpsrCity && !isPostalCityFormat(eu.gpsrCity)) errors.push('EU-Person: PLZ + Stadt muss das Format "PLZ Stadt" haben (z. B. 75017 Paris)');
  if (eu.gpsrCountry) {
    const c = normalizeCountryCode(eu.gpsrCountry);
    if (!c) errors.push('EU-Person: Land muss ein zweistelliger Ländercode sein');
    else if (!isEuEeaCountry(c)) errors.push(`EU-Person: Land ${c} liegt außerhalb der EU/des EWR`);
  }
  if (eu.gpsrEmail && !isEmailShape(eu.gpsrEmail)) errors.push('EU-Person: E-Mail ist keine gültige Adresse');
  const euLimits: Array<[keyof GpsrFlatFields, number, string]> = [['gpsrName', MAX.name, 'Name'], ['gpsrAddress', MAX.address, 'Straße'], ['gpsrCity', MAX.city, 'PLZ + Stadt'], ['gpsrEmail', MAX.email, 'E-Mail'], ['gpsrPhone', MAX.phone, 'Telefon']];
  for (const [k, max, label] of euLimits) if ((eu[k]?.length ?? 0) > max) errors.push(`EU-Person: ${label} ist zu lang (max. ${max} Zeichen)`);

  const mfr = nonEmpty(flat, FLAT_MFR_KEYS);
  // jedes Feld einzeln, damit alle Fehler gemeldet werden (parseMfrPatch liefert sonst nur den ersten)
  for (const k of FLAT_MFR_KEYS) {
    if (mfr[k] === undefined) continue;
    const patch = parseMfrPatch({ [k]: mfr[k] });
    if (!patch.ok) errors.push(`Hersteller: ${patch.error}`);
  }
  if (mfr.gpsrMfrCity && !isMfrPostalCityFormat(mfr.gpsrMfrCity)) errors.push('Hersteller: PLZ + Stadt muss das Format "PLZ Stadt" haben (z. B. 518000 Shenzhen)');
  // EU-Person nie als Hersteller (gleiche Sperre wie beim Senden; hier strenger: auch ohne Land)
  if (mfr.gpsrMfrName && eu.gpsrName && sameCompanyName(mfr.gpsrMfrName, eu.gpsrName)) {
    const mc = normalizeCountryCode(mfr.gpsrMfrCountry);
    if (!mc || !isEuEeaCountry(mc)) errors.push('Hersteller ist identisch mit der EU-Person (Hersteller außerhalb der EU) — die EU-Person darf nicht als Hersteller eingetragen werden');
  }
  return errors;
}

// ── Feld-Probleme für die Anzeige (rot umrandet + Klartext) ─────────────────────────────────────
export interface FieldProblems { eu: Partial<Record<EuKey, string>>; mfr: Partial<Record<MfrKey, string>> }
export function fieldProblems(form: GpsrFormValues): FieldProblems {
  const eu: Partial<Record<EuKey, string>> = {}; const mfr: Partial<Record<MfrKey, string>> = {};
  const v = (x: string) => x.trim();
  // EU-Person: Pflichtfelder
  if (!v(form.eu.name)) eu.name = 'Name fehlt';
  if (!v(form.eu.address)) eu.address = 'Straße fehlt';
  if (!v(form.eu.city)) eu.city = 'PLZ + Stadt fehlt'; else if (!isPostalCityFormat(form.eu.city)) eu.city = 'Format "PLZ Stadt" nötig';
  if (!v(form.eu.country)) eu.country = 'Land fehlt'; else if (!isEuEeaCountry(normalizeCountryCode(form.eu.country))) eu.country = 'Land muss in der EU/im EWR liegen';
  if (!v(form.eu.email)) eu.email = 'E-Mail fehlt'; else if (!isEmailShape(form.eu.email)) eu.email = 'Keine gültige E-Mail';
  // Hersteller: Adresse alles oder nichts, sobald irgendein Hersteller-Feld gefüllt ist
  const mAny = MFR_KEYS.some(k => v(form.mfr[k]));
  if (mAny && !v(form.mfr.name)) mfr.name = 'Name fehlt';
  const addrParts = [v(form.mfr.address), v(form.mfr.city), v(form.mfr.country)];
  if (addrParts.some(Boolean) && !addrParts.every(Boolean)) {
    if (!v(form.mfr.address)) mfr.address = 'Straße fehlt (Adresse nur ganz oder gar nicht)';
    if (!v(form.mfr.city)) mfr.city = 'PLZ + Stadt fehlt (Adresse nur ganz oder gar nicht)';
    if (!v(form.mfr.country)) mfr.country = 'Land fehlt (Adresse nur ganz oder gar nicht)';
  }
  if (v(form.mfr.city) && !isMfrPostalCityFormat(form.mfr.city)) mfr.city = 'Format "PLZ Stadt" nötig';
  if (v(form.mfr.email) && !isEmailShape(form.mfr.email)) mfr.email = 'Keine gültige E-Mail';
  if (v(form.mfr.country) && !normalizeCountryCode(form.mfr.country)) mfr.country = 'Zweistelliger Ländercode nötig';
  return { eu, mfr };
}

// ── Nachtrag: Auswahllisten gespeicherter Personen ──────────────────────────────────────────────
export interface EuOption { name: string; address: string; city: string; country: string; email: string; phone: string }
export interface MfrOption extends EuOption { url: string }
export interface PartyOptions { eu: EuOption[]; mfr: MfrOption[] }

// Dubletten: gleicher Firmenname (ohne Rechtsform/Satzzeichen) + gleiche PLZ + gleiche E-Mail = dieselbe Person. Die Quelldaten
// variieren in der Schreibweise der Straße ("ES-CALLE …", "Calle …", Tippfehler) — Name + Straße allein trennt sie nicht
// (in der Produktions-DB 5 Varianten von "SUCCESS COURIER SL"). Gezeigt wird die sauberste Variante.
const dupKey = (name: string, city: string, email: string) => {
  const plz = city.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  return `${normalizeCompanyName(name)}|${plz}|${email.trim().toLowerCase()}`;
};
const addressScore = (name: string, address: string) => {
  let score = 0;
  if (/^[A-Za-z]{2}-/.test(address.trim())) score -= 3; // Länderpräfix-Artefakt ("ES-CALLE …", "FR-FR-79 …")
  if (normalizeCompanyName(name) && address.toLowerCase().replace(/\s+/g, '').includes(normalizeCompanyName(name).replace(/\s+/g, ''))) score -= 3; // Firmenname klebt an der Straße
  const upper = (address.match(/[A-ZÄÖÜ]/g) ?? []).length, lower = (address.match(/[a-zäöüß]/g) ?? []).length;
  if (upper + lower > 0 && upper / (upper + lower) < 0.5) score += 1; // normale Schreibweise statt überwiegend GROSS
  return score * 1000 + address.length;
};

/** Aus Produktzeilen (gespeicherte Felder + Rohtext-Fallback wie beim Senden): vollständige (Ampel grün), dublettenfreie Personen. */
export function buildPartyOptions(rows: GpsrProductFields[]): PartyOptions {
  const eu = new Map<string, EuOption>(); const mfr = new Map<string, MfrOption>();
  const keep = <T extends EuOption>(map: Map<string, T>, option: T) => {
    const key = dupKey(option.name, option.city, option.email);
    const cur = map.get(key);
    if (!cur || addressScore(option.name, option.address) > addressScore(cur.name, cur.address)) map.set(key, option);
  };
  for (const row of rows) {
    const ampel = gpsrAmpel(row);
    const r = resolveGpsrForListing(row);
    if (ampel.eu.ampel === 'GRUEN' && r.eu) {
      keep(eu, { name: r.eu.name, address: r.eu.address, city: `${r.eu.postalCode} ${r.eu.city}`, country: r.eu.country, email: r.eu.email, phone: r.eu.phone ?? '' });
    }
    if (ampel.manufacturer.ampel === 'GRUEN' && r.manufacturer) {
      const m = r.manufacturer;
      keep(mfr, { name: m.name, address: m.address, city: `${m.postalCode} ${m.city}`, country: m.country, email: m.email ?? '', phone: m.phone ?? '', url: m.url ?? '' });
    }
  }
  const byName = (x: { name: string }, y: { name: string }) => x.name.localeCompare(y.name, 'de');
  return { eu: [...eu.values()].sort(byName), mfr: [...mfr.values()].sort(byName) };
}

/** Hersteller-Liste: zuerst Treffer mit gleichem Namen wie im Rohtext, dann der Rest (jeweils alphabetisch). */
export function sortMfrOptions(options: MfrOption[], rawName: string | null | undefined): MfrOption[] {
  const hit = (o: MfrOption) => sameCompanyName(o.name, rawName);
  const byName = (a: MfrOption, b: MfrOption) => a.name.localeCompare(b.name, 'de');
  return [...options.filter(hit).sort(byName), ...options.filter(o => !hit(o)).sort(byName)];
}

/** Warnhinweis, wenn der gewählte Name nicht zum Namen im Rohtext passt (der Lieferant nennt die Person je Produkt). */
export function nameMismatchWarning(selectedName: string, rawName: string | null | undefined): string | null {
  if (!rawName?.trim() || !selectedName.trim()) return null;
  if (sameCompanyName(selectedName, rawName)) return null;
  return `Gewählt: ${selectedName}, Lieferant nennt: ${rawName} – bitte prüfen`;
}

/** Eine EU-Person darf nie in den Hersteller-Block übernommen werden (gleiche Sperre wie beim Senden). */
export function canAdoptAsManufacturer(option: { name: string; country: string }, euName: string | null | undefined): { ok: true } | { ok: false; reason: string } {
  if (euName && sameCompanyName(option.name, euName) && !isEuEeaCountry(normalizeCountryCode(option.country))) {
    return { ok: false, reason: 'Das ist die EU-Person dieses Produkts — sie darf nicht als Hersteller eingetragen werden.' };
  }
  return { ok: true };
}

/** Rohtext-Namen für die Warnung (Name des jeweiligen Blocks, wie ihn der Lieferant nennt). */
export function rawPartyNames(raw: string | null | undefined): { eu: string; mfr: string } {
  const p = parserPrefill(raw);
  return { eu: p.eu.name, mfr: p.mfr.name };
}
