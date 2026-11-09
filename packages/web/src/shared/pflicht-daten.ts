// Design-Sprint S2 "Pflicht-Daten" (Auftrag Aufsicht 043, 09.11.2026) — reine Funktionen (Grundgesetz 2), kein DB-/Netz-Zugriff.
//
// Jedes Produkt bekommt belegte Pflicht-Daten P1–P7, aus denen Beschreibung v4 (description-v4.ts) UND die eBay-Artikelmerkmale
// (ebay.ts buildAspects) lesen — EINE Lesestelle: resolvePflichtDaten() (Grundgesetz 8).
//   P1 Produktart (deutsch, 1–3 Wörter) · P2 Material (deutsch) · P3 Maße je Variante (Regel D2) · P4 Lieferumfang/Menge
//   P5 Farbe je Variante (deutsch, feste Liste) · P6 Anwendung (1 kurzer Satz) · P7 Besonderheit
// Jeder Wert trägt seine QUELLE: a = AliExpress-Variantenauswahl, b = Spezifikationen, c = Bild-/Beschreibungstext, d = Größentabelle,
// dazu Fundstelle (location) und den wörtlichen Wortlaut (wording). Regel D1: Variantenauswahl schlägt Text. Nie aus Titel/Bewertungen.
// Kein belegbarer Wert → Feld LEER und Status GELB. Nichts raten, kein Englisch, kein Platzhalter (Grundgesetz 4).
//
// Speicher (Spalte products.pflicht_daten, JSON PflichtDatenStored): Import-Vorschlag (a/b) bzw. Handeingabe im Produkte-Tab.
// Lesereihenfolge je Feld: gespeichert (pflicht_daten) → bestehendes Altfeld (material/material_source, variant_details,
// use_purpose/usage_note, manualAspects.Produktart) → Vorschlag live aus den AliExpress-Daten (a vor b) → leer.
import { formatMeasure, inchesToCm, MEASURE_SOURCES, type MeasureSource, type VariantMeasure, type VariantDetails } from './variant-measure';
import { translateMaterial, MATERIAL_TEXT_KEYS, ASPECT_VALUE_MAX, type CategoryAspectDef } from './spec-aspects';
import { translateColorExact, translateVariantValue } from './variant-text-de';
import { buildCombinations, NON_VARIATION_ASPECTS, type VariantGroup } from './variant-resolver';
import { formatPieces, measureText } from './description-v3';

export type PflichtSource = MeasureSource; // 'a' | 'b' | 'c' | 'd'
export const PFLICHT_SOURCES = MEASURE_SOURCES;
export const PFLICHT_SOURCE_LABEL: Record<PflichtSource, string> = {
  a: 'AliExpress-Variantenauswahl', b: 'Spezifikationen', c: 'Bild-/Beschreibungstext', d: 'Größentabelle',
};

export interface PflichtEntry { value: string; source: PflichtSource; location: string; wording: string }
export const PRODUCT_FIELDS = ['produktart', 'material', 'lieferumfang', 'anwendung', 'besonderheit'] as const;
export type ProductField = typeof PRODUCT_FIELDS[number];
export const FIELD_LABEL: Record<ProductField | 'masse' | 'farben', string> = {
  produktart: 'P1 Produktart', material: 'P2 Material', masse: 'P3 Maße', lieferumfang: 'P4 Lieferumfang',
  farben: 'P5 Farbe', anwendung: 'P6 Anwendung', besonderheit: 'P7 Besonderheit',
};

/** Namen in der GELB-Liste ("Pflicht-Daten fehlen: Produktart, Maße"). */
export const MISSING_NAME = { produktart: 'Produktart', material: 'Material', masse: 'Maße', lieferumfang: 'Lieferumfang' } as const;

export interface PflichtDatenStored {
  produktart?: PflichtEntry;
  material?: PflichtEntry;
  lieferumfang?: PflichtEntry;
  anwendung?: PflichtEntry;
  besonderheit?: PflichtEntry;
  masse?: Record<string, VariantMeasure>;   // je Varianten-Schlüssel; measure.text = Wortlaut
  farben?: Record<string, PflichtEntry>;    // je Varianten-Schlüssel
}

export interface PflichtInput {
  productId?: number;
  title?: string | null;               // nur für den Abgleich der Produktart mit dem Produktwort im Titel (nie als Quelle)
  specs?: Record<string, string> | null;
  variants?: VariantGroup[] | null;
  variantPrices?: Array<{ skuId?: string; attrs?: Record<string, string> }> | null;
  material?: string | null;
  materialSource?: { source?: string; location?: string } | null;
  usePurpose?: string | null;
  usageNote?: string | null;
  variantDetails?: VariantDetails | null;
  manualAspects?: Record<string, string> | null;
  pflichtDaten?: PflichtDatenStored | null;
  /** Lücke 3: Text der Quelle c (Bild-/Beschreibungstext) mit Fundstelle — nur für einen Material-VORSCHLAG (nie übernommen). */
  textC?: { text: string; location: string } | null;
}

export type Herkunft = 'gespeichert' | 'altfeld' | 'vorschlag';
export interface ResolvedField { value: string; source: PflichtSource | null; location: string | null; wording: string | null; herkunft: Herkunft; hinweis?: string;
  /** Nur Produktart: das Produktwort aus dem Titel für die Einleitung (DESIGN 09.11. 12:41: Einleitung = Titelwort, Merkmal = Listenwort). */
  titelwort?: string }
export interface Unit { key: string; label: string; labelDe: string; attrs: Record<string, string> }
export interface PflichtAmpel { status: 'GRUEN' | 'GELB'; missing: string[]; text: string | null }
export interface ResolvedPflichtDaten {
  units: Unit[];
  produktart: ResolvedField | null;
  material: ResolvedField | null;
  lieferumfang: ResolvedField | null;
  anwendung: ResolvedField | null;
  besonderheit: ResolvedField | null;
  masse: Record<string, VariantMeasure & { herkunft: Herkunft }>;
  masseText: string | null;
  /** Lücke 3 (DESIGN 12:41): Material-Vorschlag aus Quelle c — NUR Hinweis, nie gespeichert/übernommen; Ampel GELB "bitte bestätigen". */
  materialVorschlagC: { value: string; wording: string; location: string } | null;
  farben: Record<string, ResolvedField>;
  unbekannteFarben: string[];
  hinweise: string[];
  ampel: PflichtAmpel;
}

