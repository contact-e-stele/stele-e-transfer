// A-029 (P-E01, Beschluss Inhaber 04.10.2026): Elektro Kat. 5 Kleingeräte — REINE Funktionen (kein DB-/eBay-Zugriff).
// Listing-Sperre (wie die GPSR-Sperre: Abbruch VOR eBay mit Klartext), Import-Vorschlag, WEEE-Format, EAR-Umlage, CSV für die Mengenmeldung.
// Bestehende Produkte haben isElectric = null und electricSuggested = false → NICHT elektro → alles wie bisher (Live-Angebote unberührt).
import { EAR_UMLAGE_EUR, BATTERY_REGISTRATION_PRESENT } from './constants';

export const PROOF_KEYS = ['ce', 'declaration', 'manual', 'weeeSymbol'] as const;
export type ProofKey = typeof PROOF_KEYS[number];
export const PROOF_LABELS: Record<ProofKey, string> = {
  ce: 'CE-Kennzeichnung',
  declaration: 'EU-Konformitätserklärung/RoHS vom Lieferanten',
  manual: 'deutsche Anleitung',
  weeeSymbol: 'Kennzeichnung durchgestrichene Mülltonne',
};
export type ElectricProofs = Partial<Record<ProofKey, { ok: boolean; note: string }>>;

// "Häkchen + Beleg" (Auftrag): ein Nachweis zählt nur, wenn das Häkchen gesetzt UND ein Beleg-Text/-Link eingetragen ist.
export function parseElectricProofs(json: string | null | undefined): ElectricProofs {
  if (!json) return {};
  try {
    const raw = JSON.parse(json) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: ElectricProofs = {};
    for (const k of PROOF_KEYS) {
      const v = (raw as Record<string, unknown>)[k];
      if (v && typeof v === 'object') {
        const o = v as { ok?: unknown; note?: unknown };
        out[k] = { ok: o.ok === true, note: typeof o.note === 'string' ? o.note : '' };
      }
    }
    return out;
  } catch { return {}; }
}

export function normalizeWeeeNr(s: string | null | undefined): string | null {
  const t = (s ?? '').trim().toUpperCase();
  return t === '' ? null : t;
}
// Format laut Auftrag: "DE" + 8 Ziffern; leer ist erlaubt (= nicht eingetragen).
export const isValidWeeeNr = (s: string | null | undefined): boolean => { const n = normalizeWeeeNr(s); return n === null || /^DE\d{8}$/.test(n); };

export interface ElectricSettings { weeeRegNr: string | null; registeredDeviceTypes: string[]; batteryRegistration?: boolean }
export interface ElectricProduct {
  isElectric?: boolean | number | null;        // null/undefined = nicht entschieden
  electricSuggested?: boolean | number | null; // Import-Vorschlag (gelb "Elektro?"), noch nicht bestätigt
  deviceType?: string | null;
  hasBattery?: boolean | number | null;
  electricProofs?: string | null;
}

const truthy = (v: unknown) => v === true || v === 1;
const falsy = (v: unknown) => v === false || v === 0;
export const isElectricYes = (p: ElectricProduct): boolean => truthy(p.isElectric);

export interface ElectricGateResult { blocked: boolean; reasons: string[]; message: string | null }

// EINE Entscheidungsstelle für die Listing-Sperre. Gesperrt (Klartext "Elektro-Sperre: …") wenn
//  - Batterie/Akku = ja (egal ob Elektro bestätigt — Batterie-Artikel werden nie gelistet, solange keine Batterie-Registrierung vorliegt),
//  - Elektro = unbestätigter Import-Vorschlag (isElectric null + electricSuggested): sperrt, bis der Inhaber ja/nein wählt,
//  - Elektro = ja UND: WEEE-Nr. fehlt/ungültig · Geräteart leer oder nicht registriert · ein Nachweis (Häkchen + Beleg) fehlt.
// Nicht-Elektro (isElectric = nein, oder nie markiert und kein Vorschlag) → nie gesperrt.
export function evaluateElectricGate(p: ElectricProduct, s: ElectricSettings): ElectricGateResult {
  const reasons: string[] = [];
  const batteryRegistered = s.batteryRegistration ?? BATTERY_REGISTRATION_PRESENT;
  if (truthy(p.hasBattery) && !batteryRegistered) reasons.push('Batterie nicht erlaubt');
  const electric = isElectricYes(p);
  if (!electric && !falsy(p.isElectric) && truthy(p.electricSuggested)) {
    reasons.push('Elektro-Vorschlag nicht bestätigt (bitte Elektro ja/nein wählen)');
  }
  if (electric) {
    const weee = normalizeWeeeNr(s.weeeRegNr);
    if (!weee) reasons.push('WEEE-Reg.-Nr. fehlt');
    else if (!isValidWeeeNr(weee)) reasons.push('WEEE-Reg.-Nr. ungültig (Format DE + 8 Ziffern)');
    const dt = (p.deviceType ?? '').trim();
    if (!dt) reasons.push('Geräteart fehlt');
    else if (!s.registeredDeviceTypes.some(r => r.trim() === dt)) reasons.push(`Geräteart "${dt}" nicht registriert`);
    const proofs = parseElectricProofs(p.electricProofs);
    for (const k of PROOF_KEYS) {
      const pr = proofs[k];
      if (!pr || !pr.ok || pr.note.trim() === '') reasons.push(`Nachweis fehlt: ${PROOF_LABELS[k]}`);
    }
  }
  return { blocked: reasons.length > 0, reasons, message: reasons.length > 0 ? 'Elektro-Sperre: ' + reasons.join('; ') : null };
}

