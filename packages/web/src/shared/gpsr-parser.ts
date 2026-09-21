// GPSR Schritt 1 — Rohtext in strukturierte Felder überführen.
//
// FORMAT-BEFUND (gegen alle 49 gefüllten gpsr_raw-Werte der Produktions-DB geprüft, nicht
// angenommen — siehe scripts/gpsr-parse-report.ts für den vollen Bericht):
//
// - IMMER genau zwei Blöcke, durch eine Leerzeile getrennt: zuerst "Hersteller" (i.d.R. China),
//   danach "EU-Verantwortlicher"/"verantwortliche Person in der EU". Bei allen 49 Datensätzen
//   exakt zwei zeilen-verankerte "Name:"-Vorkommen gefunden (0 Abweichungen) — der zweite Block
//   ist strukturell zuverlässig über die POSITION identifizierbar, nicht über Keyword-Erkennung
//   des Blocktitels (der Blocktitel selbst fehlt in mehreren Datensätzen ganz).
// - Blocktitel-Formulierung variiert (oder fehlt): "Informationen zum Hersteller" /
//   "Herstellerinformationen" / kein Titel — "Informationen zum EU-Verantwortlichen" /
//   "Informationen zur verantwortlichen Person in der EU" / "Angaben zur verantwortlichen
//   Person in der EU".
// - Feldlabel variiert: "E-Mail:" vs. "E-Mail-Adresse:", mal mit/ohne Leerzeichen nach dem
//   Doppelpunkt. Vereinzelt ein Artefakt ": Name: ..." (führender Doppelpunkt auf derselben
//   Zeile wie "Name:") — wird toleriert.
// - "Telefon:" ist NICHT in jedem Block vorhanden (mehrere EU-Blöcke haben nur Name/Adresse/
//   E-Mail) — wird als optional behandelt, nicht als Parser-Fehler.
// - "Adresse:" ist der unzuverlässigste Teil: mal "Straße Hausnr., PLZ Stadt, Land" auf einer
//   Zeile, mal NUR die Straße ohne jede Orts-/PLZ-Angabe, mal ein sichtbar durchgerutschter
//   Formularfeld-Dump der Importquelle (z. B. "Company_Name:...; Address_CountryandRegion:...;
//   Address_District_1:..."). Eine automatische Straße/PLZ/Stadt-Trennung ist deshalb NICHT für
//   jeden Datensatz sicher möglich — wird entsprechend als "nicht erkannt" ausgewiesen statt
//   geraten.
//
// Dieses Modul enthält NUR die reine Parsing-Logik (keine DB-/Dateizugriffe), damit sie einzeln
// getestet werden kann (gpsr-parser.test.ts) und von Bericht (nur lesend) und späterem
// Schreib-Skript (hinter Schalter) gemeinsam genutzt wird, statt zweimal gebaut zu werden.

export interface GpsrBlockFields {
  name: string | null;
  address: string | null;
  city: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
}

export interface ParsedGpsr {
  name: string | null;
  address: string | null;
  city: string | null;
  email: string | null;
  phone: string | null;
  /** Paket 3: ISO-Ländercode der EU-Adresse, nur wenn ein bekanntes Länderwort in der Adresse steht. */
  country: string | null;
  /** Paket 3: Herstellerblock, getrennt von der EU-Person gehalten (nie ersatzweise in die Hauptfelder). */
  manufacturer: GpsrBlockFields | null;
  /** Paket 3: true nur, wenn ein Block als "verantwortliche Person in der EU" identifiziert wurde. */
  euBlockFound: boolean;
  /** 'vollstaendig' nur wenn alle 5 Felder sicher erkannt sind. */
  confidence: 'vollstaendig' | 'teilweise' | 'nicht_erkannt';
  /** Menschlich lesbare Gründe für fehlende/unsichere Felder — nie geraten, immer benannt. */
  notes: string[];
}

const NAME_LINE_RE = /^\s*:?\s*Name\s*:\s*(.+)$/im;
const ADDRESS_LINE_RE = /^\s*Adresse\s*:\s*(.+)$/im;
const EMAIL_LINE_RE = /^\s*E-?Mail(?:-Adresse)?\s*:\s*(.+)$/im;
const PHONE_LINE_RE = /^\s*Telefon\s*:\s*(.+)$/im;
const EMAIL_SHAPE_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