export const SINGLE_UNIT_KEY = 'single';
const clean = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim();
const uniq = <T,>(xs: T[]): T[] => [...new Set(xs)];
const isShipping = (group: string): boolean => NON_VARIATION_ASPECTS.has(clean(group)) || /^ships?[\s_]*from$|^versandland$/i.test(clean(group));

// ─── Varianten-Einheiten ────────────────────────────────────────────────────────────────────────────────────────────────

/** Varianten-Schlüssel: variantPrices[].skuId; ohne Einträge die Kombinationen der Varianten-Gruppen; sonst ein Einzelartikel. */
export function unitsOf(input: Pick<PflichtInput, 'variants' | 'variantPrices'>): Unit[] {
  const mk = (key: string, attrs: Record<string, string>): Unit => {
    const own = Object.fromEntries(Object.entries(attrs ?? {}).filter(([g, v]) => !isShipping(g) && clean(v)));
    const label = Object.values(own).map(clean).join(' / ') || 'Einzelartikel';
    const de = Object.values(own).map(v => translateVariantValue(clean(v))).map(t => (t.unknownWords.length ? '' : t.value));
    return { key, label, labelDe: de.every(Boolean) ? de.join(' / ') : '', attrs: own };
  };
  const entries = (input.variantPrices ?? []).filter(v => v && clean(v.skuId));
  if (entries.length > 0) return entries.map(v => mk(clean(v.skuId), v.attrs ?? {}));
  const groups = (input.variants ?? []).filter(g => g && !isShipping(g.name) && Array.isArray(g.values) && g.values.length > 0);
  if (groups.length > 0) return buildCombinations(groups).map(combo => mk(Object.values(combo).map(clean).join(' / '), combo));
  return [{ key: SINGLE_UNIT_KEY, label: 'Einzelartikel', labelDe: 'Einzelartikel', attrs: {} }];
}

// ─── P3 Maße (Regel D2) ────────────────────────────────────────────────────────────────────────────────────────────────

const NUM = '(\\d+(?:\\.\\d+)?)';
const UNIT = '(cm|mm|inch|inches|in|")';
function toCm(n: number, unit: string): { v: number; converted: boolean } {
  const u = unit.toLowerCase();
  if (u === 'mm') return { v: Math.round(n) / 10, converted: false };
  if (u === 'inch' || u === 'inches' || u === 'in' || u === '"') return { v: inchesToCm(n), converted: true };
  return { v: n, converted: false };
}

/**
 * Ein Maß aus einem Text nach D2 — nur eindeutige Fälle, sonst null (kein Raten):
 *   "30x20x15cm" → B × T × H · "Diameter 20cm"/"Ø20cm" → Ø · "Length: 150cm" → L · "stretch 14-29cm" → ↔ (nur mit Wort dehnbar/stretch/elastic)
 *   hint 'D'/'L' (Spezifikationsschlüssel "Diameter"/"Length"): ein einzelner Wert mit Einheit genügt.
 * Zwei Maße: nur mit benannter Breite und Höhe ("W45 x H50cm", "Breite 45 cm × Höhe 50 cm") → B × H "45 × 50 cm"; ohne Benennung
 * ("45x50cm") ist unklar, welcher Wert Breite/Höhe ist → null (twoDimUnclear() liefert dafür den Hinweis). Einheit Pflicht (mm → cm, Zoll → cm).
 */
export function parseMeasureText(text: string, hint?: 'D' | 'L'): Pick<VariantMeasure, 'kind' | 'values' | 'converted'> | null {
  const t = clean(text).toLowerCase().replace(/(\d),(\d)/g, '$1.$2').replace(/\b(about|approx\.?|ca\.?)\s*/g, '');
  if (!t) return null;
  const done = (kind: VariantMeasure['kind'], nums: string[], unit: string) => {
    const conv = nums.map(n => toCm(Number(n), unit));
    if (conv.some(c => !(c.v > 0))) return null;
    return { kind, values: conv.map(c => c.v), ...(conv.some(c => c.converted) ? { converted: true } : {}) };
  };
  let m = t.match(new RegExp(`${NUM}\\s*(?:cm|mm)?\\s*[x*×]\\s*${NUM}\\s*(?:cm|mm)?\\s*[x*×]\\s*${NUM}\\s*${UNIT}(?![a-z])`));
  if (m) return done('BTH', [m[1], m[2], m[3]], m[4]);
  // B × H (flach, Design-Antwort 09.11. 07:45): nur wenn Breite UND Höhe benannt sind — sonst unklar → null (GELB statt raten).
  const W = '(?:width|breite|w|b)', H = '(?:height|höhe|hoehe|h)';
  m = t.match(new RegExp(`(?<![a-z])${W}\\s*:?\\s*${NUM}\\s*(?:cm|mm)?\\s*[x*×,]?\\s*${H}\\s*:?\\s*${NUM}\\s*${UNIT}(?![a-z])`));
  if (m) return done('BH', [m[1], m[2]], m[3]);
  m = t.match(new RegExp(`(?<![a-z])${H}\\s*:?\\s*${NUM}\\s*(?:cm|mm)?\\s*[x*×,]?\\s*${W}\\s*:?\\s*${NUM}\\s*${UNIT}(?![a-z])`));
  if (m) return done('BH', [m[2], m[1]], m[3]);
  if (/stretch|elastic|dehnbar|expandable/.test(t)) {
    m = t.match(new RegExp(`${NUM}\\s*(?:cm|mm)?\\s*(?:-|–|~|to|bis)\\s*${NUM}\\s*${UNIT}(?![a-z])`));
    if (m && Number(m[1]) <= Number(m[2])) return done('STRETCH', [m[1], m[2]], m[3]);
  }
  m = t.match(new RegExp(`(?:diameter|dia\\.?|ø|φ|durchmesser)\\s*:?\\s*${NUM}\\s*${UNIT}(?![a-z])`));
  if (m) return done('D', [m[1]], m[2]);
  m = t.match(new RegExp(`(?:length|länge)\\s*:?\\s*${NUM}\\s*${UNIT}(?![a-z])`));
  if (m) return done('L', [m[1]], m[2]);
  if (hint) {
    m = t.match(new RegExp(`^${NUM}\\s*${UNIT}$`));
    if (m) return done(hint, [m[1]], m[2]);
  }
  return null;
}

