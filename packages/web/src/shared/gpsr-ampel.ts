// A-008 Teil 3c — GPSR-Ampel nach ERGEBNIS HANDBUCH A-006, Antwort 5. Reine Funktion (kein DB-/Netzzugriff),
// nutzt dieselbe Auflösung wie das Senden (resolveGpsrForListing) — keine zweite Regel.
//
// ROT   : EU-Person unvollständig/ungültig (PLZ > 9 Zeichen, Land kein EU/EWR-ISO-Code, E-Mail-Format, Feldlängen),
//         Hersteller-Adresse nur halb (25110), Hersteller-Name == EU-Person bei Sitz außerhalb der EU.
// GELB  : Hersteller fehlt (nur EU-Person), Hersteller nur mit Name (ohne Anschrift), Hersteller ohne E-Mail/Kontakt-URL.
// GRÜN  : EU-Person vollständig UND Hersteller vollständig (Name, Straße, PLZ+Ort, Land, E-Mail oder Kontakt-URL).
// Hinweis: Die Ampel ist eine Anzeige. Gesperrt (422) wird das Listen/Nachziehen weiterhin nur bei ROT der EU-Person;
// ein unvollständiger Hersteller wird beim Senden weggelassen (P71-C Teil 3), nicht gesendet.
import { resolveGpsrForListing, isEmailShape, type GpsrProductFields } from './gpsr-parser';

export type GpsrAmpelColor = 'GRUEN' | 'GELB' | 'ROT';
export interface GpsrAmpelPart { ampel: GpsrAmpelColor; missing: string[] }
export interface GpsrAmpelResult {
  overall: GpsrAmpelColor;
  eu: GpsrAmpelPart;
  manufacturer: GpsrAmpelPart & { halbeAdresse: boolean };
}

// Die Ampel zeigt; gesperrt wird nur bei roter EU-Person. Ein roter Hersteller wird beim Senden weggelassen.
const HINWEIS_OHNE_HERSTELLER = 'Folge: Der Hersteller wird nicht mitgesendet — Listen/Nachziehen bleibt möglich (nur eine rote EU-Person sperrt).';
const LIMITS = { name: 100, address: 180, city: 64, email: 180, url: 250 };
const rank = (c: GpsrAmpelColor) => (c === 'ROT' ? 2 : c === 'GELB' ? 1 : 0);
const worst = (...c: GpsrAmpelColor[]): GpsrAmpelColor => c.reduce((a, b) => (rank(b) > rank(a) ? b : a), 'GRUEN' as GpsrAmpelColor);

export function gpsrAmpel(p: GpsrProductFields): GpsrAmpelResult {
  const r = resolveGpsrForListing(p);

  // ── EU-Person ──
  const euMissing: string[] = [];
  if (!r.eu) {
    euMissing.push(...r.missing.map(m => `EU-Person: ${m}`));
  } else {
    if (r.eu.postalCode.length > 9) euMissing.push('EU-Person: PLZ länger als 9 Zeichen');
    if (!isEmailShape(r.eu.email)) euMissing.push('EU-Person: E-Mail hat kein gültiges Format');
    if (r.eu.name.length > LIMITS.name) euMissing.push(`EU-Person: Name länger als ${LIMITS.name} Zeichen`);
    if (r.eu.address.length > LIMITS.address) euMissing.push(`EU-Person: Straße länger als ${LIMITS.address} Zeichen`);
    if (r.eu.city.length > LIMITS.city) euMissing.push(`EU-Person: Ort länger als ${LIMITS.city} Zeichen`);
    if (r.eu.email.length > LIMITS.email) euMissing.push(`EU-Person: E-Mail länger als ${LIMITS.email} Zeichen`);
  }
  const eu: GpsrAmpelPart = { ampel: euMissing.length ? 'ROT' : 'GRUEN', missing: euMissing };

  // ── Hersteller ──
  const mMissing: string[] = [];
  let mAmpel: GpsrAmpelColor = 'GRUEN';
  let halbeAdresse = false;
  const gespeichert = !!(p.gpsrMfrName?.trim());
  const hatName = gespeichert || r.manufacturer !== null || r.manufacturerMissing.length > 0;
  if (!hatName) {
    mAmpel = 'GELB';
    mMissing.push('Hersteller fehlt (nur EU-Person) — rechtlich offen, eBay akzeptiert es');
  } else if (r.manufacturer) {
    const m = r.manufacturer;
    if (m.name.length > LIMITS.name) { mAmpel = 'ROT'; mMissing.push(`Hersteller: Name länger als ${LIMITS.name} Zeichen`); }
    if (m.address.length > LIMITS.address) { mAmpel = 'ROT'; mMissing.push(`Hersteller: Straße länger als ${LIMITS.address} Zeichen`); }
    if (m.city.length > LIMITS.city) { mAmpel = 'ROT'; mMissing.push(`Hersteller: Ort länger als ${LIMITS.city} Zeichen`); }
    if (m.postalCode.length > 9) { mAmpel = 'ROT'; mMissing.push('Hersteller: PLZ länger als 9 Zeichen'); }
    if (m.email && !isEmailShape(m.email)) { mAmpel = 'ROT'; mMissing.push('Hersteller: E-Mail hat kein gültiges Format'); }
    if (!m.email && !m.url) { if (mAmpel !== 'ROT') mAmpel = 'GELB'; mMissing.push('Hersteller: E-Mail oder Kontakt-URL fehlt'); }
  } else {
    const fehlt = r.manufacturerMissing;
    const identisch = fehlt.some(x => x.includes('identisch mit der EU-Person'));
    const zuLang = fehlt.filter(x => x.startsWith('Hersteller zu lang'));
    const adresseTeile = fehlt.filter(x => x === 'Straße' || x === 'PLZ und Ort' || x === 'Land');
    if (identisch || zuLang.length) { mAmpel = 'ROT'; mMissing.push(...fehlt.filter(x => x.includes('identisch') || x.startsWith('Hersteller zu lang')), HINWEIS_OHNE_HERSTELLER); }
    else if (adresseTeile.length === 3) { mAmpel = 'GELB'; mMissing.push('Hersteller nur mit Name, ohne Anschrift (Straße, PLZ und Ort, Land fehlen)'); }
    else { mAmpel = 'ROT'; halbeAdresse = true; mMissing.push(...adresseTeile.map(x => `Hersteller: ${x} fehlt`), 'Halbe Hersteller-Adresse (25110-Risiko: alles oder nichts)', HINWEIS_OHNE_HERSTELLER); }
  }
  return { overall: worst(eu.ampel, mAmpel), eu, manufacturer: { ampel: mAmpel, missing: mMissing, halbeAdresse } };
}

export function gpsrAmpelLabel(c: GpsrAmpelColor): string {
  return c === 'GRUEN' ? 'GRÜN' : c;
}