// Erkennt durchgerutschte Formularfeld-Dumps der Importquelle statt einer echten Adresse
// (z. B. "Company_Name:...; Address_CountryandRegion:...; Address_District_1:...").
const MACHINE_DUMP_RE = /Address_[A-Za-z]+|Company_Name\s*:|CountryandRegion/i;

// ─── Straße/PLZ+Stadt-Trennung ────────────────────────────────────────────────────────────
// Gegen ALLE 49 echten EU-Block-Adressen der Produktions-DB entwickelt und geprüft (siehe
// scripts/gpsr-parse-report.ts für den vollen Bericht). Ergebnis: 31/49 sicher trennbar,
// 18 bewusst "nicht erkannt" statt geraten (u. a. Adressen ganz ohne PLZ, durch Encoding-Fehler
// zusammengeklebter Text, Formularfeld-Dumps).
//
// Zwei Reihenfolgen kommen in den echten Daten vor:
//  - vorwärts:   "Straße, PLZ Stadt[, Land]"        z. B. "…, 01217 Dresden, DE(Germany)"
//  - rückwärts:  "Straße, Stadt, PLZ[, Land]"        z. B. "Calle Luis Bañuel 12-3A, Madrid, 28018, Spain"
// Beide werden versucht (vorwärts zuerst, von rechts nach links), mit einer Sperrliste für
// Ländernamen/-codes, die in dieser Quelle tatsächlich vorkommen — eine Automatik, die "Spain"
// oder "Frankreich" als Stadtnamen übernimmt, wäre eine falsche Angabe, keine fehlende.
const COUNTRY_WORDS = new Set([
  'spain', 'spanien', 'españa', 'espana', 'france', 'frankreich', 'germany', 'deutschland',
  'poland', 'polska', 'polen', 'de', 'fr', 'es', 'pl', 'cn', 'china', 'de(germany)', 'fr(france)',
]);
function isCountryWord(w: string): boolean {
  // Paket 3b: auch alle Länderwörter aus COUNTRY_ISO (NL, PT, IT …) — sonst bliebe "Netherlands" am Stadtnamen hängen.
  return COUNTRY_WORDS.has(w.toLowerCase().replace(/[()]/g, '')) || Object.prototype.hasOwnProperty.call(COUNTRY_ISO, w.toLowerCase().replace(/\(.*\)/, ''));
}

const PL_CHARS = "A-Za-zÀ-ÿŁŚŻŹĆŃÓĄĘłśżźćńóąę.'\\-";
// PLZ: 4-5 Ziffern (DE/FR/ES u. a.) ODER polnisches Format XX-XXX. Nicht direkt nach einer
// Ziffer/einem "/" (verhindert Fehltreffer in Hausnummern wie "1/1401").
// Paket 3b: PLZ-Formate — PT "1000-001", PL "00-950", NL "1012 AB" (4 Ziffern + 2 GROSSBUCHSTABEN), sonst 4–5 Ziffern.
// Reihenfolge zählt: NL/PT vor dem allgemeinen 4–5-Ziffern-Fall, sonst würde "1012 AB Amsterdam" still als
// PLZ "1012" + Stadt "AB Amsterdam" zerlegt (belegter Fehlweg).
const PLZ_ALT = '\\d{4}-\\d{3}|\\d{2}-\\d{3}|\\d{4}\\s?[A-Z]{2}(?![A-Za-z])|\\d{4,5}';
const FORWARD_RE = new RegExp(`(?<![\\d/-])(${PLZ_ALT})[\\s,]+([${PL_CHARS}]+(?:\\s+[${PL_CHARS}]+){0,2})`, 'g');
const REVERSED_RE = new RegExp(`([${PL_CHARS}]+(?:\\s+[${PL_CHARS}]+){0,1})\\s*,\\s*(\\d{4,5})(?!\\d)`, 'g');

function trimTrailingCountryWords(words: string[]): string[] {
  const out = [...words];
  while (out.length > 1 && isCountryWord(out[out.length - 1])) out.pop();
  return out;
}