/** Zwei Zahlen mit Einheit ohne benannte Breite/Höhe ("45x50cm") — Hinweis statt Raten. */
export function twoDimUnclear(text: string): boolean {
  const t = clean(text).toLowerCase().replace(/(\d),(\d)/g, '$1.$2');
  return parseMeasureText(text) === null && new RegExp(`(?:^|[^\\d.])${NUM}\\s*(?:cm|mm)?\\s*[x*×]\\s*${NUM}\\s*${UNIT}(?![a-z])`).test(t)
    && !new RegExp(`${NUM}\\s*(?:cm|mm)?\\s*[x*×]\\s*${NUM}\\s*(?:cm|mm)?\\s*[x*×]`).test(t);
}
const twoDimHint = (where: string, text: string) => `Maß „${text}“ (${where}): unklar, welcher Wert Breite/Höhe ist — nicht übernommen`;

/**
 * DESIGN an 7 App 09.11. 12:41 Punkt 2: ein Wert der Variantenauswahl, der NUR aus Zahl + Einheit besteht ("120CM") bzw. einer
 * Spanne ("40-42CM"), ist ein Maß der Variante (Quelle a) — ohne Ø (Richtung nicht belegt) und ohne ↔ (dehnbar nicht belegt).
 * Ganzer Wert muss passen (cm/mm); alles andere ("50PCS", "S", "Pack of 100") → null, nie schätzen.
 */
export function parseVariantPlainMeasure(value: string): Pick<VariantMeasure, 'kind' | 'values'> | null {
  const t = clean(value).toLowerCase().replace(/(\d),(\d)/g, '$1.$2');
  let m = t.match(new RegExp(`^${NUM}\\s*(cm|mm)$`));
  if (m) { const v = toCm(Number(m[1]), m[2]).v; return v > 0 ? { kind: 'M', values: [v] } : null; }
  m = t.match(new RegExp(`^${NUM}\\s*(?:cm|mm)?\\s*(?:-|–)\\s*${NUM}\\s*(cm|mm)$`));
  if (m) {
    const a = toCm(Number(m[1]), m[3]).v, b = toCm(Number(m[2]), m[3]).v;
    return a > 0 && a < b ? { kind: 'SPANNE', values: [a, b] } : null;
  }
  return null;
}
/** Maß aus der Variantenauswahl ohne benannte Richtung (Art M/SPANNE, Quelle a). */
export const isVariantPlainMeasure = (m: Pick<VariantMeasure, 'kind' | 'source'> | null | undefined): boolean =>
  !!m && (m.kind === 'M' || m.kind === 'SPANNE') && m.source === 'a';
export const MASSE_LAUT_VARIANTE = '(laut Variante)';
export const MASSE_JE_VARIANTE = 'je nach Variante, siehe Auswahl';

const SIZE_GROUP = /^(size|sizes|größe|groesse|größen|dimensions?|maße|abmessungen|length|länge|diameter|durchmesser)$/i;
const SPEC_MEASURE_KEYS: Array<[RegExp, 'D' | 'L' | undefined]> = [
  [/^(diameter|durchmesser)$/i, 'D'],
  [/^(length|länge)$/i, 'L'],
  [/^(size|dimensions?|product size|item size|product dimensions|maße|abmessungen|produktgröße)$/i, undefined],
];

// ─── P1 Produktart: feste Übersetzungsliste EN→DE (wie Farbe; Design-Antwort 09.11. 07:45) ─────────────────────────────
/** Nur diese Einträge werden übersetzt (ganzer Wert, Groß/Klein egal). Unbekannter Typ → leer + GELB, nie frei übersetzen. */
// DESIGN an 7 App 09.11. 12:41 Punkt 1: "colanders & strainers"/"colander"/"strainer" → Küchensieb · "luggage tag" → Gepäckanhänger ·
// 120 (echte Spezifikation "Disposable Food Cove": "Food Cover Plastic") → Frischhaltehaube; "bowl cover" ist im Design-Text genannt.
export const PRODUCT_TYPE_DE: Readonly<Record<string, string>> = {
  strainer: 'Küchensieb', colander: 'Küchensieb', 'colanders & strainers': 'Küchensieb',
  'food cover': 'Frischhaltehaube', 'food cover plastic': 'Frischhaltehaube', 'bowl cover': 'Frischhaltehaube',
  'luggage tag': 'Gepäckanhänger',
  'hot water bottle': 'Wärmflasche',
};
/** "tag" allein → Gepäckanhänger NUR, wenn der Titel „Gepäck“ oder „Koffer“ enthält (Groß/Klein egal); sonst leer + GELB. */
export const TAG_TITLE_RE = /gepäck|koffer/i;
/**
 * Titel-Abgleich (Regel für alle Listen-Einträge): die übersetzte Produktart muss zum Titel passen, sonst NICHT übernehmen.
 * "Passt" = das Kernwort steht im Titel. Kernwort = Listenwort selbst, außer hier ausdrücklich gekürzt ("Sieb bleibt Sieb"):
 * Küchensieb passt zu "Abtropfsieb"/"Reiswaschsieb", Gepäckanhänger zu "Adressanhänger" (nur zusammen mit der tag-Regel oben).
 */
export const PRODUCT_TYPE_TITLE_STEM: Readonly<Record<string, string>> = {
  'Küchensieb': 'sieb',
  'Gepäckanhänger': 'anhänger',
};
// Spezifikations-Schlüssel, in denen AliExpress den Typ liefert (echte Schlüssel der Live-Produkte 70/120/226, 09.11.).
const SPEC_TYPE_KEYS = /^(type|product type|item type|produkttyp|product category|disposable food cove)$/i;
export const PRODUCT_TYPE_SOURCE_NOTE = 'b, übersetzt (Liste)';
export function translateProductType(value: string, title?: string | null): string | null {
  const v = clean(value).toLowerCase();
  if (v === 'tag') return TAG_TITLE_RE.test(clean(title)) ? 'Gepäckanhänger' : null;
  return PRODUCT_TYPE_DE[v] ?? null;
}
/** Produktwort im Titel zur Produktart (Kernwort-Treffer, ganzes Titelwort) — null, wenn die Produktart nicht zum Titel passt. */
export function titleWordFor(produktart: string, title: string | null | undefined): string | null {
  const t = clean(title);
  const pa = clean(produktart);
  if (!t || !pa) return null;
  const stem = (PRODUCT_TYPE_TITLE_STEM[pa] ?? pa).toLowerCase();
  if (!t.toLowerCase().includes(stem)) return null;
  if (/\s/.test(stem)) return pa; // mehrere Wörter: Wortlaut der Produktart
  return t.split(/[\s,;:/()|·]+/).find(w => w.toLowerCase().includes(stem)) ?? pa;
}

