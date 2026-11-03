// OFFEN 026 (03.11.2026): Variantenachse → eBay-Merkmalsname und -werte JE KATEGORIE.
//
// Root Cause (api/ebay.ts, vor diesem Modul): mapVariantGroupName() bildet einen AliExpress-Gruppennamen über eine FESTE
// Tabelle ab ('Size' → 'Größe', 'Color' → 'Variante'), ohne die Kategorie anzusehen. Die Achsenwerte gingen unverändert
// an eBay. Drei Fehlerbilder daraus (alle belegt):
//  1. Kategorie verlangt einen anderen Größen-Namen (z.B. 11632 "EU-Schuhgröße", ERGEBNIS 019 zu stele-241) → die Achse
//     heißt "Größe", das Pflichtmerkmal bleibt leer.
//  2. Kategorie verlangt "Farbe", die Farb-Achse heißt aber "Variante" (AliExpress "Color") oder "Varianten" (stele-243,
//     Kat. 105559: GRAY/BLACK) → "Farbe" fehlt, nur per Hand (manualAspects "Mehrfarbig") listbar — bei wechselnden Farben
//     sachlich falsch (Aufsicht, OFFEN 017 Nachtrag).
//  3. Kategorie erlaubt für "Größe" nur feste Werte (11511: 2XS … 51-54, Einheitsgröße; eBay: "no longer support custom
//     values for Größe", ERGEBNIS 019 zu stele-244/248) → AliExpress-Werte wie "40-42(26cm)" werden abgelehnt.
//
// Lösung: planVariantAxes() — EINE Stelle (Grundgesetz 8) für Vorab-Prüfung (Import-Tab + Listen) und das eigentliche
// Listen (Kombinationen, Aspekte je Variante, variesBy). Reine Funktion (Grundgesetz 2), Kategorie-Merkmale kommen als
// Eingabe (Taxonomy getItemAspectsForCategory).
//
// Werte werden NUR auf einen GLEICHBEDEUTENDEN Wert aus eBays Liste gesetzt (exakt, ohne Klammerzusatz, Buchstaben-
// größe XXL=2XL, "One Size"=Einheitsgröße). Keine Spannen-Abbildung (Inhaber 03.11. "C2 ja"). Kein Raten:
// passt nichts oder ergäben zwei Werte denselben eBay-Wert → Meldung, Wert bleibt unverändert (Grundgesetz 4).
// Die SKU-/Preis-Zuordnung (variant-resolver) arbeitet weiter mit den App-Werten — betroffen ist nur, was eBay angezeigt wird.

export interface AxisGroup { name: string; values: string[] }

/** Ein Merkmal der Kategorie, wie es für die Achsen-Planung gebraucht wird. */
export interface CategoryAspectInfo {
  allowedValues: string[];
  mode?: 'FREE_TEXT' | 'SELECTION_ONLY';
  required?: boolean;
  /** Taxonomy aspectConstraint.aspectEnabledForVariations — undefined = unbekannt (zählt als "ja"). */
  variationEnabled?: boolean;
}

export interface ValueMapping { from: string; to: string; how: 'exakt' | 'normalisiert' | 'Farbe' }

export interface AxisPlan {
  groupName: string;    // App-Gruppenname (roh)
  aspectName: string;   // Merkmalsname, der an eBay geht
  values: string[];     // Werte für eBay — gleiche Reihenfolge/Länge wie group.values
  renamedFrom?: string; // Name aus der festen Tabelle, falls je Kategorie umgestellt
  mapped: ValueMapping[]; // nur tatsächlich geänderte Werte
  problems: string[];   // Format "<Merkmal>: …" (filterEditableAspectNames erkennt ": ")
}

export interface PlanDeps {
  /** Feste Tabelle (api/ebay.ts mapVariantGroupName). */
  baseName: (groupName: string) => string;
  /** Farbwort → deutsche eBay-Grundfarbe, sonst null (api/ebay.ts findColorInTitle). */
  colorOf: (value: string) => string | null;
}

const SIZE_GROUP_RE = /(size|größe|groesse|\bgr\b)/i;
const SIZE_ASPECT_RE = /(größe|size)/i;
const SHOE_RE = /(shoe|schuh)/i;
// Feste Tabellen-Ziele, die eine andere Bedeutung als Farbe haben — solche Achsen werden nie zu "Farbe".
const NON_COLOR_TARGETS = new Set(['Größe', 'Material', 'Stil', 'Menge', 'Modell', 'Typ', 'Rahmenfarbe', 'Linsenfarbe']);

const isUsable = (a: CategoryAspectInfo | undefined) => !!a && a.variationEnabled !== false;

function pickSizeAspect(groupName: string, category: Record<string, CategoryAspectInfo>, used: Set<string>): string | null {
  const shoe = SHOE_RE.test(groupName);
  const cands = Object.entries(category)
    .filter(([n, a]) => a.required && isUsable(a) && SIZE_ASPECT_RE.test(n) && !used.has(n))
    .map(([n]) => n);
  if (cands.length === 0) return null;
  const score = (n: string) => (shoe && SHOE_RE.test(n) ? 100 : 0) + (n === 'Größe' ? 50 : 0) + (/^EU/i.test(n) ? 10 : 0) - n.length / 100;
  return cands.sort((a, b) => score(b) - score(a))[0];
}

// ─── Werte ──────────────────────────────────────────────────────────────────────────────────────────

const stripParen = (v: string) => v.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');
const squash = (v: string) => v.toLowerCase().replace(/\s+/g, '').replace(/^eu/, '').replace(/cm$/, '');