function normalizeAddress(s: string): string {
  return s.replace(/，/g, ',').trim(); // Vollbreite Kommas (chinesische Tastatur) auf ASCII normalisieren
}

interface AddressSplit { street: string; city: string | null; matched: boolean }

function splitStreetAndCity(rawAddress: string): AddressSplit {
  const addr = normalizeAddress(rawAddress);

  // 1) Vorwärts: "…, PLZ Stadt[, Land]" — von rechts (nächstgelegen am Ende) nach links versuchen.
  const forwardMatches = [...addr.matchAll(FORWARD_RE)];
  for (let i = forwardMatches.length - 1; i >= 0; i--) {
    const m = forwardMatches[i];
    const words = trimTrailingCountryWords(m[2].trim().split(/\s+/));
    const cityWord = words.join(' ');
    if (!cityWord || isCountryWord(cityWord)) continue;
    const street = addr.slice(0, m.index).replace(/[\s,]+$/, '').trim();
    if (!street) continue;
    return { street, city: `${m[1]} ${cityWord}`, matched: true };
  }

  // 2) Rückwärts: "…, Stadt, PLZ[, Land]".
  const reversedMatches = [...addr.matchAll(REVERSED_RE)];
  for (let i = reversedMatches.length - 1; i >= 0; i--) {
    const m = reversedMatches[i];
    const words = m[1].trim().split(/\s+/);
    if (words.length === 0 || isCountryWord(words[words.length - 1])) continue;
    const street = addr.slice(0, m.index).replace(/[\s,]+$/, '').trim();
    if (!street) continue;
    return { street, city: `${m[2]} ${words.join(' ')}`, matched: true };
  }

  return { street: addr, city: null, matched: false };
}

function cleanValue(raw: string): string {
  return raw.trim().replace(/[;,]\s*$/, '').replace(/\s{2,}/g, ' ').trim();
}

function findTopLevelNameLineIndices(lines: string[]): number[] {
  const idx: number[] = [];
  lines.forEach((line, i) => {
    if (/^\s*:?\s*Name\s*:\s*/i.test(line)) idx.push(i);
  });
  return idx;
}

// Paket 3: Länderwort am Adressende → ISO-Code. Nur bekannte Wörter, sonst null (nie geraten).
const COUNTRY_ISO: Record<string, string> = {
  germany: 'DE', deutschland: 'DE', de: 'DE', spain: 'ES', spanien: 'ES', 'españa': 'ES', espana: 'ES', es: 'ES',
  france: 'FR', frankreich: 'FR', fr: 'FR', poland: 'PL', polska: 'PL', polen: 'PL', pl: 'PL', china: 'CN', cn: 'CN', estonia: 'EE', eesti: 'EE', ee: 'EE',
  italy: 'IT', italien: 'IT', italia: 'IT', it: 'IT', netherlands: 'NL', niederlande: 'NL', nederland: 'NL', nl: 'NL',
  czechia: 'CZ', 'czech republic': 'CZ', tschechien: 'CZ', cz: 'CZ', portugal: 'PT', pt: 'PT', hungary: 'HU', ungarn: 'HU', hu: 'HU',
  lithuania: 'LT', litauen: 'LT', lt: 'LT', latvia: 'LV', lettland: 'LV', lv: 'LV', austria: 'AT', österreich: 'AT', at: 'AT',
  belgium: 'BE', belgien: 'BE', be: 'BE', denmark: 'DK', dänemark: 'DK', dk: 'DK', sweden: 'SE', schweden: 'SE', se: 'SE',
  finland: 'FI', finnland: 'FI', fi: 'FI', ireland: 'IE', irland: 'IE', ie: 'IE', slovakia: 'SK', slowakei: 'SK', sk: 'SK',
  slovenia: 'SI', slowenien: 'SI', si: 'SI', croatia: 'HR', kroatien: 'HR', hr: 'HR', romania: 'RO', rumänien: 'RO', ro: 'RO',
  bulgaria: 'BG', bulgarien: 'BG', bg: 'BG', greece: 'GR', griechenland: 'GR', gr: 'GR', luxembourg: 'LU', luxemburg: 'LU', lu: 'LU',
};
// Länderwort erkennen: (1) letztes Wort der Adresse ("…,75017,PARIS FR", "…28947 Spanien"), (2) letztes
// Komma-Segment ("…, DE(Germany)"), (3) führendes Länderkürzel ("ES-CALLE…", "FR-79 rue…"). Nur bekannte Wörter.
function detectCountry(rawAddress: string): string | null {
  const addr = normalizeAddress(rawAddress);
  const lookup = (w: string) => COUNTRY_ISO[w.replace(/\(.*\)/, '').replace(/[.,;]/g, '').trim().toLowerCase()] ?? null;
  const lastToken = addr.split(/[\s,]+/).filter(Boolean).pop() ?? '';
  const lastSegment = addr.split(',').pop() ?? '';
  const prefix = addr.match(/^\s*([A-Za-z]{2})-/)?.[1] ?? '';
  return lookup(lastToken) ?? lookup(lastSegment) ?? (prefix ? lookup(prefix) : null);
}