// ─── P4 Lieferumfang ───────────────────────────────────────────────────────────────────────────────────────────────────
const PIECES_RE = /\b(\d+)\s*(?:pcs|pc|pieces|piece|stück|stk)\b\.?/i;
const SPEC_PIECES_KEYS = /^(quantity|pcs|number of pieces|package quantity|pieces|stückzahl|anzahl)$/i;

// ─── P5 Farbe ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const COLOR_GROUP = /^(colou?r|colou?rs|main colou?r|farbe|farben)$/i;
const SPEC_COLOR_KEYS = /^(colou?r|main colou?r|farbe)$/i;
const MATERIAL_GROUP = /^(material|materialien|main material|hauptmaterial)$/i;
// "Metal Type" (stele-70: "Stainless Steel") — DESIGN 12:41 / Auftrag: allgemeines Wort aus b ("Edelstahl"), nie "Edelstahl 304".
const SPEC_MATERIAL_KEYS = /^(material|materialien|main material|hauptmaterial|metal type)$/i;

// ─── P2 Material-Beleg ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Gesteigerte Material-Aussagen: nur mit Beleg (Quelle a/b UND Beleg-Wort im Wortlaut), sonst das allgemeine Wort. */
export const MATERIAL_CLAIMS: Array<{ claim: RegExp; general: string; evidence: RegExp }> = [
  { claim: /(echtleder|echtes leder|rindsleder|vollnarbenleder|kalbsleder|nappaleder)/i, general: 'Leder', evidence: /(genuine leather|real leather|cow ?hide|cow(?:skin)? leather|full[- ]grain|top[- ]grain|echtleder|echtes leder|rindsleder|nappa)/i },
  { claim: /edelstahl\s*(30[14]|316l?|18\/8|18\/10|v2a|v4a)/i, general: 'Metall', evidence: /(\b30[14]\b|\b316l?\b|18\/8|18\/10|v2a|v4a)/i },
  { claim: /(925(?:er)?\s*silber|sterling\s*silber|sterlingsilber)/i, general: 'Metall', evidence: /(\b925\b|sterling)/i },
  { claim: /(massivholz|echtholz)/i, general: 'Holz', evidence: /(solid wood|massivholz|echtholz)/i },
  { claim: /(100\s*%\s*baumwolle|reine baumwolle)/i, general: 'Baumwolle', evidence: /(100\s*%\s*cotton|pure cotton|100\s*%\s*baumwolle|reine baumwolle)/i },
];

/** Prüft eine Material-Angabe: gesteigerte Aussage ohne Beleg in Quelle a/b → allgemeines Wort, mit Hinweis. */
export function checkMaterialEvidence(value: string, source: PflichtSource | null, wording: string | null): { value: string; downgraded: boolean; hinweis?: string } {
  const v = clean(value);
  for (const c of MATERIAL_CLAIMS) {
    if (!c.claim.test(v)) continue;
    const ok = (source === 'a' || source === 'b') && c.evidence.test(wording ?? '');
    if (!ok) return { value: c.general, downgraded: true, hinweis: `„${v}“ ohne Beleg in Quelle a/b → „${c.general}“` };
  }
  return { value: v, downgraded: false };
}

// ─── Vorschlag aus AliExpress-Daten (Quelle a/b) ──────────────────────────────────────────────────────────────────────

export interface PflichtProposal { stored: PflichtDatenStored; unbekannteFarben: string[]; hinweise: string[] }