// Import-Vorschlag (NUR vorschlagen, nie setzen): Wörter aus dem Auftrag (+ gängige englische Entsprechungen der AliExpress-Titel).
// Kurze/mehrdeutige Begriffe nur als ganzes Wort (LED, USB, Watt, Volt, mAh, englische Wörter — "Wattestäbchen" ist kein Treffer).
// Deutsche Stämme auch mitten im Wort (Stromkabel, Ladekabel, Beheizt, Taschenlampe): ein übersehener Elektro-Artikel ist riskanter als ein
// Fehlalarm (der Vorschlag sperrt nur, bis der Inhaber ja/nein wählt).
const WHOLE_WORDS = ['USB', 'LED', 'Watt', 'Volt', 'mAh', 'cables?', 'lamps?', 'power', 'chargers?', 'fans?', 'heaters?', 'electric', 'bluetooth', 'wireless', 'solar', 'sensors?', 'speakers?', 'headphones?', 'earphones?', 'timer'];
const STEMS = ['Kabel', 'Motor', 'Lampe', 'Strom', 'Akku', 'Batter', 'Knopfzelle', 'elektr', 'Ladeger', 'Netzteil', 'Ventilator', 'Heiz', 'Steckdose', 'Lautsprecher', 'Kopfh\u00f6rer', 'L\u00fcfter', 'Leuchte', 'rechargeable', 'button\\s+cell'];
// Ohne Lookbehind (ältere Browser): Ganzwort = Trennzeichen davor (oder Anfang) + Wort + kein Buchstabe danach; Spannung "12V"/"5V"/"3.7V".
const SUGGEST_SRC =
  `(?:^|[^\\p{L}\\p{N}])(?:${WHOLE_WORDS.join('|')})(?![\\p{L}\\p{N}])|\\d+(?:[.,]\\d+)?V(?![\\p{L}\\p{N}])|(?:${STEMS.join('|')})`;

export function suggestElectric(texts: Array<string | null | undefined>): { suggested: boolean; matches: string[] } {
  const matches = new Set<string>();
  for (const t of texts) {
    if (!t) continue;
    for (const m of t.matchAll(new RegExp(SUGGEST_SRC, 'giu'))) matches.add(m[0].replace(/^[^\p{L}\p{N}]+/u, '').toLowerCase());
  }
  return { suggested: matches.size > 0, matches: [...matches] };
}

// EAR-Umlage: nur bei Elektro = ja (bestätigt). Nicht-Elektro → exakt 0 → Formel unverändert.
export function earUmlageFor(p: ElectricProduct | boolean | number | null | undefined, umlage: number = EAR_UMLAGE_EUR): number {
  const yes = typeof p === 'object' && p !== null ? isElectricYes(p) : truthy(p);
  return yes && Number.isFinite(umlage) && umlage > 0 ? umlage : 0;
}

// Textzeile fürs Angebot (Auftrag Punkt 4): reiner Text, ohne Link/URL/E-Mail. Leer, wenn kein bestätigtes Elektro-Produkt oder keine gültige Nummer.
export function weeeLineForListing(p: ElectricProduct, weeeRegNr: string | null | undefined): string | null {
  const n = normalizeWeeeNr(weeeRegNr);
  return isElectricYes(p) && n && isValidWeeeNr(n) ? `WEEE-Reg.-Nr. ${n}` : null;
}