const KEY_LINE_RE = /^\s*:?\s*(Name|Adresse|E-?Mail(?:-Adresse)?|Telefon)\s*:/i;
const EU_TITLE_RE = /verantwortlich|EU[-\s]?Vertreter/i;
const MANUF_TITLE_RE = /hersteller/i;

function parseBlockFields(blockText: string, notes: string[], label: string): GpsrBlockFields {
  const nameMatch = blockText.match(NAME_LINE_RE);
  const name = nameMatch ? cleanValue(nameMatch[1]) : null;
  if (!name) notes.push(`Name im ${label}-Block nicht gefunden`);

  const emailMatch = blockText.match(EMAIL_LINE_RE);
  let email = emailMatch ? cleanValue(emailMatch[1]) : null;
  if (!email) {
    notes.push(`E-Mail im ${label}-Block nicht gefunden`);
  } else if (!EMAIL_SHAPE_RE.test(email)) {
    notes.push(`E-Mail-Wert sieht nicht wie eine gültige Adresse aus: "${email}" — nicht übernommen`);
    email = null;
  }

  const phoneMatch = blockText.match(PHONE_LINE_RE);
  const phone = phoneMatch ? cleanValue(phoneMatch[1]) : null;
  if (!phone) notes.push(`Telefon im ${label}-Block nicht angegeben (Feld ist in der Quelle optional)`);

  const addressMatch = blockText.match(ADDRESS_LINE_RE);
  const addressRaw = addressMatch ? cleanValue(addressMatch[1]) : null;

  let address: string | null = null;
  let city: string | null = null;
  let country: string | null = null;

  if (!addressRaw) {
    notes.push(`Adresse im ${label}-Block nicht gefunden`);
  } else if (MACHINE_DUMP_RE.test(addressRaw)) {
    address = addressRaw;
    notes.push('Adresse liegt als Formularfeld-Dump der Importquelle vor (z. B. "Address_District_1:…") — nicht zuverlässig in Straße/PLZ/Stadt aufteilbar, Rohwert in gpsr_address übernommen, gpsr_city nicht erkannt');
  } else {
    country = detectCountry(addressRaw);
    const split = splitStreetAndCity(addressRaw);
    if (split.matched) {
      address = cleanValue(split.street);
      city = cleanValue(split.city!);
    } else {
      address = addressRaw;
      notes.push('Kein sicheres PLZ+Stadt-Muster in der Adresse erkannt — voller Adresstext in gpsr_address übernommen, gpsr_city nicht erkannt (nicht geraten)');
    }
  }
  return { name, address, city, email, phone, country };
}

/**
 * Parst gpsr_raw und liefert die fünf Zielfelder für die VERANTWORTLICHE PERSON IN DER EU
 * (NICHT den Hersteller) plus den Herstellerblock getrennt. Rät nie: nicht sicher erkennbare
 * Felder bleiben `null`, mit Begründung in `notes`.
 *
 * Blockzuordnung (Paket 3): steht über einem Block ein Titel, entscheidet der Titel ("…verantwortlich…"
 * = EU, "…Hersteller…" = Hersteller) — dadurch wird auch eine vertauschte Reihenfolge richtig
 * zugeordnet. Ohne eindeutige Titel gilt wie bisher die Position (bei zwei Blöcken: der zweite = EU).
 * Ein einzelner Block ohne Titel ist nicht zuordenbar → EU-Felder leer, Meldung.
 */