/** Vorschläge NUR aus a (Variantenauswahl) und b (Spezifikationen). P6/P7 haben dort keine Quelle → leer (Handeingabe). */
export function extractPflichtProposal(input: Pick<PflichtInput, 'specs' | 'variants' | 'variantPrices' | 'title'>): PflichtProposal {
  const specs = Object.entries(input.specs ?? {}).map(([k, v]) => [clean(k), clean(v)] as [string, string]).filter(([k, v]) => k && v);
  const units = unitsOf(input);
  const hasVariants = units[0]?.key !== SINGLE_UNIT_KEY;
  const out: PflichtDatenStored = {};
  const unbekannteFarben: string[] = [];
  const hinweise: string[] = [];

  // P1 Produktart: nur eine schon deutsche Spezifikation "Produktart" (b). Englische Typ-Angaben ("Type: cats") werden nicht übernommen.
  const pa = specs.find(([k]) => /^produktart$/i.test(k));
  // Der Schlüssel ist deutsch → der Wert gilt als deutsche Angabe des Händlers; höchstens 3 Wörter.
  if (pa && pa[1].split(/\s+/).length <= 3) {
    out.produktart = { value: pa[1], source: 'b', location: `Spezifikation "${pa[0]}"`, wording: pa[1] };
  } else {
    // Englischer Typ nur über die feste Liste (Quelle "b, übersetzt (Liste)"); unbekannt → leer + Hinweis.
    // Alle Typ-Schlüssel werden geprüft (120: "Disposable Food Cove" + "Product category"); zwei verschiedene Übersetzungen → nichts.
    const tys = specs.filter(([k]) => SPEC_TYPE_KEYS.test(k));
    const hits = tys.map(ty => ({ ty, de: translateProductType(ty[1], input.title) })).filter((x): x is { ty: [string, string]; de: string } => !!x.de);
    const distinct = uniq(hits.map(h => h.de));
    if (distinct.length > 1) {
      hinweise.push(`Produktart widersprüchlich (${hits.map(h => `„${h.ty[1]}“ → ${h.de}`).join(', ')}) — nicht übernommen`);
    } else if (hits.length > 0) {
      const { ty, de } = hits[0];
      // Ohne Titel (z. B. Aufruf ohne Titel) kein Abgleich möglich — wie bisher in resolvePflichtDaten: dann ohne Abgleich.
      if (!clean(input.title) || titleWordFor(de, input.title)) out.produktart = { value: de, source: 'b', location: `Spezifikation "${ty[0]}" – ${PRODUCT_TYPE_SOURCE_NOTE}`, wording: ty[1] };
      else hinweise.push(`Produktart „${de}“ (Liste, aus „${ty[1]}“) passt nicht zum Titel — nicht übernommen`);
    } else {
      for (const ty of tys) {
        hinweise.push(clean(ty[1]).toLowerCase() === 'tag'
          ? `Produktart „${ty[1]}“ nur mit „Gepäck“/„Koffer“ im Titel → Gepäckanhänger — nicht übernommen`
          : `Produktart „${ty[1]}“ nicht in der Übersetzungsliste — nicht übernommen`);
      }
    }
  }

  // P2 Material: a (Varianten-Gruppe Material, für alle Varianten gleich) vor b (Spezifikation).
  const matA = units.map(u => Object.entries(u.attrs).find(([g]) => MATERIAL_GROUP.test(clean(g)))).filter(Boolean) as Array<[string, string]>;
  const matSpec = specs.find(([k]) => SPEC_MATERIAL_KEYS.test(k));
  const matCand: Array<{ raw: string; source: PflichtSource; location: string }> = [];
  if (matA.length === units.length && uniq(matA.map(([, v]) => clean(v).toLowerCase())).length === 1) matCand.push({ raw: clean(matA[0][1]), source: 'a', location: `Variantenauswahl "${clean(matA[0][0])}"` });
  if (matSpec) matCand.push({ raw: matSpec[1], source: 'b', location: `Spezifikation "${matSpec[0]}"` });
  for (const c of matCand) {
    const de = translateMaterial(c.raw);
    if (!de) { hinweise.push(`Material „${c.raw}“ nicht eindeutig übersetzbar — nicht übernommen`); continue; }
    const ev = checkMaterialEvidence(de, c.source, c.raw);
    if (ev.hinweis) hinweise.push(ev.hinweis);
    out.material = { value: ev.value, source: c.source, location: c.location, wording: c.raw };
    break;
  }

  // P3 Maße je Variante: a (Wert der Variantenauswahl) vor b (Spezifikation, nur ohne Größen-Achse — sonst gälte sie nicht für jede Variante).
  const masse: Record<string, VariantMeasure> = {};
  for (const u of units) {
    for (const [g, v] of Object.entries(u.attrs)) {
      const m = parseMeasureText(v, /^(diameter|durchmesser)$/i.test(clean(g)) ? 'D' : /^(length|länge)$/i.test(clean(g)) ? 'L' : undefined);
      if (m) { masse[u.key] = { ...m, source: 'a', location: `Variantenauswahl "${clean(g)}"`, text: clean(v) }; break; }
      const plain = parseVariantPlainMeasure(v);
      if (plain) { masse[u.key] = { ...plain, source: 'a', location: `Variantenauswahl "${clean(g)}"`, text: clean(v) }; break; }
      if (twoDimUnclear(v)) hinweise.push(twoDimHint(`Variantenauswahl "${clean(g)}"`, clean(v)));
    }
  }
  const sizeAxis = units.some(u => Object.keys(u.attrs).some(g => SIZE_GROUP.test(clean(g))));
  if (Object.keys(masse).length === 0 && !sizeAxis) {
    for (const [re, hint] of SPEC_MEASURE_KEYS) {
      const s = specs.find(([k]) => re.test(k));
      const m = s ? parseMeasureText(s[1], hint) : null;
      if (s && m) { for (const u of units) masse[u.key] = { ...m, source: 'b', location: `Spezifikation "${s[0]}"`, text: s[1] }; break; }
      if (s && !m) hinweise.push(twoDimUnclear(s[1]) ? twoDimHint(`Spezifikation "${s[0]}"`, s[1]) : `Maß „${s[0]}: ${s[1]}“ nicht nach D2 lesbar — nicht übernommen`);
    }
  }
  if (Object.keys(masse).length > 0) out.masse = masse;

  // P4 Lieferumfang: Stückzahl in JEDER Variante (a), sonst Spezifikation (b) beim Einzelartikel. Teilweise belegt → leer.
  const counts = units.map(u => Object.values(u.attrs).map(v => clean(v).match(PIECES_RE)).find(Boolean));
  if (hasVariants && counts.every(Boolean)) {
    const nums = uniq(counts.map(m => Number(m![1]))).filter(n => n > 0).sort((a, b) => a - b);
    const text = formatPieces(nums);
    if (text) out.lieferumfang = { value: text, source: 'a', location: 'Variantenauswahl', wording: uniq(counts.map(m => clean(m![0]))).join(' | ') };
  } else if (!hasVariants) {
    const s = specs.find(([k]) => SPEC_PIECES_KEYS.test(k));
    const m = s?.[1].match(/^(\d+)\s*(?:pcs|pc|pieces|piece|stück|stk)?\.?$/i);
    if (s && m && Number(m[1]) > 0) out.lieferumfang = { value: `${Number(m[1])} Stück`, source: 'b', location: `Spezifikation "${s[0]}"`, wording: s[1] };
  }

  // P5 Farbe je Variante: a (Farb-Gruppe, oder Wert = Farbe + Stückzahl) vor b (Spezifikation, nur ohne Farb-Achse).
  const farben: Record<string, PflichtEntry> = {};
  let colorAxis = false;
  for (const u of units) {
    for (const [g, v] of Object.entries(u.attrs)) {
      const isColorGroup = COLOR_GROUP.test(clean(g));
      const rest = clean(clean(v).replace(new RegExp(PIECES_RE.source, 'gi'), ''));
      const de = rest ? translateColorExact(rest) : null;
      if (isColorGroup) colorAxis = true;
      if (de) { farben[u.key] = { value: de, source: 'a', location: `Variantenauswahl "${clean(g)}"`, wording: clean(v) }; colorAxis = true; break; }
      if (isColorGroup && rest) unbekannteFarben.push(clean(v));
    }
  }
  if (!colorAxis) {
    const s = specs.find(([k]) => SPEC_COLOR_KEYS.test(k));
    if (s) {
      const de = translateColorExact(s[1]);
      if (de) for (const u of units) farben[u.key] = { value: de, source: 'b', location: `Spezifikation "${s[0]}"`, wording: s[1] };
      else unbekannteFarben.push(s[1]);
    }
  }
  if (Object.keys(farben).length > 0) out.farben = farben;

  return { stored: out, unbekannteFarben: uniq(unbekannteFarben), hinweise: uniq(hinweise) };
}

