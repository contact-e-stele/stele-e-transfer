// Beschreibung v4 "eine Seite" (Inhaber "v4 JA", 08.11.2026) — reine Funktionen (Grundgesetz 2), kein DB-/Netz-Zugriff.
// Baut auf v3 (shared/description-v3.ts) auf und nutzt dieselben Quellen (Grundgesetz 8):
//   Stichwort-Zeilen + Einleitung mit Produktart: Pflicht-Daten P1–P7 (shared/pflicht-daten.ts, Design-Sprint S2)
//   Einleitung ohne Produktart: Gemini-###INTRO### + piecesOf / measureText aus description-v3.ts (wie bisher)
//   Versand/Rückgabe/Zahlung: shared/shipping-return-text.ts (keine neuen Texte)
//   WEEE              : weeeLineForListing (shared/electric.ts), nur bei bestätigtem Elektro
// Grundgesetz 4: fehlt ein Wert, fällt die Zeile/Angabe weg — kein Platzhalter, kein Füllsatz.
import { piecesOf, formatPieces, measureText, FOOTER_TOPIC_RE, type DescriptionV3Input } from './description-v3';
import { resolvePflichtDaten, type PflichtInput, type ResolvedPflichtDaten } from './pflicht-daten';
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

const clean = (s: string | null | undefined): string => String(s ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const esc = (s: string): string => s.replace(/&(?![a-zA-Z]+;|#\d+;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** v4-Eingabe = v3-Eingabe + Pflicht-Daten (Design-Sprint S2): Varianten-Einträge, Material-Quelle, gespeicherte pflicht_daten. */
export type DescriptionV4Input = DescriptionV3Input & Pick<PflichtInput, 'variantPrices' | 'materialSource' | 'pflichtDaten' | 'productId'>;

/** Pflicht-Daten des Produkts — EINE Lesestelle für v4 und die eBay-Merkmale (shared/pflicht-daten.ts, Grundgesetz 8). */
export function pflichtOf(input: DescriptionV4Input): ResolvedPflichtDaten {
  return resolvePflichtDaten({
    productId: input.productId, specs: input.specs, variants: input.variants, variantPrices: input.variantPrices,
    material: input.material, materialSource: input.materialSource, usePurpose: input.usePurpose, usageNote: input.usageNote,
    variantDetails: input.variantDetails, manualAspects: input.manualAspects, pflichtDaten: input.pflichtDaten,
  });
}

/**
 * Höchstens 5 Stichwort-Zeilen mit den festen Schlüsseln — Design-Sprint S2: NUR aus den Pflicht-Daten
 * (MATERIAL = P2, MASSE = P3, LIEFERUMFANG = P4, ANWENDUNG = P6, BESONDERHEIT = P7). Gemini-Stichpunkte füllen keine Zeile mehr
 * (nicht belegbar, Grundgesetz 4). Leere Zeilen fallen weg.
 */
export function v4Rows(input: DescriptionV4Input): V4Row[] {
  const r = pflichtOf(input);
  const t = (f: { value: string } | null): string | null => (f && clean(f.value) ? esc(clean(f.value)) : null);
  const values: Record<V4Key, string | null> = {
    MATERIAL: t(r.material),
    MASSE: r.masseText,
    LIEFERUMFANG: t(r.lieferumfang),
    ANWENDUNG: t(r.anwendung),
    BESONDERHEIT: t(r.besonderheit),
  };
  return V4_KEYS.filter(k => values[k]).map(k => ({ key: k, text: values[k] as string }));
}

/**
 * Ein Einleitungssatz. Design-Sprint S2: mit Produktart (P1) "<Produktart> aus <Material>, <Menge>, <Maß>." — fehlende Teile fallen weg,
 * Maß nur, wenn es für alle Varianten gleich ist. Ohne Produktart wie bisher: erster Satz der Gemini-Einleitung (###INTRO###), sofern er
 * kein Versand-/Rückgabe-Füllsatz ist, plus Menge/Maß aus den Produktdaten; ganz ohne Einleitung nur "Inhalt … · Maße …", ohne Daten → null.
 */
export function introSentence(input: DescriptionV4Input, introText: string | null | undefined): string | null {
  const r = pflichtOf(input);
  if (r.produktart) {
    const uniform = measureText(Object.fromEntries(Object.entries(r.masse).map(([k, m]) => [k, { measure: m }]))).uniform;
    const t = (f: { value: string } | null): string => (f ? esc(clean(f.value)) : '');
    const facts = [t(r.lieferumfang), uniform].filter((x): x is string => !!x);
    const mat = t(r.material);
    return `${t(r.produktart)}${mat ? ` aus ${mat}` : ''}${facts.length ? `, ${facts.join(', ')}` : ''}.`;
  }
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