export function parseGpsrRaw(raw: string | null | undefined): ParsedGpsr {
  const empty: ParsedGpsr = { name: null, address: null, city: null, email: null, phone: null, country: null, manufacturer: null, euBlockFound: false, confidence: 'nicht_erkannt', notes: [] };

  if (!raw || !raw.trim()) {
    return { ...empty, notes: ['gpsr_raw ist leer — nichts zu parsen (manueller Nachtrag nötig)'] };
  }

  const lines = raw.split(/\r?\n/);
  const nameLineIdx = findTopLevelNameLineIndices(lines);

  if (nameLineIdx.length < 1 || nameLineIdx.length > 2) {
    return {
      ...empty,
      notes: [`Erwartet 2 "Name:"-Blöcke (Hersteller + EU-Verantwortlicher), gefunden: ${nameLineIdx.length} — Format weicht vom bekannten Muster ab, nicht automatisch zuordenbar`],
    };
  }

  // Titelzeilen direkt über einem Block: alles zwischen der letzten Schlüsselzeile des Vorgängerblocks und dem Namen.
  const headerOf = (blockNo: number): string => {
    let start = 0;
    if (blockNo > 0) {
      let last = nameLineIdx[blockNo - 1];
      for (let i = nameLineIdx[blockNo - 1]; i < nameLineIdx[blockNo]; i++) if (KEY_LINE_RE.test(lines[i])) last = i;
      start = last + 1;
    }
    return lines.slice(start, nameLineIdx[blockNo]).join(' ');
  };
  const blockText = (blockNo: number): string =>
    lines.slice(nameLineIdx[blockNo], blockNo + 1 < nameLineIdx.length ? nameLineIdx[blockNo + 1] : undefined).join('\n');
  const isEu = (h: string) => EU_TITLE_RE.test(h) && !MANUF_TITLE_RE.test(h);
  const isManuf = (h: string) => MANUF_TITLE_RE.test(h) && !EU_TITLE_RE.test(h);

  let euNo: number | null = null;
  let manufNo: number | null = null;
  const notes: string[] = [];

  if (nameLineIdx.length === 2) {
    const h0 = headerOf(0), h1 = headerOf(1);
    if (isEu(h0) && !isEu(h1)) { euNo = 0; manufNo = 1; }        // vertauschte Reihenfolge, per Titel erkannt
    else { euNo = 1; manufNo = 0; }                              // Standard: Position (Titel fehlen oder passen)
  } else {
    const h0 = headerOf(0);
    if (isEu(h0)) euNo = 0;
    else if (isManuf(h0)) manufNo = 0;
    else notes.push('Einzelner Block ohne erkennbaren Titel — nicht als EU-Verantwortlicher oder Hersteller zuordenbar');
  }

  const manufacturer = manufNo !== null ? parseBlockFields(blockText(manufNo), [], 'Hersteller') : null;
  if (euNo === null) {
    notes.push('EU-Block (verantwortliche Person in der EU) fehlt — EU-Felder bleiben leer, es wird NICHT ersatzweise der Hersteller eingetragen');
    return { ...empty, manufacturer, notes };
  }

  const eu = parseBlockFields(blockText(euNo), notes, 'EU');
  const allFive = !!(eu.name && eu.address && eu.city && eu.email && eu.phone);
  const nameOrEmailFound = !!(eu.name || eu.email);
  const confidence: ParsedGpsr['confidence'] = allFive ? 'vollstaendig' : (nameOrEmailFound ? 'teilweise' : 'nicht_erkannt');

  return { name: eu.name, address: eu.address, city: eu.city, email: eu.email, phone: eu.phone, country: eu.country, manufacturer, euBlockFound: true, confidence, notes };
}

// ─── Paket 3: Pflichtangaben fürs Listing (eBay `regulatory`) ─────────────────────────────

