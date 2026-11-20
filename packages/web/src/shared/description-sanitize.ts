// P-BESCHREIBUNG (AUFTRAG Aufsicht an 7 App 20.11.2026 07:45, Inhaber 07:40 Punkt 5, Gesetzbuch v62 Nr 162):
// Die KI-Texte (###INTRO### / ###BULLETS###) übernehmen Marke und ALLE Farben aus den AliExpress-Daten. Live-Fund stele-259
// ("Marke Holapet", "Rot, Blau, Gelb und Schwarz" — eBay-Marke "Markenlos", angeboten nur Schwarz) und stele-243 ("Marke: WRELS").
// Regel: keine Marke im Text (eBay-Spezifikation "Markenlos" gilt) und keine Farbe, die nicht als Variante angeboten wird.
// Reine Funktionen (Grundgesetz 2); angewendet in web/lib/ebay-description.ts (lightBulletSource, Vorlagen v3 und v4).

/** Farbwörter (deutsch + englisch) → deutscher Grundname. Nur einfache, eindeutige Farbnamen. */
const COLOR_WORDS: Record<string, string> = {
  schwarz: 'schwarz', black: 'schwarz',
  weiss: 'weiss', weiß: 'weiss', white: 'weiss',
  rot: 'rot', red: 'rot',
  blau: 'blau', blue: 'blau',
  gelb: 'gelb', yellow: 'gelb',
  grün: 'gruen', gruen: 'gruen', green: 'gruen',
  grau: 'grau', gray: 'grau', grey: 'grau',
  rosa: 'rosa', pink: 'rosa',
  lila: 'lila', violett: 'lila', purple: 'lila',
  orange: 'orange',
  braun: 'braun', brown: 'braun',
  beige: 'beige',
  gold: 'gold', golden: 'gold',
  silber: 'silber', silver: 'silber',
  türkis: 'tuerkis', tuerkis: 'tuerkis', turquoise: 'tuerkis',
};

const COLOR_AXIS = /^(farbe|farben|color|colour|varianten|variante)$/i;
const BRAND_SPEC_KEYS = /^(brand( name)?|marke|markenname)$/i;
const NO_BRAND = /^(markenlos|unbranded|none|no brand|ohne marke|n\/a|-)$/i;

function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-zäöüß]+/).filter(Boolean);
}

/** Grundfarben, die im Text vorkommen (deutsch/englisch, auch als Wortteil wie "Dunkelblau"). */
export function colorsIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of words(text)) {
    for (const [word, base] of Object.entries(COLOR_WORDS)) {
      // genau, deutsche Beugung (rote, blauen, schwarzer …) oder zusammengesetzt (Dunkelblau)
      if (w === word || /^(e|er|en|es|em)$/.test(w.slice(word.length)) && w.startsWith(word) || (word.length >= 4 && w.endsWith(word))) out.add(base);
    }
  }
  return out;
}

/** Angebotene Grundfarben aus den Varianten (Achse Farbe/Color/Varianten). null = keine Farbachse → keine Farbprüfung. */
export function offeredColors(variants: Array<{ name: string; values: string[] }> | null | undefined): Set<string> | null {
  const axes = (variants ?? []).filter(v => COLOR_AXIS.test(v.name.trim()));
  if (axes.length === 0) return null;
  const out = new Set<string>();
  for (const a of axes) for (const v of a.values) for (const c of colorsIn(v)) out.add(c);
  return out.size > 0 ? out : null;
}

/** Markennamen aus den AliExpress-Spezifikationen (z. B. "Brand Name": "HOLAPET"); "Markenlos"/"none" zählt nicht. */
export function brandNamesFrom(specs: Record<string, string> | null | undefined): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(specs ?? {})) {
    const val = String(v ?? '').trim();
    if (BRAND_SPEC_KEYS.test(k.trim()) && val.length >= 2 && !NO_BRAND.test(val)) out.push(val);
  }
  return out;
}

function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function mentionsBrand(text: string, brands: string[]): boolean {
  if (/^\s*(marke|brand)\b/i.test(text)) return true;
  return brands.some(b => new RegExp(`(^|[^\\p{L}])${escapeRe(b)}([^\\p{L}]|$)`, 'iu').test(text));
}

function mentionsOtherColor(text: string, offered: Set<string> | null): boolean {
  if (!offered) return false;
  for (const c of colorsIn(text)) if (!offered.has(c)) return true;
  return false;
}

/** Marke aus einem Satz entfernen ("HOLAPET Hundeschuhe …" → "Hundeschuhe …", "… von WRELS für …" → "… für …"). */
function stripBrand(text: string, brands: string[]): string {
  let t = text;
  for (const b of brands) {
    t = t.replace(new RegExp(`\\s*\\bvon\\s+${escapeRe(b)}(?=[^\\p{L}]|$)`, 'giu'), '');
    t = t.replace(new RegExp(`(^|[^\\p{L}])${escapeRe(b)}(?=[^\\p{L}]|$)\\s*`, 'giu'), '$1');
  }
  t = t.replace(/\s{2,}/g, ' ').replace(/\s+([,.:;])/g, '$1').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export interface SanitizeInput {
  introText: string;
  bulletLines: string[];
  specs?: Record<string, string> | null;
  variants?: Array<{ name: string; values: string[] }> | null;
}
export interface SanitizeResult { introText: string; bulletLines: string[]; removed: string[] }

/**
 * Stichpunkte mit Marke oder nicht angebotener Farbe fallen weg (kein Umschreiben — lieber 4 richtige als 5 mit Fehler).
 * Einleitung: Marke wird herausgenommen; nennt sie eine nicht angebotene Farbe, fällt sie ganz weg.
 */
export function sanitizeDescriptionText(input: SanitizeInput): SanitizeResult {
  const brands = brandNamesFrom(input.specs);
  const offered = offeredColors(input.variants);
  const removed: string[] = [];
  const bulletLines = input.bulletLines.filter(l => {
    const bad = mentionsBrand(l, brands) || mentionsOtherColor(l, offered);
    if (bad) removed.push(l);
    return !bad;
  });
  let introText = input.introText ? stripBrand(input.introText, brands) : '';
  if (introText && mentionsOtherColor(introText, offered)) { removed.push(input.introText); introText = ''; }
  return { introText, bulletLines, removed };
}