const LETTER_ALIASES: Record<string, string> = {
  xxs: '2xs', xxxs: '3xs', xxl: '2xl', xxxl: '3xl', xxxxl: '4xl', xxxxxl: '5xl',
};
const ONE_SIZE = new Set(['onesize', 'freesize', 'einheitsgröße', 'einheitsgrösse', 'universal', 'os']);

function letterKey(v: string): string {
  const s = squash(stripParen(v));
  if (ONE_SIZE.has(s)) return 'einheitsgröße';
  return LETTER_ALIASES[s] ?? s;
}

/** Einen App-Wert auf genau einen Wert aus eBays Liste abbilden — oder null (kein eindeutiger Treffer). */
export function matchAllowedValue(value: string, allowed: string[]): { to: string; how: ValueMapping['how'] } | null {
  const v = value.trim();
  const exact = allowed.find(a => a.toLowerCase() === v.toLowerCase());
  if (exact) return { to: exact, how: 'exakt' };

  const key = letterKey(v);
  if (key) {
    const norm = allowed.filter(a => letterKey(a) === key);
    if (norm.length === 1) return { to: norm[0], how: 'normalisiert' };
    if (norm.length > 1) return null;
  }

  // Inhaber 03.11. "C2 ja": KEINE Spannen-Abbildung (40-42 → 39-42 hieße: Käufer mit 39 bestellt → Retoure).
  return null;
}

function mapValues(aspectName: string, values: string[], info: CategoryAspectInfo | undefined, colorAxis: boolean, colorOf: PlanDeps['colorOf']) {
  const problems: string[] = [];
  const mapped: ValueMapping[] = [];
  const list = info?.mode === 'SELECTION_ONLY' ? info.allowedValues : [];
  const out = values.map(v => {
    if (!v?.trim()) { problems.push(`${aspectName}: Achsenwert ist leer`); return v; }
    if (list.length === 0) return v; // Freitext (oder unbekannt) → App-Wert unverändert
    let hit = matchAllowedValue(v, list);
    if (!hit && colorAxis) {
      const c = colorOf(v);
      const inList = c ? list.find(a => a.toLowerCase() === c.toLowerCase()) : undefined;
      if (inList) hit = { to: inList, how: 'Farbe' };
    }
    if (!hit) { problems.push(`${aspectName}: Wert '${v}' nicht in eBays Liste`); return v; }
    if (hit.to !== v) mapped.push({ from: v, to: hit.to, how: hit.how });
    return hit.to;
  });
  // Zwei App-Werte → derselbe eBay-Wert: eBay würde zwei gleiche Varianten sehen → nicht abbilden, melden.
  const seen = new Map<string, string>();
  values.forEach((v, i) => {
    const prev = seen.get(out[i].toLowerCase());
    if (prev !== undefined && prev !== v) problems.push(`${aspectName}: '${prev}' und '${v}' ergäben beide '${out[i]}'`);
    else seen.set(out[i].toLowerCase(), v);
  });
  return { values: out, mapped, problems };
}

/**
 * Plan je Variantengruppe. `category` = alle Merkmale der eBay-Kategorie (null = Abruf fehlgeschlagen/unbekannt →
 * bisheriges Verhalten: Name aus der festen Tabelle, Werte unverändert, keine Meldungen).
 */
export function planVariantAxes(groups: AxisGroup[], category: Record<string, CategoryAspectInfo> | null, deps: PlanDeps): AxisPlan[] {
  const used = new Set<string>();
  const bases = groups.map(g => deps.baseName(g.name));
  bases.forEach(b => { if (category?.[b]?.required) used.add(b); });

  return groups.map((g, i) => {
    const base = bases[i];
    if (!category) return { groupName: g.name, aspectName: base, values: [...g.values], mapped: [], problems: [] };

    let name = base;
    const baseRequired = !!category[base]?.required;
    if (!baseRequired) {
      const isSize = base === 'Größe' || SIZE_GROUP_RE.test(g.name);
      if (isSize) {
        const pick = pickSizeAspect(g.name, category, used);
        if (pick) name = pick;
      } else if (!NON_COLOR_TARGETS.has(base) && base !== 'Farbe') {
        const farbe = category['Farbe'];
        const allColors = g.values.length > 0 && g.values.every(v => !!deps.colorOf(v));
        if (farbe?.required && isUsable(farbe) && !used.has('Farbe') && allColors) name = 'Farbe';
      }
    }
    // Zwei Gruppen dürfen nie denselben Merkmalsnamen bekommen (eBay 25013-artige Fehler) → dann fester Name.
    if (name !== base && used.has(name)) name = base;
    used.add(name);

    const colorAxis = name === 'Farbe';
    const mv = mapValues(name, g.values, category[name], colorAxis, deps.colorOf);
    return {
      groupName: g.name,
      aspectName: name,
      values: mv.values,
      ...(name !== base ? { renamedFrom: base } : {}),
      mapped: mv.mapped,
      problems: mv.problems,
    };
  });
}

/** Taxonomy-Rohdaten → Merkmals-Map für planVariantAxes (ungefiltert, auch nicht-Pflicht). */
export function categoryAspectMap(raw: Array<{
  localizedAspectName: string;
  aspectConstraint?: { aspectRequired?: boolean; aspectMode?: 'FREE_TEXT' | 'SELECTION_ONLY'; aspectEnabledForVariations?: boolean };
  aspectValues?: Array<{ localizedValue: string }>;
}>): Record<string, CategoryAspectInfo> {
  const out: Record<string, CategoryAspectInfo> = {};
  for (const a of raw) {
    out[a.localizedAspectName] = {
      allowedValues: a.aspectValues?.map(v => v.localizedValue) ?? [],
      mode: a.aspectConstraint?.aspectMode,
      required: !!a.aspectConstraint?.aspectRequired,
      variationEnabled: a.aspectConstraint?.aspectEnabledForVariations,
    };
  }
  return out;
}
