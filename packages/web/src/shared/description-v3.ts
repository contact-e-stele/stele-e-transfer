// Beschreibung v3 "einfach" (7 App, Schritt 5, 06.11.2026) — reine Funktionen (Grundgesetz 2), kein DB-/Netz-Zugriff.
// Vorgaben: claude/design-check-teil2-bestseller-2026-11-04.md (Plan "Beschreibung einfach"),
//           claude/design-vorgabe-v23-2026-10-06.md (Regel D2 Maße),
//           claude/entscheidung-inhaber-versand-retouren-fusszeile-2026-11-06.md (Versand/Rückgabe/§19 als Fußzeile).
//
// Grundgesetz 4: jede Zeile nur aus echten Produktdaten. Fehlt ein Wert, fällt die Zeile weg — kein Platzhalter, kein Füllsatz.
// Herkunft der Werte (erste vorhandene gilt):
//   Inhalt  : variantDetails[].pieces  →  Stückzahl im Variantennamen ("100pcs" → 100, Quelle a nach D2)
//   Maße    : variantDetails[].measure (D2, formatMeasure) — sonst keine Zeile
//   Material: product.material  →  specs "Material" (nur wenn übersetzbar, Tabelle aus spec-aspects.ts)
//   Farbe   : specs "Farbe"/"Color" (übersetzbar)  →  Farbwörter aus den Variantennamen (translateVariantValue)
//   Produktart: manualAspects.Produktart  →  specs "Produktart"
//   Verwendung: usePurpose + usageNote
import { formatMeasure, type VariantDetails } from './variant-measure';
import { translateVariantValue } from './variant-text-de';
import { translateMaterial } from './spec-aspects';
import { NON_VARIATION_ASPECTS } from './variant-resolver';

/** Merkmal der v3-Vorlage — fehlt es in einer gespeicherten Beschreibung, wird sie beim Listen neu gebaut. */
export const DESCRIPTION_V3_MARKER = '<!-- stele-beschreibung: v3 -->';
export const MAX_V3_BULLETS = 5;

export interface DescriptionV3Input {
  title: string;
  variants?: Array<{ name: string; values: string[] }>;
  specs?: Record<string, string>;
  material?: string | null;
  usageNote?: string | null;
  usePurpose?: string | null;
  variantDetails?: VariantDetails | null;
  manualAspects?: Record<string, string> | null;
}

export interface FactRow { label: string; value: string }
export interface V3Bullet { keyword: string | null; text: string }

