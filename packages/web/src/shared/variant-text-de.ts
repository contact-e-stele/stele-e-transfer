// OFFEN 023 (03.11.2026): Variantenwerte und Gruppennamen auf Deutsch.
// Befund Aufsicht: 24 von 43 Live-Angeboten haben englische Variantenwerte ("Multicolour 100pcs", "GRAY", "Navy blue 3 pcs set" …).
// Inhaber: keine englischen Begriffe.
//
// Reine Funktionen, feste Tabellen — Grundgesetz 3/4: nichts raten. Enthält ein Wert ein Wort, das weder in den Tabellen noch als
// deutsches Wort bekannt ist, bleibt der GANZE Wert unverändert und das Wort wird als "unbekannt" gemeldet (der Inhaber entscheidet
// in der Vorschau von Hand).
//
// Zuordnung bleibt heil (Grundgesetz 8, variant-resolver.ts): applyVariantRename() schreibt je variantPrices-Eintrag die neuen
// Anzeigewerte als displayValues (attrs = AliExpress-Rohdaten bleiben unangetastet), skuId bleibt, und bei gelisteten Produkten wird
// die bisherige eBay-SKU als SKU-Anker (ebaySku) festgeschrieben — eine eBay-SKU ist nach dem Listen nicht mehr änderbar.

import { buildCombinations, comboSku, entryMatchesCombo, NON_VARIATION_ASPECTS, type VariantGroup, type VariantPriceEntry } from './variant-resolver';

export interface TranslatedText {
  value: string;          // Vorschlag (bei unbekannten Wörtern: Original unverändert)
  changed: boolean;       // Vorschlag ≠ Original
  unknownWords: string[]; // Wörter, die nicht übersetzt werden konnten → Wert bleibt unverändert
}

// Farben: englisch (klein) → deutsch. Deutsche Farbnamen stehen in GERMAN_KNOWN (z. B. "GRAU" → "Grau").
const COLORS: Record<string, string> = {
  grey: 'Grau', gray: 'Grau',
  black: 'Schwarz', white: 'Weiß', blue: 'Blau', red: 'Rot', green: 'Grün', pink: 'Rosa', brown: 'Braun', beige: 'Beige',
  gold: 'Gold', golden: 'Gold', silver: 'Silber', yellow: 'Gelb', orange: 'Orange', purple: 'Lila', violet: 'Violett',
  khaki: 'Khaki', navy: 'Marineblau', turquoise: 'Türkis', transparent: 'Transparent',
  multicolour: 'Mehrfarbig', multicolor: 'Mehrfarbig', multicolored: 'Mehrfarbig', multicoloured: 'Mehrfarbig',
};

// Mehrwort-Farben (vor der Wort-Tabelle angewandt, Groß/Klein egal).
const COLOR_PHRASES: Array<[RegExp, string]> = [
  [/\blight\s+gr[ae]y\b/gi, 'Hellgrau'],
  [/\bdark\s+gr[ae]y\b/gi, 'Dunkelgrau'],
  [/\bnavy\s+blue\b/gi, 'Marineblau'],
  [/\blight\s+blue\b/gi, 'Hellblau'],
  [/\bsky\s+blue\b/gi, 'Hellblau'],
  [/\bdark\s+blue\b/gi, 'Dunkelblau'],
  [/\blight\s+green\b/gi, 'Hellgrün'],
  [/\bdark\s+green\b/gi, 'Dunkelgrün'],
  [/\brose\s+gold\b/gi, 'Roségold'],
  [/\bwine\s+red\b/gi, 'Weinrot'],
  [/\blight\s+pink\b/gi, 'Hellrosa'],
];

// Sonstige feste Wörter (englisch klein → deutsch). Nur eindeutige Übersetzungen.
const WORDS: Record<string, string> = {
  set: 'Set', sets: 'Sets',
  holder: 'Halter', holders: 'Halter',
  blade: 'Klinge', blades: 'Klingen',
};

