// Beschreibung v4 "eine Seite" (Inhaber "v4 JA", 08.11.2026) — reine Funktionen (Grundgesetz 2), kein DB-/Netz-Zugriff.
// Baut auf v3 (shared/description-v3.ts) auf und nutzt dieselben Quellen (Grundgesetz 8):
//   Menge/Maß/Material: piecesOf / measureText / materialText aus description-v3.ts
//   Stichpunkte       : v3Bullets ("STICHWORT: Satz", Gemini) — Versand-/Rückgabe-Füllsätze fallen dort schon weg
//   Versand/Rückgabe/Zahlung: shared/shipping-return-text.ts (keine neuen Texte)
//   WEEE              : weeeLineForListing (shared/electric.ts), nur bei bestätigtem Elektro
// Grundgesetz 4: fehlt ein Wert, fällt die Zeile/Angabe weg — kein Platzhalter, kein Füllsatz.
import { piecesOf, formatPieces, measureText, materialText, FOOTER_TOPIC_RE, type DescriptionV3Input, type V3Bullet } from './description-v3';
import { NEUTRAL_RETURN_TEXT, type ReturnTerms } from './shipping-return-text';

/** Merkmal der v4-Vorlage — beim Listen wird eine gespeicherte Vorlage nur übernommen, wenn sie das AKTIVE Merkmal trägt. */
export const DESCRIPTION_V4_MARKER = '<!-- stele-beschreibung: v4 -->';

/**
 * SCHALTER: welche Vorlage beim Listen, im Nachzieh-Weg und in den Vorschauen gebaut wird.
 * Default 'v3' (AUS) — Live-Angebote gehen NICHT automatisch auf v4. Umstellen auf 'v4' erst nach eigenem Inhaber-Ja.
 */
export type DescriptionVersion = 'v3' | 'v4';
export const DESCRIPTION_VERSION: DescriptionVersion = 'v3';

/** Feste Schlüssel der Stichwort-Zeilen, in dieser Reihenfolge. */
export const V4_KEYS = ['MATERIAL', 'MASSE', 'LIEFERUMFANG', 'ANWENDUNG', 'BESONDERHEIT'] as const;
export type V4Key = typeof V4_KEYS[number];
export interface V4Row { key: V4Key; text: string }

// Stichwörter aus den Gemini-Stichpunkten, die einem festen Schlüssel entsprechen (Großschreibung wie v3Bullets liefert).
const KEY_ALIASES: Record<V4Key, string[]> = {
  MATERIAL: ['MATERIAL', 'MATERIALIEN', 'WERKSTOFF'],
  MASSE: ['MASSE', 'MAßE', 'MASS', 'MAß', 'GRÖSSE', 'GRÖßE', 'ABMESSUNG', 'ABMESSUNGEN'],
  LIEFERUMFANG: ['LIEFERUMFANG', 'INHALT', 'MENGE', 'PACKUNGSINHALT'],
  ANWENDUNG: ['ANWENDUNG', 'VERWENDUNG', 'EINSATZ', 'EINSATZBEREICH', 'ANWENDUNGSBEREICH'],
  BESONDERHEIT: ['BESONDERHEIT', 'BESONDERHEITEN'],
};

