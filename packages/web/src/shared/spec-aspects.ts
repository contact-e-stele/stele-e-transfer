// Punkt C (Inhaber 25.10.2026): AliExpress-Produktmerkmale → eBay-Artikelmerkmale, gesteuert von der echten Merkmal-Liste der
// eBay-Kategorie (Taxonomy API). REINE Funktionen, keine DB, kein Netz.
//
// Befund 25.10.2026: alle 72 Live-Angebote hatten specs = NULL → eBay bekam nur Marke/Abteilung/EAN/MPN (Konkurrent 257779674975:
// 10 Merkmale, u. a. Material, Maße, Zubehör, Ursprungsland). Grundgesetz 4: kein Wert wird erfunden — gesendet wird nur, was
// AliExpress liefert UND was die Kategorie als Merkmal kennt; bei Auswahl-Merkmalen (SELECTION_ONLY) nur ein erlaubter Wert.

export interface CategoryAspectDef {
  localizedAspectName: string;
  aspectConstraint?: { aspectRequired?: boolean; aspectMode?: 'FREE_TEXT' | 'SELECTION_ONLY' };
  aspectValues?: Array<{ localizedValue: string }>;
}

/** eBay: Merkmalswerte höchstens 65 Zeichen. Längere Werte werden NICHT gekürzt gesendet (sinnentstellend), sondern ausgelassen. */
export const ASPECT_VALUE_MAX = 65;

/** Merkmale, die hier NIE gesetzt werden: Marke (Markenlos-Pflicht, eigene Logik), Kennungen (eigene Prüfung EAN/MPN-Guard). */
const NEVER_FROM_SPECS = /^(marke|brand|markenname|brand name|ean|gtin|upc|isbn|mpn|herstellernummer|model number|modellnummer)$/i;

/**
 * Ali-Schlüssel → mögliche eBay-Merkmalnamen (Kleinbuchstaben). Nur Zuordnungen, bei denen derselbe Begriff gemeint ist.
 * Welcher Name tatsächlich gesetzt wird, entscheidet die Kategorie-Liste (erster vorhandener Name gewinnt).
 */
const KEY_ALIASES: Record<string, string[]> = {
  origin: ['herstellungsland und -region', 'herstellungsland', 'ursprungsland'],
  herkunft: ['herstellungsland und -region', 'herstellungsland', 'ursprungsland'],
  ursprung: ['herstellungsland und -region', 'herstellungsland', 'ursprungsland'],
  'place of origin': ['herstellungsland und -region', 'herstellungsland', 'ursprungsland'],
  material: ['material'],
  materialien: ['material'],
  'main material': ['material'],
  hauptmaterial: ['material'],
  color: ['farbe'], colour: ['farbe'], farbe: ['farbe'],
  type: ['produktart', 'typ'], typ: ['produktart', 'typ'], art: ['produktart', 'typ'],
  style: ['stil'], stil: ['stil'],
  pattern: ['muster'], 'pattern type': ['muster'], muster: ['muster'],
  size: ['größe', 'maße'], größe: ['größe', 'maße'], groesse: ['größe', 'maße'],
  dimensions: ['maße', 'abmessungen'], dimension: ['maße', 'abmessungen'], abmessungen: ['abmessungen', 'maße'], maße: ['maße', 'abmessungen'],
  weight: ['gewicht', 'artikelgewicht'], gewicht: ['gewicht', 'artikelgewicht'],
  shape: ['form'], form: ['form'],
  feature: ['besonderheiten'], features: ['besonderheiten'], merkmal: ['besonderheiten'], besonderheiten: ['besonderheiten'],
  accessory: ['zubehör'], accessories: ['zubehör'], zubehör: ['zubehör'],
  'suitable for': ['geeignet für'], 'geeignet für': ['geeignet für'],
  'number of pieces': ['anzahl der einheiten', 'stückzahl'], quantity: ['anzahl der einheiten', 'stückzahl'], menge: ['anzahl der einheiten', 'stückzahl'],
};