const clean = (s: string | null | undefined): string => String(s ?? '').replace(/\s+/g, ' ').trim();
/** Vom Nutzer gepflegte Freitexte dürfen kein HTML einschleusen. */
const esc = (s: string): string => s.replace(/&(?![a-zA-Z]+;|#\d+;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const uniq = <T>(xs: T[]): T[] => [...new Set(xs)];

function specValue(specs: Record<string, string> | undefined, keys: string[]): string | null {
  if (!specs) return null;
  for (const [k, v] of Object.entries(specs)) {
    if (keys.includes(k.trim().toLowerCase()) && clean(v)) return clean(v);
  }
  return null;
}

/** Variantenwerte der echten Varianten-Gruppen ("Ships From" u. ä. zählen nicht). */
function variantValues(variants: DescriptionV3Input['variants']): string[] {
  return (variants ?? [])
    .filter(g => !NON_VARIATION_ASPECTS.has(clean(g.name)) && clean(g.name).toLowerCase() !== 'ships from')
    .flatMap(g => g.values.map(clean))
    .filter(Boolean);
}

const PIECES_RE = /\b(\d+)\s*(?:pcs|pc|pieces|piece|stück|stk)\b\.?/i;

/** Stückzahlen je Variante, aufsteigend, ohne Doppelte. Leer = keine belegte Stückzahl. */
export function piecesOf(input: DescriptionV3Input): number[] {
  const fromDetails = Object.values(input.variantDetails ?? {})
    .map(d => d?.pieces)
    .filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0);
  if (fromDetails.length > 0) return uniq(fromDetails).sort((a, b) => a - b);
  const fromNames = variantValues(input.variants)
    .map(v => v.match(PIECES_RE)?.[1])
    .filter((x): x is string => !!x)
    .map(Number)
    .filter(n => n > 0);
  return uniq(fromNames).sort((a, b) => a - b);
}

/** "100 Stück" bzw. "50 / 100 / 500 Stück". */
export function formatPieces(pieces: number[]): string | null {
  return pieces.length > 0 ? `${pieces.join(' / ')} Stück` : null;
}

/** Maße nach D2: einheitlich → ein Wert; je Variante verschieden → "Name: Maß" je Variante. */
export function measureText(details: VariantDetails | null | undefined): { uniform: string | null; perVariant: string | null } {
  const entries = Object.values(details ?? {})
    .map(d => ({ name: esc(clean(d?.displayNameDe)), m: formatMeasure(d?.measure ?? null) }))
    .filter((e): e is { name: string; m: string } => !!e.m);
  if (entries.length === 0) return { uniform: null, perVariant: null };
  const distinct = uniq(entries.map(e => e.m));
  if (distinct.length === 1) return { uniform: distinct[0], perVariant: null };
  return { uniform: null, perVariant: entries.map(e => (e.name ? `${e.name}: ${e.m}` : e.m)).join(' &middot; ') };
}

/** Farben aus den Variantennamen ("Multicolour 100pcs" → "Mehrfarbig"); nur vollständig übersetzbare Werte. */
function colorsFromVariants(variants: DescriptionV3Input['variants']): string[] {
  const out: string[] = [];
  for (const v of variantValues(variants)) {
    const t = translateVariantValue(v);
    if (t.unknownWords.length > 0) continue;
    const rest = clean(t.value.replace(/\b\d+\s*Stück\b/gi, '').replace(/\b\d+-teiliges Set\b/gi, ''));
    if (rest && !/\d/.test(rest)) out.push(rest.charAt(0).toUpperCase() + rest.slice(1).toLowerCase());
  }
  return uniq(out);
}

function colorText(input: DescriptionV3Input): string | null {
  const spec = specValue(input.specs, ['farbe', 'color', 'colour']);
  if (spec) {
    const t = translateVariantValue(spec);
    if (t.unknownWords.length === 0) return t.value;
  }
  const fromVariants = colorsFromVariants(input.variants);
  return fromVariants.length > 0 ? fromVariants.join(' / ') : null;
}

function materialText(input: DescriptionV3Input): string | null {
  if (clean(input.material)) return esc(clean(input.material));
  const spec = specValue(input.specs, ['material', 'materialien', 'main material', 'hauptmaterial']);
  return spec ? translateMaterial(spec) : null;
}

/** Datentabelle (4–6 Zeilen, nur belegte Zeilen). */
export function factRows(input: DescriptionV3Input): FactRow[] {
  const rows: FactRow[] = [];
  const productType = clean(input.manualAspects?.['Produktart']) || specValue(input.specs, ['produktart']);
  if (productType) rows.push({ label: 'Produktart', value: esc(productType) });
  const material = materialText(input);
  if (material) rows.push({ label: 'Material', value: material });
  const color = colorText(input);
  if (color) rows.push({ label: 'Farbe', value: color });
  const measure = measureText(input.variantDetails);
  if (measure.uniform) rows.push({ label: 'Ma&szlig;e', value: measure.uniform });
  else if (measure.perVariant) rows.push({ label: 'Ma&szlig;e', value: measure.perVariant });
  const pieces = formatPieces(piecesOf(input));
  if (pieces) rows.push({ label: 'Inhalt', value: pieces });
  const usage = [clean(input.usePurpose), clean(input.usageNote)].filter(Boolean).map(esc).join(' &middot; ');
  if (usage) rows.push({ label: 'Verwendung', value: usage });
  return rows;
}

/** Überschrift: Name · Menge · Maß (Menge/Maß nur, wenn belegt und nicht schon im Namen). */
export function headingText(input: DescriptionV3Input): string {
  const name = clean(input.title);
  const parts = [name];
  const pieces = piecesOf(input);
  const piecesInName = pieces.length === 1 && new RegExp(`\\b${pieces[0]}\\s*(?:stück|stk|pcs)\\b`, 'i').test(name);
  const p = formatPieces(pieces);
  if (p && !piecesInName) parts.push(p);
  const m = measureText(input.variantDetails).uniform;
  if (m) parts.push(m);
  return parts.filter(Boolean).join(' &middot; ');
}

// Versand-/Rückgabe-Aussagen gehören in die EINE Fußzeile (Quelle shared/shipping-return-text.ts) — im Stichpunkt würden sie
// ihr widersprechen (Beleg: Gemini-Füllsätze "Schnelle Lieferung aus dem EU-Lager", "30 Tage Rückgabe über eBay Käuferschutz").
const FOOTER_TOPIC_RE = /\b(lieferung|lieferzeit|versand\w*|r(?:ü|ue)ckgabe\w*|r(?:ü|ue)cksend\w*|r(?:ü|ue)ckversand|k(?:ä|ae)uferschutz|eu-lager)\b/i;
const KEYWORD_RE = /^([^:]{2,40}?)\s*:\s+(.{3,})$/;

/** Bis zu 5 Stichpunkte "✓ STICHWORT – Satz". Ein Stichwort gibt es nur, wenn der Text selbst eins trägt ("Stichwort: Satz"). */
export function v3Bullets(lines: string[]): V3Bullet[] {
  const out: V3Bullet[] = [];
  for (const raw of lines) {
    const line = clean(raw);
    if (!line || FOOTER_TOPIC_RE.test(line)) continue;
    const m = line.match(KEYWORD_RE);
    out.push(m ? { keyword: m[1].toUpperCase(), text: m[2] } : { keyword: null, text: line });
    if (out.length >= MAX_V3_BULLETS) break;
  }
  return out;
}