// Bereits deutsche / neutrale Wörter (klein → Schreibweise). Alles, was die Tabellen erzeugen, ist automatisch bekannt.
const GERMAN_EXTRA = [
  'Stück', 'teiliges', 'Weiss', 'Varianten', 'Variante', 'Größe', 'Farbe', 'Menge', 'Ausführung', 'Stil', 'Material', 'Modell', 'Typ',
  'Groß', 'Klein', 'Mittel', 'mit', 'und', 'ohne', 'für', 'Packung', 'Paar', 'Rosa', 'Lila',
];
const GERMAN_KNOWN: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  const add = (w: string) => { for (const part of w.split(/[\s-]+/)) if (part && !/\d/.test(part)) out[part.toLowerCase()] = part; };
  Object.values(COLORS).forEach(add);
  COLOR_PHRASES.forEach(([, w]) => add(w));
  Object.values(WORDS).forEach(add);
  GERMAN_EXTRA.forEach(add);
  out['weiss'] = 'Weiß';
  return out;
})();

// Größen bleiben (Großbuchstaben), Maßeinheiten bleiben.
const SIZES = new Set(['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'XXXXL']);
const UNITS = new Set(['cm', 'mm', 'm', 'ml', 'l', 'kg', 'g']);

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

function translateWord(tok: string): { out: string; unknown: boolean } {
  if (!/^[A-Za-zÄÖÜäöüß]+$/.test(tok)) return { out: tok, unknown: false }; // Zahlen, Codes ("SET1", "30x40cm", "2XL") bleiben
  const low = tok.toLowerCase();
  if (SIZES.has(tok.toUpperCase()) && tok === tok.toUpperCase()) return { out: tok, unknown: false };
  if (UNITS.has(low)) return { out: tok, unknown: false };
  if (COLORS[low]) return { out: COLORS[low], unknown: false };
  if (WORDS[low]) return { out: WORDS[low], unknown: false };
  if (GERMAN_KNOWN[low]) return { out: GERMAN_KNOWN[low], unknown: false };
  if (tok.length === 1) return { out: tok, unknown: false };              // einzelne Buchstaben ("A", "B")
  if (/[ÄÖÜäöüß]/.test(tok)) return { out: tok, unknown: false };         // sieht deutsch aus
  return { out: tok, unknown: true };
}

/** Einen Variantenwert übersetzen. Unbekanntes Wort → Original unverändert + unknownWords. */
export function translateVariantValue(input: string): TranslatedText {
  const original = String(input ?? '');
  let s = collapse(original);
  // "3 pcs set" / "3pcs set" → "3-teiliges Set"
  s = s.replace(/\b(\d+)\s*(?:pcs|pc|pieces|piece)\s+set\b/gi, '$1-teiliges Set');
  for (const [re, de] of COLOR_PHRASES) s = s.replace(re, de);
  // "100pcs" / "100 PCS" / "1pc" → "100 Stück"
  s = s.replace(/\b(\d+)\s*(?:pcs|pc|pieces|piece)\b/gi, '$1 Stück');
  // alleinstehend "pcs"/"piece(s)" → "Stück"
  s = s.replace(/\b(?:pcs|pc|pieces|piece)\b/gi, 'Stück');

  const parts = s.split(/(\s+|[/,+&()\-])/);
  const unknownWords: string[] = [];
  const out = parts.map(p => {
    if (!p || /^(\s+|[/,+&()\-])$/.test(p)) return p;
    const r = translateWord(p);
    if (r.unknown && !unknownWords.includes(p)) unknownWords.push(p);
    return r.out;
  }).join('');
  if (unknownWords.length > 0) return { value: original, changed: false, unknownWords };
  const value = collapse(out);
  return { value, changed: value !== original, unknownWords: [] };
}

const GROUP_NAMES: Record<string, string> = {
  color: 'Farbe', colour: 'Farbe', 'main color': 'Farbe',
  size: 'Größe',
  'number of pcs': 'Menge', quantity: 'Menge', qty: 'Menge',
  specification: 'Ausführung', specifications: 'Ausführung',
  style: 'Stil', material: 'Material', model: 'Modell', type: 'Typ',
};
const GROUP_GERMAN = new Set(['farbe', 'größe', 'groesse', 'menge', 'anzahl', 'ausführung', 'stil', 'material', 'modell', 'typ', 'varianten', 'variante', 'set', 'größen']);

/** Gruppennamen übersetzen (Color → Farbe …). Versand-Attribute ("Ships From") bleiben unverändert (nie Teil einer Variante). */
export function translateGroupName(input: string): TranslatedText {
  const original = String(input ?? '');
  const key = collapse(original).toLowerCase();
  if (NON_VARIATION_ASPECTS.has(collapse(original))) return { value: original, changed: false, unknownWords: [] };
  if (GROUP_NAMES[key]) { const value = GROUP_NAMES[key]; return { value, changed: value !== original, unknownWords: [] }; }
  if (GROUP_GERMAN.has(key)) {
    const value = collapse(original).charAt(0).toUpperCase() + collapse(original).slice(1);
    return { value, changed: value !== original, unknownWords: [] };
  }
  return { value: original, changed: false, unknownWords: [collapse(original)] };
}

export interface GroupTranslationPlan {
  name: { original: string } & TranslatedText;
  values: Array<{ original: string } & TranslatedText>;
}
export interface VariantTextPlan {
  groups: GroupTranslationPlan[];
  anyChange: boolean;
  unknownWords: string[];
  /** Vorschläge, die innerhalb einer Gruppe denselben Wert ergäben ("Gray" + "Grey" → zweimal "Grau") — nicht speicherbar. */
  duplicates: string[];
}

/** Vorschlag für alle Gruppen eines Produkts (nur lesen). */
export function planVariantTexts(groups: VariantGroup[]): VariantTextPlan {
  const plan: GroupTranslationPlan[] = groups.map(g => ({
    name: { original: g.name, ...translateGroupName(g.name) },
    values: g.values.map(v => ({ original: v, ...translateVariantValue(v) })),
  }));
  const proposed: VariantGroup[] = plan.map(g => ({ name: g.name.value, values: g.values.map(v => v.value) }));
  const unknownWords = [...new Set(plan.flatMap(g => [...g.name.unknownWords, ...g.values.flatMap(v => v.unknownWords)]))];
  return {
    groups: plan,
    anyChange: plan.some(g => g.name.changed || g.values.some(v => v.changed)),
    unknownWords,
    duplicates: findDuplicateValues(proposed),
  };
}

/** Doppelte Werte je Gruppe (getrimmt, Groß/Klein egal) und doppelte Gruppennamen. */
export function findDuplicateValues(groups: VariantGroup[]): string[] {
  const out: string[] = [];
  const names = new Map<string, number>();
  for (const g of groups) names.set(collapse(g.name).toLowerCase(), (names.get(collapse(g.name).toLowerCase()) ?? 0) + 1);
  for (const [n, c] of names) if (c > 1) out.push(`Gruppenname "${n}" doppelt`);
  for (const g of groups) {
    const seen = new Map<string, number>();
    for (const v of g.values) seen.set(collapse(v).toLowerCase(), (seen.get(collapse(v).toLowerCase()) ?? 0) + 1);
    for (const [v, c] of seen) if (c > 1) out.push(`${g.name}: "${v}" ${c}×`);
  }
  return out;
}

export interface RenameResult<T extends VariantPriceEntry> {
  ok: boolean;
  error?: string;
  variants: VariantGroup[];
  entries: T[];
  /** skuId → eBay-SKU, die als Anker festgeschrieben wurde (nur bei pinSku). */
  pinned: Array<{ skuId: string; sku: string }>;
  /** Einträge, die auf keine/mehrere Kombinationen passten — bleiben unverändert (wie vorher verwaist/mehrdeutig). */
  untouched: string[];
}

/**
 * Reine Umbenennung (gleiche Struktur: gleiche Gruppen-/Werte-Anzahl, nur Text). Je variantPrices-Eintrag, der auf GENAU EINE alte
 * Kombination passt (entryMatchesCombo, wie Listing/Preis-Lauf): displayValues = neue Kombination an derselben Stelle. skuId, attrs,
 * Preise, Lager bleiben. pinSku (gelistetes Produkt): die bisherige SKU (Anker oder berechnet, comboSku) wird als ebaySku festgeschrieben,
 * damit die SKU nach der Umbenennung GENAU dieselbe bleibt. Dubletten (mehrere Einträge je Kombination) bekommen beide dieselbe Zuordnung
 * — der Zustand "mehrdeutig" bleibt so erhalten, wie er war (Dubletten-Knopf greift weiter).
 */
export function applyVariantRename<T extends VariantPriceEntry>(
  productId: number,
  oldGroups: VariantGroup[],
  newGroups: VariantGroup[],
  entries: T[],
  opts: { pinSku: boolean },
): RenameResult<T> {
  const fail = (error: string): RenameResult<T> => ({ ok: false, error, variants: oldGroups, entries, pinned: [], untouched: [] });
  const sameStructure = oldGroups.length === newGroups.length && oldGroups.every((g, i) => g.values.length === newGroups[i].values.length);
  if (!sameStructure) return fail('Struktur geändert (Gruppen- oder Werte-Anzahl) — hier wird nur umbenannt, nichts gespeichert.');
  const cleaned: VariantGroup[] = newGroups.map(g => ({ name: collapse(g.name), values: g.values.map(collapse) }));
  // Nichts umbenannt → nichts anfassen (sonst bekämen alle Einträge displayValues, und der AliExpress-Namensabgleich
  // ali-attrs-sync.ts würde sie danach als "bewusst umbenannt" überspringen).
  if (JSON.stringify(cleaned) === JSON.stringify(oldGroups)) return { ok: true, variants: oldGroups, entries, pinned: [], untouched: [] };
  if (cleaned.some(g => !g.name || g.values.some(v => !v))) return fail('Leerer Gruppenname oder Wert — nichts gespeichert.');
  const dups = findDuplicateValues(cleaned);
  if (dups.length > 0) return fail(`Doppelte Werte nach der Umbenennung: ${dups.join('; ')} — nichts gespeichert.`);

  const oldCombos = buildCombinations(oldGroups);
  const newCombos = buildCombinations(cleaned);
  const pinned: Array<{ skuId: string; sku: string }> = [];
  const untouched: string[] = [];
  const out = entries.map(e => {
    const idx = oldCombos.map((c, i) => (entryMatchesCombo(c, e) ? i : -1)).filter(i => i >= 0);
    if (idx.length !== 1) { untouched.push(String(e.skuId ?? '?')); return e; }
    const next: T = { ...e, displayValues: newCombos[idx[0]] };
    if (opts.pinSku) {
      const sku = e.ebaySku && e.ebaySku.trim() ? e.ebaySku.trim() : comboSku(productId, oldCombos[idx[0]]);
      next.ebaySku = sku;
      pinned.push({ skuId: String(e.skuId ?? '?'), sku });
    }
    return next;
  });
  return { ok: true, variants: cleaned, entries: out, pinned, untouched };
}

// ─── Import-Tab: Vorschau Original → Deutsch, editierbar ────────────────────────────────────────────────────────────────
/** Schlüssel für einen editierten Wert im Import-Tab (Gruppe + Originalwert). */
export const valueKey = (group: string, value: string) => `${group}||${value}`;

/**
 * Deutsche Gruppen aus den aktuellen (Original-)Gruppen: Hand-Eingabe (names/values) vor dem Tabellen-Vorschlag.
 * Gleiche Struktur wie die Eingabe (nur Text) — passt damit direkt in applyVariantRename().
 */
export function translatedGroups(groups: VariantGroup[], names: Record<string, string>, values: Record<string, string>): VariantGroup[] {
  return groups.map(g => ({
    name: names[g.name] ?? translateGroupName(g.name).value,
    values: g.values.map(v => values[valueKey(g.name, v)] ?? translateVariantValue(v).value),
  }));
}

/** Lieferumfang je Wert (variantContents, Schlüssel = Variantenwert) auf die umbenannten Werte umschlüsseln. */
export function renameContentKeys(contents: Record<string, string>, before: VariantGroup[], after: VariantGroup[]): Record<string, string> {
  const map = new Map<string, string>();
  before.forEach((g, gi) => g.values.forEach((v, vi) => { const n = after[gi]?.values[vi]; if (n != null) map.set(v, n); }));
  return Object.fromEntries(Object.entries(contents).map(([k, val]) => [map.get(k) ?? k, val]));
}