/** AliExpress-Herkunftsangaben, die eindeutig China bedeuten. Alles andere bleibt wie geliefert. */
const CHINA_VALUES = /^(cn|china|mainland china|china mainland|cn\(origin\)|festlandchina|festland china|china \(festland\))$/i;

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeValue(aspectNameLc: string, value: string): string {
  const v = value.trim().replace(/\s+/g, ' ');
  if (/herstellungsland|ursprungsland/.test(aspectNameLc) && CHINA_VALUES.test(v)) return 'China';
  return v;
}

export interface SpecAspectMatch {
  aspects: Record<string, string>;              // eBay-Merkmalname (Schreibweise der Kategorie) → Wert
  used: Array<{ specKey: string; aspect: string; value: string }>;
  skipped: Array<{ specKey: string; reason: string }>;
}

/**
 * Ordnet AliExpress-Merkmale den Merkmalen der eBay-Kategorie zu.
 * 1) gleicher Name (ohne Groß/Klein) → 2) Alias-Tabelle. Nur Namen, die die Kategorie wirklich führt.
 * SELECTION_ONLY: Wert muss (ohne Groß/Klein) in der Liste stehen, gesendet wird die eBay-Schreibweise.
 * `alreadySet`: Merkmale, die anderswo schon entschieden sind (werden nicht überschrieben).
 */
export function matchSpecsToCategoryAspects(
  specs: Record<string, string>,
  categoryAspects: CategoryAspectDef[],
  alreadySet: Iterable<string> = [],
): SpecAspectMatch {
  const byName = new Map(categoryAspects.map(a => [norm(a.localizedAspectName), a]));
  const taken = new Set([...alreadySet].map(norm));
  const out: SpecAspectMatch = { aspects: {}, used: [], skipped: [] };

  for (const [rawKey, rawValue] of Object.entries(specs ?? {})) {
    const key = norm(rawKey);
    const value = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (!key || !value) { out.skipped.push({ specKey: rawKey, reason: 'leer' }); continue; }
    if (NEVER_FROM_SPECS.test(key)) { out.skipped.push({ specKey: rawKey, reason: 'Marke/Kennung – eigene Regel' }); continue; }

    const candidates = [key, ...(KEY_ALIASES[key] ?? [])];
    const def = candidates.map(c => byName.get(c)).find(Boolean);
    if (!def) { out.skipped.push({ specKey: rawKey, reason: 'Kategorie kennt kein passendes Merkmal' }); continue; }
    const nameLc = norm(def.localizedAspectName);
    if (taken.has(nameLc)) { out.skipped.push({ specKey: rawKey, reason: `${def.localizedAspectName} schon gesetzt` }); continue; }

    let v = normalizeValue(nameLc, value);
    if (v.length > ASPECT_VALUE_MAX) { out.skipped.push({ specKey: rawKey, reason: `Wert länger als ${ASPECT_VALUE_MAX} Zeichen` }); continue; }
    if (def.aspectConstraint?.aspectMode === 'SELECTION_ONLY') {
      const allowed = (def.aspectValues ?? []).find(a => norm(a.localizedValue) === norm(v));
      if (!allowed) { out.skipped.push({ specKey: rawKey, reason: `"${v}" nicht in der eBay-Auswahlliste von ${def.localizedAspectName}` }); continue; }
      v = allowed.localizedValue;
    }
    out.aspects[def.localizedAspectName] = v;
    out.used.push({ specKey: rawKey, aspect: def.localizedAspectName, value: v });
    taken.add(nameLc);
  }
  return out;
}

/**
 * ds.product.get → ae_item_properties.ae_item_property[]. Die App las bisher nur property_name/property_value; die DS-API liefert
 * (laut Fund 25.10.2026 vermutet, noch nicht live belegt) attr_name/attr_value. Beide Schreibweisen werden gelesen; der
 * Trockenlauf "Merkmale nachladen" zeigt live, welche ankommt.
 */
export function parseAliItemProperties(container: unknown, max = 30): Record<string, string> {
  const list = (container as { ae_item_property?: unknown } | undefined)?.ae_item_property;
  const arr = Array.isArray(list) ? list : [];
  const specs: Record<string, string> = {};
  for (const raw of arr.slice(0, max)) {
    const p = raw as Record<string, unknown>;
    const name = String(p.attr_name ?? p.property_name ?? '').trim();
    const value = String(p.attr_value ?? p.property_value ?? '').trim();
    if (name && value && !(name in specs)) specs[name] = value;
  }
  return specs;
}