/**
 * Lücke 3: Material-Vorschlag aus einem Text der Quelle c ("… 304 stainless steel …"). Nur ein eindeutiger Treffer der festen
 * Material-Tabelle (ganze Wörter) → allgemeines Wort ("Edelstahl", nie "Edelstahl 304"); mehrere verschiedene → null. Wird NIE gespeichert.
 */
export function materialProposalFromText(text: string, location: string): { value: string; wording: string; location: string } | null {
  const t = clean(text);
  if (!t || !clean(location)) return null;
  const hits: Array<{ value: string; wording: string }> = [];
  for (const key of MATERIAL_TEXT_KEYS) {
    const m = t.match(new RegExp(`(?<![\\p{L}\\d])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\d])`, 'iu'));
    if (m) { const de = translateMaterial(key); if (de) hits.push({ value: checkMaterialEvidence(de, 'c', m[0]).value, wording: m[0] }); }
  }
  // längster Wortlaut zuerst ("304 stainless steel" vor "stainless steel"), Werte müssen übereinstimmen
  const values = uniq(hits.map(h => h.value));
  if (values.length !== 1) return null;
  const best = hits.sort((a, b) => b.wording.length - a.wording.length)[0];
  return { value: best.value, wording: best.wording, location: clean(location) };
}

// ─── Auflösen (EINE Lesestelle für v4, Merkmale, Vorschau, Produkte-Tab) ───────────────────────────────────────────────

const fromEntry = (e: PflichtEntry | undefined, herkunft: Herkunft): ResolvedField | null =>
  e && clean(e.value) ? { value: clean(e.value), source: e.source, location: e.location ?? null, wording: e.wording ?? null, herkunft } : null;