const clean = (s: string | null | undefined): string => String(s ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const esc = (s: string): string => s.replace(/&(?![a-zA-Z]+;|#\d+;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function keyOf(keyword: string | null): V4Key | null {
  if (!keyword) return null;
  for (const k of V4_KEYS) if (KEY_ALIASES[k].includes(keyword)) return k;
  return null;
}

/**
 * Höchstens 5 Stichwort-Zeilen mit den festen Schlüsseln. Produktdaten (A-045) gehen vor Gemini-Stichpunkten.
 * BESONDERHEIT: Stichpunkt mit Stichwort BESONDERHEIT, sonst der erste Stichpunkt, der keinem anderen Schlüssel zugeordnet ist.
 * Leere Zeilen fallen weg.
 */
export function v4Rows(input: DescriptionV3Input, bullets: V3Bullet[]): V4Row[] {
  const fromBullet: Partial<Record<V4Key, string>> = {};
  const unmatched: string[] = [];
  for (const b of bullets) {
    const text = clean(b.text);
    if (!text) continue;
    const k = keyOf(b.keyword);
    if (k && !fromBullet[k]) fromBullet[k] = text;
    else if (!k) unmatched.push(text);
  }
  const measure = measureText(input.variantDetails);
  const usage = [clean(input.usePurpose), clean(input.usageNote)].filter(Boolean).map(esc).join(' &middot; ');
  const values: Record<V4Key, string | null> = {
    MATERIAL: materialText(input) ?? fromBullet.MATERIAL ?? null,
    MASSE: measure.uniform ?? measure.perVariant ?? fromBullet.MASSE ?? null,
    LIEFERUMFANG: formatPieces(piecesOf(input)) ?? fromBullet.LIEFERUMFANG ?? null,
    ANWENDUNG: usage || fromBullet.ANWENDUNG || null,
    BESONDERHEIT: fromBullet.BESONDERHEIT ?? unmatched[0] ?? null,
  };
  return V4_KEYS.filter(k => values[k]).map(k => ({ key: k, text: values[k] as string }));
}

/**
 * Ein Einleitungssatz. Basis: erster Satz der Gemini-Einleitung (###INTRO###), sofern er kein Versand-/Rückgabe-Füllsatz ist.
 * Dazu Menge und einheitliches Maß aus den Produktdaten — fehlen sie, steht der Satz ohne diese Angabe.
 * Ganz ohne Einleitung: nur "Inhalt … · Maße …", ohne Daten → null (kein Füllsatz).
 */
export function introSentence(input: DescriptionV3Input, introText: string | null | undefined): string | null {
  const pieces = formatPieces(piecesOf(input));
  const m = measureText(input.variantDetails).uniform;
  const facts = [pieces, m ? `Ma&szlig;e ${m}` : null].filter((x): x is string => !!x);
  const first = clean(introText).split(/[.!?]\s+/)[0]?.replace(/[.!?]+$/, '').trim() ?? '';
  const base = first.length >= 10 && !FOOTER_TOPIC_RE.test(first) ? first : '';
  if (base) return facts.length > 0 ? `${base} (${facts.join(', ')}).` : `${base}.`;
  if (facts.length === 0) return null;
  return `${pieces ? `Inhalt: ${pieces}` : ''}${pieces && m ? ' &middot; ' : ''}${m ? `Ma&szlig;e: ${m}` : ''}.`;
}

// ABNAHME DESIGN S1 M2 (08.11.2026): Chips = kurzes Versprechen, Einzelheiten (Lieferzeit, Zahlungstext) NUR unten in den Kästen.
// Kein "Kostenloser Versand": ob der Versand kostenlos ist, steht nicht in den Produktdaten (Regel 4 – nichts erfinden).
export const SHIPPING_CHIP_TEXT = 'Versand mit Sendungsnummer';
export const PAYMENT_PROMISE_CHIP_TEXT = 'Sicher bezahlen &uuml;ber eBay';

/** Rückgabe-Chip nur aus der eBay-Richtlinie; ohne Daten neutral (keine erfundene Frist). */
export function returnChipText(terms: ReturnTerms | null | undefined): string {
  if (!terms || !terms.returnsAccepted || !terms.costPayer) return NEUTRAL_RETURN_TEXT;
  const free = terms.costPayer === 'SELLER';
  if (terms.days) return free ? `${terms.days} Tage kostenlose R&uuml;ckgabe` : `${terms.days} Tage R&uuml;ckgabe`;
  return free ? 'Kostenlose R&uuml;ckgabe' : 'R&uuml;ckgabe m&ouml;glich';
}

/** Genau 3 Vertrauens-Chips. deliveryTime bleibt Parameter (Aufrufer unverändert), steht aber nur im Kasten Versand. */
export function trustChips(_deliveryTime: string | null | undefined, terms: ReturnTerms | null | undefined): [string, string, string] {
  return [SHIPPING_CHIP_TEXT, returnChipText(terms), PAYMENT_PROMISE_CHIP_TEXT];
}

/** ABNAHME DESIGN S1 M1: Titel der Leiste. Gespeicherte Titel sind hart auf 80 Zeichen gekürzt (mitten im Wort) —
 *  ab 80 Zeichen am letzten ganzen Wort kürzen, Satzzeichen am Ende weg. Kürzere Titel bleiben unverändert. */
export const TITLE_HARD_LIMIT = 80;
export function titleBarText(title: string): string {
  const t = title.trim();
  if (t.length < TITLE_HARD_LIMIT) return t;
  const cut = t.slice(0, TITLE_HARD_LIMIT);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > 20 ? cut.slice(0, lastSpace) : cut;
  return base.replace(/[\s,;:\-–·&]+$/, '').trim();
}
