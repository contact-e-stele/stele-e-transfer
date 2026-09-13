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

export interface ParsedGpsr {
  name: string | null;
  address: string | null;
  city: string | null;
  email: string | null;
  phone: string | null;
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
  return COUNTRY_WORDS.has(w.toLowerCase().replace(/[()]/g, ''));
}

const PL_CHARS = "A-Za-zÀ-ÿŁŚŻŹĆŃÓĄĘłśżźćńóąę.'\\-";
// PLZ: 4-5 Ziffern (DE/FR/ES u. a.) ODER polnisches Format XX-XXX. Nicht direkt nach einer
// Ziffer/einem "/" (verhindert Fehltreffer in Hausnummern wie "1/1401").
const FORWARD_RE = new RegExp(`(?<![\\d/-])(\\d{2}-\\d{3}|\\d{4,5})[\\s,]+([${PL_CHARS}]+(?:\\s+[${PL_CHARS}]+){0,2})`, 'g');
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

/**
 * Parst gpsr_raw und liefert die fünf Zielfelder für den EU-Verantwortlichen (zweiter Block —
 * NICHT der Hersteller/erste Block). Rät nie: nicht sicher erkennbare Felder bleiben `null`,
 * mit Begründung in `notes`.
 */
export function parseGpsrRaw(raw: string | null | undefined): ParsedGpsr {
  const empty: ParsedGpsr = { name: null, address: null, city: null, email: null, phone: null, confidence: 'nicht_erkannt', notes: [] };

  if (!raw || !raw.trim()) {
    return { ...empty, notes: ['gpsr_raw ist leer — nichts zu parsen (manueller Nachtrag nötig)'] };
  }

  const lines = raw.split(/\r?\n/);
  const nameLineIdx = findTopLevelNameLineIndices(lines);

  if (nameLineIdx.length !== 2) {
    return {
      ...empty,
      notes: [`Erwartet genau 2 "Name:"-Blöcke (Hersteller + EU-Verantwortlicher), gefunden: ${nameLineIdx.length} — Format weicht vom bekannten Muster ab, nicht automatisch zuordenbar`],
    };
  }

  // Zweiter Block = EU-Verantwortlicher (siehe Format-Befund oben — über Position, nicht Titel).
  const block2 = lines.slice(nameLineIdx[1]).join('\n');
  const notes: string[] = [];

  const nameMatch = block2.match(NAME_LINE_RE);
  const name = nameMatch ? cleanValue(nameMatch[1]) : null;
  if (!name) notes.push('Name im EU-Block nicht gefunden');

  const emailMatch = block2.match(EMAIL_LINE_RE);
  let email = emailMatch ? cleanValue(emailMatch[1]) : null;
  if (!email) {
    notes.push('E-Mail im EU-Block nicht gefunden');
  } else if (!EMAIL_SHAPE_RE.test(email)) {
    notes.push(`E-Mail-Wert sieht nicht wie eine gültige Adresse aus: "${email}" — nicht übernommen`);
    email = null;
  }

  const phoneMatch = block2.match(PHONE_LINE_RE);
  const phone = phoneMatch ? cleanValue(phoneMatch[1]) : null;
  if (!phone) notes.push('Telefon im EU-Block nicht angegeben (Feld ist in der Quelle optional)');

  const addressMatch = block2.match(ADDRESS_LINE_RE);
  const addressRaw = addressMatch ? cleanValue(addressMatch[1]) : null;

  let address: string | null = null;
  let city: string | null = null;

  if (!addressRaw) {
    notes.push('Adresse im EU-Block nicht gefunden');
  } else if (MACHINE_DUMP_RE.test(addressRaw)) {
    address = addressRaw;
    notes.push('Adresse liegt als Formularfeld-Dump der Importquelle vor (z. B. "Address_District_1:…") — nicht zuverlässig in Straße/PLZ/Stadt aufteilbar, Rohwert in gpsr_address übernommen, gpsr_city nicht erkannt');
  } else {
    const split = splitStreetAndCity(addressRaw);
    if (split.matched) {
      address = cleanValue(split.street);
      city = cleanValue(split.city!);
    } else {
      address = addressRaw;
      notes.push('Kein sicheres PLZ+Stadt-Muster in der Adresse erkannt — voller Adresstext in gpsr_address übernommen, gpsr_city nicht erkannt (nicht geraten)');
    }
  }

  const allFive = !!(name && address && city && email && phone);
  const nameOrEmailFound = !!(name || email);
  const confidence: ParsedGpsr['confidence'] = allFive ? 'vollstaendig' : (nameOrEmailFound ? 'teilweise' : 'nicht_erkannt');

  return { name, address, city, email, phone, confidence, notes };
}