export function resolvePflichtDaten(input: PflichtInput): ResolvedPflichtDaten {
  const units = unitsOf(input);
  const stored = input.pflichtDaten ?? {};
  const proposal = extractPflichtProposal(input);
  const p = proposal.stored;
  const hinweise = [...proposal.hinweise];

  const produktart = fromEntry(stored.produktart, 'gespeichert')
    ?? (clean(input.manualAspects?.['Produktart']) ? { value: clean(input.manualAspects!['Produktart']), source: null, location: 'Pflichtmerkmal (Hand)', wording: null, herkunft: 'altfeld' as const } : null)
    ?? fromEntry(p.produktart, 'vorschlag');

  let material = fromEntry(stored.material, 'gespeichert');
  if (!material && clean(input.material)) {
    const src = MEASURE_SOURCES.includes(input.materialSource?.source as PflichtSource) ? input.materialSource!.source as PflichtSource : null;
    material = { value: clean(input.material), source: src, location: input.materialSource?.location ?? null, wording: null, herkunft: 'altfeld' };
  }
  material ??= fromEntry(p.material, 'vorschlag');
  if (material) {
    const ev = checkMaterialEvidence(material.value, material.source, material.wording ?? (material.herkunft === 'altfeld' ? clean(input.material) : null));
    if (ev.downgraded) { material = { ...material, value: ev.value, hinweis: ev.hinweis }; if (ev.hinweis) hinweise.push(ev.hinweis); }
  }
  // Lücke 3 (DESIGN 12:41 Punkt 3): Quelle c NICHT automatisch — nur ein Vorschlag mit Wortlaut + GELB "bitte bestätigen", nur wenn P2 leer ist.
  const materialVorschlagC = !material && input.textC ? materialProposalFromText(input.textC.text, input.textC.location) : null;

  // P3: je Variante gespeichert → Altfeld variant_details (beim Einzelartikel auch der einzige Eintrag) → Vorschlag.
  const legacy = input.variantDetails ?? {};
  const legacyKeys = Object.keys(legacy);
  const masse: ResolvedPflichtDaten['masse'] = {};
  const detailsForText: Record<string, { displayNameDe?: string; measure?: VariantMeasure | null }> = {};
  for (const u of units) {
    const leg = legacy[u.key] ?? (u.key === SINGLE_UNIT_KEY && legacyKeys.length === 1 ? legacy[legacyKeys[0]] : undefined);
    const pick: [VariantMeasure | undefined | null, Herkunft][] = [[stored.masse?.[u.key], 'gespeichert'], [leg?.measure, 'altfeld'], [p.masse?.[u.key], 'vorschlag']];
    const hit = pick.find(([m]) => m && formatMeasure(m));
    if (hit) {
      masse[u.key] = { ...(hit[0] as VariantMeasure), herkunft: hit[1] };
      detailsForText[u.key] = { displayNameDe: clean(leg?.displayNameDe) || u.labelDe, measure: hit[0] };
    }
  }
  // Altfeld mit eigenen Schlüsseln (z. B. Handeingabe vor dem Varianten-Abgleich): passt kein Schlüssel, gelten die gespeicherten Maße wie bisher.
  let legacyOnly = false;
  if (Object.keys(masse).length === 0) {
    for (const [k, d] of Object.entries(legacy)) {
      if (d?.measure && formatMeasure(d.measure)) { masse[k] = { ...d.measure, herkunft: 'altfeld' }; detailsForText[k] = { displayNameDe: clean(d.displayNameDe), measure: d.measure }; legacyOnly = true; }
    }
  }
  const mt = measureText(detailsForText);
  // DESIGN 12:41 Punkt 2: Maß aus der Variantenauswahl ohne Richtung (M/SPANNE, Quelle a) → "120 cm (laut Variante)" bzw. bei mehreren
  // Größen "je nach Variante, siehe Auswahl" (die Werte je Variante bleiben in masse[]). Gilt nur, wenn ALLE Maße diese Art sind.
  const allMasse = Object.values(masse);
  const plainText = allMasse.length > 0 && allMasse.every(isVariantPlainMeasure)
    ? (() => { const d = uniq(allMasse.map(m => formatMeasure(m)).filter((x): x is string => !!x)); return d.length === 1 ? `${d[0]} ${MASSE_LAUT_VARIANTE}` : MASSE_JE_VARIANTE; })()
    : null;

  const lieferumfang = fromEntry(stored.lieferumfang, 'gespeichert')
    ?? (() => {
      const n = uniq(Object.values(legacy).map(d => d?.pieces).filter((x): x is number => typeof x === 'number' && Number.isInteger(x) && x > 0)).sort((a, b) => a - b);
      const t = formatPieces(n);
      return t ? { value: t, source: null, location: 'Produktdaten Stückzahl (Hand)', wording: null, herkunft: 'altfeld' as const } : null;
    })()
    ?? fromEntry(p.lieferumfang, 'vorschlag');

  const usage = [clean(input.usePurpose), clean(input.usageNote)].filter(Boolean).join(' · ');
  const anwendung = fromEntry(stored.anwendung, 'gespeichert')
    ?? (usage ? { value: usage, source: null, location: 'Produktdaten Einsatzzweck/Verwendung (Hand)', wording: null, herkunft: 'altfeld' as const } : null);
  const besonderheit = fromEntry(stored.besonderheit, 'gespeichert');

  const farben: Record<string, ResolvedField> = {};
  for (const u of units) {
    const f = fromEntry(stored.farben?.[u.key], 'gespeichert') ?? fromEntry(p.farben?.[u.key], 'vorschlag');
    if (f) farben[u.key] = f;
  }
  const unbekannteFarben = Object.keys(farben).length === units.length ? [] : proposal.unbekannteFarben;

  // GELB nur für P1–P4 (P6/P7 sind Handeingabe und machen nie GELB) sowie für eine unbekannte Farbe (P5, nicht übernommen).
  const missing: string[] = [];
  if (!produktart) missing.push(MISSING_NAME.produktart);
  if (!material) missing.push(MISSING_NAME.material);
  const ohneMass = legacyOnly ? [] : units.filter(u => !masse[u.key]);
  if (ohneMass.length > 0) missing.push(units.length > 1 && ohneMass.length < units.length ? `${MISSING_NAME.masse} (${ohneMass.map(u => u.label).join(', ')})` : MISSING_NAME.masse);
  if (!lieferumfang) missing.push(MISSING_NAME.lieferumfang);
  const problems = [...missing];
  // P1-Abgleich mit dem Produktwort im Titel (ein Wort durchgehend): steht die Produktart nicht wörtlich im Titel → GELB + Hinweis.
  // Es wird NICHT geraten, welches Titelwort gemeint ist (Komposita, Plural …) — nur wörtlicher Treffer zählt.
  // DESIGN 12:41: Kernwort-Treffer zählt ("Sieb bleibt Sieb", PRODUCT_TYPE_TITLE_STEM); das Titelwort wird das Produktwort der Einleitung.
  const title = clean(input.title);
  const titelwort = produktart && title ? titleWordFor(produktart.value, title) : null;
  if (produktart && title && !titelwort) {
    const h = `Produktart „${produktart.value}“ steht nicht wörtlich im Titel — ein Wort durchgehend verwenden`;
    problems.push(h);
    hinweise.push(h);
  }
  const produktartOut = produktart && titelwort ? { ...produktart, titelwort } : produktart;
  if (materialVorschlagC) {
    const h = `Material-Vorschlag „${materialVorschlagC.value}“ aus Quelle c (${materialVorschlagC.location}: „${materialVorschlagC.wording}“) — bitte bestätigen, nicht übernommen`;
    problems.push(h);
    hinweise.push(h);
  }
  if (unbekannteFarben.length > 0) problems.push(`Farbe unbekannt (nicht übernommen): ${unbekannteFarben.join(', ')}`);
  const ampel: PflichtAmpel = {
    status: problems.length === 0 ? 'GRUEN' : 'GELB',
    missing: problems,
    text: problems.length === 0 ? null : [
      missing.length ? `Pflicht-Daten fehlen: ${missing.join(', ')}` : '',
      problems.filter(x => x.startsWith('Produktart „')).join(''),
      problems.filter(x => x.startsWith('Material-Vorschlag „')).join(''),
      unbekannteFarben.length ? `Farbe unbekannt: ${unbekannteFarben.join(', ')}` : '',
    ].filter(Boolean).join(' · '),
  };

  return {
    units, produktart: produktartOut, material, lieferumfang, anwendung, besonderheit,
    masse, masseText: plainText ?? mt.uniform ?? mt.perVariant, materialVorschlagC, farben, unbekannteFarben, hinweise: uniq(hinweise), ampel,
  };
}

/** eBay-Artikelmerkmale aus den Pflicht-Daten: Produktart, Material, Farbe (nur wenn ALLE Varianten dieselbe belegte Farbe haben). */
export function pflichtAspects(r: ResolvedPflichtDaten): Record<string, string> {
  const out: Record<string, string> = {};
  if (r.produktart) out['Produktart'] = r.produktart.value;
  if (r.material) out['Material'] = r.material.value;
  const colors = r.units.map(u => r.farben[u.key]?.value);
  if (colors.length > 0 && colors.every(Boolean) && uniq(colors).length === 1) out['Farbe'] = colors[0] as string;
  return out;
}

/**
 * Pflicht-Merkmale gegen die echte Merkmal-Liste der eBay-Kategorie: nur Namen, die die Kategorie führt (ohne Groß/Klein);
 * SELECTION_ONLY nur mit erlaubtem Wert (eBay-Schreibweise); länger als 65 Zeichen → weglassen (nicht kürzen).
 */