// ─── CSV "Elektro-Verkäufe je Geräteart und Monat" (nur lesen; keine Meldung an die stiftung ear) ──────────────────────
export interface ElectricSaleLine { orderId: string; date: string; productId: number; deviceType: string; quantity: number }
export function buildElectricSalesCsv(lines: ElectricSaleLine[]): string {
  const groups = new Map<string, { month: string; deviceType: string; qty: number; orders: Set<string> }>();
  for (const l of lines) {
    const month = /^\d{4}-\d{2}/.test(l.date) ? l.date.slice(0, 7) : 'unbekannt';
    const key = `${month}\u0000${l.deviceType}`;
    const g = groups.get(key) ?? { month, deviceType: l.deviceType, qty: 0, orders: new Set<string>() };
    g.qty += l.quantity; g.orders.add(l.orderId); groups.set(key, g);
  }
  const esc = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const rows = [...groups.values()].sort((a, b) => a.month.localeCompare(b.month) || a.deviceType.localeCompare(b.deviceType));
  return ['Monat;Geräteart;Stückzahl;Bestellnummern', ...rows.map(g => [g.month, esc(g.deviceType), String(g.qty), esc([...g.orders].sort().join(', '))].join(';'))].join('\n') + '\n';
}

// ─── PATCH /products/:id — Elektro-Felder (Validierung rein; die Geräteart muss in den registrierten Gerätearten stehen) ──────────────
export type ElectricPatchParse = { ok: true; fields: Record<string, unknown> } | { ok: false; error: string };
export function parseElectricPatch(body: Record<string, unknown>, registeredDeviceTypes: string[]): ElectricPatchParse {
  const fields: Record<string, unknown> = {};
  if ('isElectric' in body) {
    const v = body.isElectric;
    if (v !== null && v !== true && v !== false) return { ok: false, error: '"isElectric" muss true, false oder null (nicht entschieden) sein' };
    fields.isElectric = v === null ? null : v ? 1 : 0;
  }
  if ('hasBattery' in body) {
    if (typeof body.hasBattery !== 'boolean') return { ok: false, error: '"hasBattery" muss true oder false sein' };
    fields.hasBattery = body.hasBattery ? 1 : 0;
  }
  if ('deviceType' in body) {
    const v = body.deviceType;
    if (v !== null && typeof v !== 'string') return { ok: false, error: '"deviceType" muss ein Text oder null sein' };
    const t = typeof v === 'string' ? v.trim() : '';
    if (t !== '' && !registeredDeviceTypes.some(r => r.trim() === t)) return { ok: false, error: `Geräteart "${t}" ist nicht registriert (nur: ${registeredDeviceTypes.join(', ') || '–'})` };
    fields.deviceType = t === '' ? null : t;
  }
  if ('electricProofs' in body) {
    const v = body.electricProofs;
    if (v === null) fields.electricProofs = null;
    else {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: '"electricProofs" muss ein Objekt oder null sein' };
      const out: ElectricProofs = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (!(PROOF_KEYS as readonly string[]).includes(k)) return { ok: false, error: `Unbekannter Nachweis "${k}"` };
        const o = val as { ok?: unknown; note?: unknown } | null;
        if (!o || typeof o !== 'object' || typeof o.ok !== 'boolean' || (o.note !== undefined && typeof o.note !== 'string')) return { ok: false, error: `Nachweis "${k}" muss { ok: true/false, note: Text } sein` };
        out[k as ProofKey] = { ok: o.ok, note: (o.note ?? '').slice(0, 500) };
      }
      fields.electricProofs = JSON.stringify(out);
    }
  }
  return { ok: true, fields };
}

// Einstellungen: WEEE-Nr. (Format DE + 8 Ziffern, leer erlaubt) und Liste der registrierten Gerätearten.
export function parseElectricSettingsBody(body: unknown): { ok: true; weeeRegNr?: string | null; registeredDeviceTypes?: string[] } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Body fehlt' };
  const b = body as Record<string, unknown>;
  const out: { ok: true; weeeRegNr?: string | null; registeredDeviceTypes?: string[] } = { ok: true };
  if ('weeeRegNr' in b) {
    if (b.weeeRegNr !== null && typeof b.weeeRegNr !== 'string') return { ok: false, error: '"weeeRegNr" muss ein Text oder null sein' };
    if (!isValidWeeeNr(b.weeeRegNr as string | null)) return { ok: false, error: 'WEEE-Reg.-Nr. ungültig — Format: "DE" + 8 Ziffern (oder leer lassen)' };
    out.weeeRegNr = normalizeWeeeNr(b.weeeRegNr as string | null);
  }
  if ('registeredDeviceTypes' in b) {
    const v = b.registeredDeviceTypes;
    if (!Array.isArray(v) || v.length > 20 || !v.every(x => typeof x === 'string' && x.trim() !== '' && x.length <= 80)) return { ok: false, error: '"registeredDeviceTypes" muss eine Liste (max. 20) nicht-leerer Texte sein' };
    out.registeredDeviceTypes = [...new Set((v as string[]).map(x => x.trim()))];
  }
  return out;
}