export interface GpsrProductFields {
  gpsrRaw: string | null;
  gpsrName: string | null;
  gpsrAddress: string | null;
  gpsrCity: string | null;
  gpsrEmail: string | null;
  gpsrPhone: string | null;
  /** Paket 3b: gespeichertes Land (ISO-2) der EU-Person, hat Vorrang vor dem aus dem Rohtext erkannten. */
  gpsrCountry?: string | null;
}
export interface GpsrParty {
  name: string;
  address: string;
  postalCode: string;
  city: string;
  country: string;
  email: string;
  phone: string | null;
}
export interface GpsrManufacturer {
  name: string;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
}
export interface ResolvedGpsr {
  eu: GpsrParty | null;
  manufacturer: GpsrManufacturer | null;
  /** Klartext je fehlender Pflichtangabe der EU-Person; leer = Listing darf weiter. */
  missing: string[];
}

const PLZ_CITY_RE = new RegExp(`^(${PLZ_ALT})\\s+(.+)$`);

// Paket 3b: EU + EWR (Island, Liechtenstein, Norwegen). eBay-Angebote mit EU-Verantwortlichem
// brauchen eine Adresse in diesem Raum; alles andere (z. B. CN aus einem Hersteller-Länderwort) blockiert.
export const EU_EEA_COUNTRIES: Array<{ code: string; name: string }> = [
  ['AT', 'Österreich'], ['BE', 'Belgien'], ['BG', 'Bulgarien'], ['HR', 'Kroatien'], ['CY', 'Zypern'], ['CZ', 'Tschechien'],
  ['DK', 'Dänemark'], ['EE', 'Estland'], ['FI', 'Finnland'], ['FR', 'Frankreich'], ['DE', 'Deutschland'], ['GR', 'Griechenland'],
  ['HU', 'Ungarn'], ['IE', 'Irland'], ['IT', 'Italien'], ['LV', 'Lettland'], ['LT', 'Litauen'], ['LU', 'Luxemburg'], ['MT', 'Malta'],
  ['NL', 'Niederlande'], ['PL', 'Polen'], ['PT', 'Portugal'], ['RO', 'Rumänien'], ['SK', 'Slowakei'], ['SI', 'Slowenien'],
  ['ES', 'Spanien'], ['SE', 'Schweden'], ['IS', 'Island'], ['LI', 'Liechtenstein'], ['NO', 'Norwegen'],
].map(([code, name]) => ({ code, name }));
const EU_EEA_CODES = new Set(EU_EEA_COUNTRIES.map(c => c.code));

export function isEuEeaCountry(code: string | null | undefined): boolean {
  return !!code && EU_EEA_CODES.has(code);
}