export function matchPflichtToCategoryAspects(values: Record<string, string>, categoryAspects: CategoryAspectDef[]): { aspects: Record<string, string>; used: string[]; skipped: string[] } {
  const norm = (x: string) => clean(x).toLowerCase();
  const byName = new Map(categoryAspects.map(a => [norm(a.localizedAspectName), a]));
  const out = { aspects: {} as Record<string, string>, used: [] as string[], skipped: [] as string[] };
  for (const [name, raw] of Object.entries(values)) {
    const v = clean(raw);
    const def = byName.get(norm(name));
    if (!v) continue;
    if (!def) { out.skipped.push(`${name}: Kategorie kennt das Merkmal nicht`); continue; }
    if (v.length > ASPECT_VALUE_MAX) { out.skipped.push(`${name}: länger als ${ASPECT_VALUE_MAX} Zeichen`); continue; }
    let value = v;
    if (def.aspectConstraint?.aspectMode === 'SELECTION_ONLY') {
      const allowed = (def.aspectValues ?? []).find(a => norm(a.localizedValue) === norm(v));
      if (!allowed) { out.skipped.push(`${name}: „${v}“ nicht in der eBay-Auswahlliste`); continue; }
      value = allowed.localizedValue;
    }
    out.aspects[def.localizedAspectName] = value;
    out.used.push(`${def.localizedAspectName}=${value}`);
  }
  return out;
}

// ─── Speichern (PATCH /products/:id { pflichtDaten }) ─────────────────────────────────────────────────────────────────

export const PFLICHT_MAX = { value: 120, anwendung: 200, besonderheit: 200, location: 200, wording: 300, keys: 200 } as const;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function parseEntry(at: string, v: unknown, max: number): { ok: true; value: PflichtEntry | null } | { ok: false; error: string } {
  if (v == null) return { ok: true, value: null };
  if (!isObj(v)) return { ok: false, error: `${at} muss ein Objekt {value, source, location, wording} oder null sein` };
  const value = typeof v.value === 'string' ? clean(v.value) : '';
  if (!value) return { ok: true, value: null };
  if (value.length > max) return { ok: false, error: `${at}.value ist zu lang (max. ${max} Zeichen)` };
  if (!MEASURE_SOURCES.includes(v.source as PflichtSource)) return { ok: false, error: `${at}.source muss a, b, c oder d sein` };
  const location = typeof v.location === 'string' ? clean(v.location) : '';
  const wording = typeof v.wording === 'string' ? clean(v.wording) : '';
  if (!location) return { ok: false, error: `${at}.location (Fundstelle) ist Pflicht` };
  if (!wording) return { ok: false, error: `${at}.wording (Wortlaut der Quelle) ist Pflicht` };
  if (location.length > PFLICHT_MAX.location) return { ok: false, error: `${at}.location ist zu lang (max. ${PFLICHT_MAX.location} Zeichen)` };
  if (wording.length > PFLICHT_MAX.wording) return { ok: false, error: `${at}.wording ist zu lang (max. ${PFLICHT_MAX.wording} Zeichen)` };
  return { ok: true, value: { value, source: v.source as PflichtSource, location, wording } };
}

/** Validiert body.pflichtDaten (ganzes Objekt ersetzt den gespeicherten Stand). Rückgabe: JSON-Text oder null. */
export function parsePflichtDatenPatch(
  raw: unknown,
  parseMeasure: (key: string, m: unknown, at: string) => { ok: true; value: unknown } | { ok: false; error: string },
): { ok: true; json: string | null } | { ok: false; error: string } {
  if (raw == null) return { ok: true, json: null };
  if (!isObj(raw)) return { ok: false, error: '"pflichtDaten" muss ein Objekt oder null sein' };
  const out: PflichtDatenStored = {};
  for (const f of PRODUCT_FIELDS) {
    const max = f === 'anwendung' ? PFLICHT_MAX.anwendung : f === 'besonderheit' ? PFLICHT_MAX.besonderheit : PFLICHT_MAX.value;
    const r = parseEntry(`pflichtDaten.${f}`, raw[f], max);
    if (!r.ok) return r;
    if (r.value) {
      if (f === 'produktart' && r.value.value.split(/\s+/).length > 3) return { ok: false, error: 'pflichtDaten.produktart: höchstens 3 Wörter' };
      out[f] = r.value;
    }
  }
  if (raw.farben != null) {
    if (!isObj(raw.farben)) return { ok: false, error: '"pflichtDaten.farben" muss ein Objekt {Variante: {...}} sein' };
    const farben: Record<string, PflichtEntry> = {};
    const keys = Object.keys(raw.farben);
    if (keys.length > PFLICHT_MAX.keys) return { ok: false, error: `"pflichtDaten.farben" hat zu viele Varianten (max. ${PFLICHT_MAX.keys})` };
    for (const k of keys) {
      const r = parseEntry(`pflichtDaten.farben["${k}"]`, raw.farben[k], PFLICHT_MAX.value);
      if (!r.ok) return r;
      if (!r.value) continue;
      const de = translateColorExact(r.value.value);
      if (!de) return { ok: false, error: `pflichtDaten.farben["${k}"]: „${r.value.value}“ steht nicht in der festen Farbliste (deutsch) — Feld leer lassen` };
      farben[k] = { ...r.value, value: de };
    }
    if (Object.keys(farben).length > 0) out.farben = farben;
  }
  if (raw.masse != null) {
    if (!isObj(raw.masse)) return { ok: false, error: '"pflichtDaten.masse" muss ein Objekt {Variante: Maß} sein' };
    const masse: Record<string, VariantMeasure> = {};
    const keys = Object.keys(raw.masse);
    if (keys.length > PFLICHT_MAX.keys) return { ok: false, error: `"pflichtDaten.masse" hat zu viele Varianten (max. ${PFLICHT_MAX.keys})` };
    for (const k of keys) {
      const r = parseMeasure(k, raw.masse[k], `pflichtDaten.masse["${k}"]`);
      if (!r.ok) return r;
      if (r.value) masse[k] = r.value as VariantMeasure;
    }
    if (Object.keys(masse).length > 0) out.masse = masse;
  }
  return { ok: true, json: Object.keys(out).length > 0 ? JSON.stringify(out) : null };
}

/** Liest gespeichertes pflicht_daten tolerant (kaputtes JSON → null). */
export function readPflichtDaten(json: string | null | undefined): PflichtDatenStored | null {
  if (!json) return null;
  try { const v = JSON.parse(json); return isObj(v) ? (v as PflichtDatenStored) : null; } catch { return null; }
}

/** Import: Vorschlag (a/b) als JSON für die neue Zeile — null, wenn nichts belegt ist. */
export function pflichtDatenForImport(input: Pick<PflichtInput, 'specs' | 'variants' | 'variantPrices' | 'title'>): string | null {
  const s = extractPflichtProposal(input).stored;
  return Object.keys(s).length > 0 ? JSON.stringify(s) : null;
}