/** trim + Großbuchstaben, genau 2 Buchstaben — sonst null. */
export function normalizeCountryCode(v: string | null | undefined): string | null {
  const c = (v ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : null;
}

/** Erfüllt der Wert das Format "PLZ Stadt" (Formularprüfung im Produkt-Tab nutzt dieselbe Regel wie das Listing). */
export function isPostalCityFormat(v: string | null | undefined): boolean {
  return PLZ_CITY_RE.test((v ?? '').trim());
}

/**
 * EU-Person fürs Listing: gespeicherte Einzelfelder haben Vorrang, leere werden aus gpsr_raw
 * ergänzt (nur im Speicher, kein DB-Schreiben). Kein Ersatz durch Hersteller oder Stele-Adresse:
 * fehlt eine Pflichtangabe (Name, Adresse, PLZ+Stadt, Land, E-Mail), ist `eu` null und `missing`
 * nennt sie im Klartext. Telefon ist optional. Der Hersteller ist optional (wird mitgesendet, wenn erkannt).
 */
export function resolveGpsrForListing(p: GpsrProductFields): ResolvedGpsr {
  const parsed = parseGpsrRaw(p.gpsrRaw);
  const pick = (stored: string | null, fromRaw: string | null) => (stored && stored.trim() ? stored.trim() : fromRaw);
  const name = pick(p.gpsrName, parsed.name);
  const address = pick(p.gpsrAddress, parsed.address);
  const cityRaw = pick(p.gpsrCity, parsed.city);
  const email = pick(p.gpsrEmail, parsed.email);
  const phone = pick(p.gpsrPhone, parsed.phone);
  // Paket 3b: gespeichertes Land (Produkt-Tab) hat Vorrang, sonst aus dem Rohtext — wie bei den anderen Feldern.
  const storedCountry = normalizeCountryCode(p.gpsrCountry);
  const country = storedCountry ?? parsed.country;

  const missing: string[] = [];
  if (!name) missing.push('Name der verantwortlichen Person in der EU');
  if (!address) missing.push('Adresse (Straße) der verantwortlichen Person in der EU');
  const cityMatch = cityRaw ? cityRaw.match(PLZ_CITY_RE) : null;
  if (!cityMatch) missing.push('PLZ und Stadt der verantwortlichen Person in der EU (Format "PLZ Stadt", z. B. 75017 Paris)');
  if (!email) missing.push('E-Mail der verantwortlichen Person in der EU');
  if (!country) missing.push('Land der verantwortlichen Person in der EU (nicht aus der Adresse erkennbar — im Produkt-Tab unter GPSR auswählen)');
  else if (!EU_EEA_CODES.has(country)) missing.push(`Land der verantwortlichen Person liegt außerhalb der EU/des EWR (${country}) — eBay verlangt eine Adresse in der EU, bitte im Produkt-Tab korrigieren`);
  const m = parsed.manufacturer;
  const manufacturer: GpsrManufacturer | null = m && m.name ? {
    name: m.name, address: m.address,
    postalCode: m.city?.match(PLZ_CITY_RE)?.[1] ?? null, city: m.city?.match(PLZ_CITY_RE)?.[2] ?? null,
    country: m.country, email: m.email, phone: m.phone,
  } : null;

  // NL-Format "1012 AB" nur bei Land NL: sonst wäre z. B. "1010 AT Wien" (Ländercode nach der PLZ) still eine falsche PLZ.
  if (cityMatch && /^\d{4}\s?[A-Z]{2}$/.test(cityMatch[1]) && country && country !== 'NL') missing.push(`PLZ "${cityMatch[1]}" hat das niederländische Format, das Land ist aber ${country} — bitte PLZ und Stadt prüfen (Format "PLZ Stadt")`);

  if (missing.length > 0 || !name || !address || !cityMatch || !email || !country) return { eu: null, manufacturer, missing };
  return { eu: { name, address, postalCode: cityMatch[1], city: cityMatch[2], country, email, phone: phone ?? null }, manufacturer, missing: [] };
}

// ─── Paket 3 (A3) / 3b: Einzelfelder beim Import aus gpsrRaw ableiten ─────────────────────────
// Nur die VERANTWORTLICHE PERSON IN DER EU (der Hersteller bleibt draußen), nur erkannte Felder, nie geraten.
// `onlyIfComplete` (Re-Import/Update-Zweig): nur wenn alle fünf Felder erkannt sind — dann werden sie
// GEMEINSAM überschrieben, inklusive Land (erkannt+EU/EWR, sonst null), damit kein veraltetes gespeichertes Land
// (Vorrang vor dem Rohtext!) zu einer neuen Firma stehen bleibt.
export interface GpsrImportFields {
  gpsrName?: string; gpsrAddress?: string; gpsrCity?: string; gpsrEmail?: string; gpsrPhone?: string; gpsrCountry?: string | null;
}
export function gpsrFieldsFromRaw(raw: string | null | undefined, onlyIfComplete = false): GpsrImportFields {
  const g = parseGpsrRaw(raw);
  if (!g.euBlockFound) return {};
  if (onlyIfComplete && g.confidence !== 'vollstaendig') return {};
  const country = isEuEeaCountry(g.country) ? g.country : null;
  return {
    ...(g.name ? { gpsrName: g.name } : {}), ...(g.address ? { gpsrAddress: g.address } : {}),
    ...(g.city ? { gpsrCity: g.city } : {}), ...(g.email ? { gpsrEmail: g.email } : {}),
    ...(g.phone ? { gpsrPhone: g.phone } : {}),
    // Erstimport: nur füllen, wenn erkannt (ein Nicht-EU-Wort bleibt leer und blockiert beim Listen mit Klartext).
    ...(onlyIfComplete ? { gpsrCountry: country } : country ? { gpsrCountry: country } : {}),
  };
}
