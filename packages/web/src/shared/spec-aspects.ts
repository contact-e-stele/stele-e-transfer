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
 * C2 (25.10.2026, echte Werte aller 72 Live-Produkte gesichtet): AliExpress liefert die Werte ENGLISCH und oft unsauber
 * ("Type: cats", "Feature: Stocked", "Style: fashion"). Deshalb nur noch Merkmale, deren Wert sich eindeutig übersetzen
 * bzw. prüfen lässt; Typ/Stil/Besonderheiten/Zubehör/Menge/Gewicht werden NICHT mehr übernommen.
 */
const KEY_ALIASES: Record<string, string[]> = {
  origin: ['herstellungsland und -region', 'herstellungsland', 'ursprungsland'],
  herkunft: ['herstellungsland und -region', 'herstellungsland', 'ursprungsland'],
  ursprung: ['herstellungsland und -region', 'herstellungsland', 'ursprungsland'],
  'place of origin': ['herstellungsland und -region', 'herstellungsland', 'ursprungsland'],
  material: ['material'], materialien: ['material'], 'main material': ['material'], hauptmaterial: ['material'],
  filling: ['füllmaterial', 'füllung'], füllung: ['füllmaterial', 'füllung'], füllmaterial: ['füllmaterial', 'füllung'],
  pattern: ['muster'], 'pattern type': ['muster'], muster: ['muster'],
  shape: ['form'], form: ['form'],
  size: ['maße', 'abmessungen'], dimensions: ['maße', 'abmessungen'], dimension: ['maße', 'abmessungen'], abmessungen: ['abmessungen', 'maße'], maße: ['maße', 'abmessungen'],
};

/** Nur diese eBay-Merkmale werden aus AliExpress gesetzt (Kleinbuchstaben). */
const ALLOWED_TARGETS = /^(herstellungsland und -region|herstellungsland|ursprungsland|material|füllmaterial|füllung|muster|form|maße|abmessungen)$/;

/** Übersetzungen — nur Werte, die am 25.10.2026 in den 72 Live-Produkten vorkamen, und eindeutige Fachbegriffe. Unbekannt → weglassen. */
const MATERIAL_DE: Record<string, string> = {
  plastic: 'Kunststoff', 'abs': 'ABS-Kunststoff', 'abs plastic': 'ABS-Kunststoff', pp: 'Polypropylen (PP)', polypropylene: 'Polypropylen (PP)',
  pe: 'Polyethylen (PE)', polyethylene: 'Polyethylen (PE)', pvc: 'PVC', polyester: 'Polyester', cotton: 'Baumwolle', nylon: 'Nylon',
  metal: 'Metall', 'stainless steel': 'Edelstahl', '304 stainless steel': 'Edelstahl', alloy: 'Legierung', paper: 'Papier',
  'art paper': 'Papier', 'synthetic paper': 'Synthetikpapier', cardboard: 'Karton', felt: 'Filz', latex: 'Latex', gel: 'Gel',
  leather: 'Leder', 'non-woven fabric': 'Vliesstoff', 'non-woven fabrics': 'Vliesstoff', fiber: 'Faser', 'cubic zirconia': 'Zirkonia',
  silicone: 'Silikon', wood: 'Holz', glass: 'Glas', rubber: 'Gummi', bamboo: 'Bambus', ceramic: 'Keramik',
};
const PATTERN_DE: Record<string, string> = { solid: 'Einfarbig', floral: 'Blumen', cartoon: 'Cartoon', print: 'Bedruckt', geometric: 'Geometrisch' };
const SHAPE_DE: Record<string, string> = { square: 'Quadratisch', round: 'Rund', rectangle: 'Rechteckig', rectangular: 'Rechteckig', heart: 'Herz' };

/** "Polyester / Cotton" → "Polyester, Baumwolle"; jeder Teil muss übersetzbar sein, sonst null. */
export function translateValue(table: Record<string, string>, value: string): string | null {
  const parts = value.split(/\s*[/,+&]\s*/).map(x => x.trim().toLowerCase()).filter(Boolean);
  if (parts.length === 0) return null;
  const out = parts.map(x => table[x]);
  if (out.some(x => !x)) return null;
  return [...new Set(out)].join(', ');
}

/** Maße nur, wenn Zahlen mit Einheit: "45x50cm", "About 13.5*3cm" → "45 x 50 cm", "13,5 x 3 cm". */
export function normalizeDimensions(value: string): string | null {
  const m = value.toLowerCase().replace(/^about\s+/, '').match(/^(\d+(?:[.,]\d+)?)\s*[x*×]\s*(\d+(?:[.,]\d+)?)(?:\s*[x*×]\s*(\d+(?:[.,]\d+)?))?\s*(cm|mm)$/);
  if (!m) return null;
  const n = (x: string) => x.replace('.', ',');
  return [m[1], m[2], m[3]].filter(Boolean).map(x => n(x!)).join(' x ') + ' ' + m[4];
}

/** AliExpress-Herkunftsangaben, die eindeutig China bedeuten. */
const CHINA_VALUES = /^(cn|china|mainland china|china mainland|cn\(origin\)|china \(mainland\)|festlandchina|festland china|china \(festland\))$/i;

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Wert für das Ziel-Merkmal: übersetzt/geprüft oder null (= weglassen). */
function valueFor(aspectNameLc: string, value: string): string | null {
  const v = value.trim().replace(/\s+/g, ' ');
  if (/herstellungsland|ursprungsland/.test(aspectNameLc)) return CHINA_VALUES.test(v) ? 'China' : null;
  if (/^(material|füllmaterial|füllung)$/.test(aspectNameLc)) return translateValue(MATERIAL_DE, v);
  if (aspectNameLc === 'muster') return translateValue(PATTERN_DE, v);
  if (aspectNameLc === 'form') return translateValue(SHAPE_DE, v);
  if (aspectNameLc === 'maße' || aspectNameLc === 'abmessungen') return normalizeDimensions(v);
  return null;
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

    if (!ALLOWED_TARGETS.test(nameLc)) { out.skipped.push({ specKey: rawKey, reason: `${def.localizedAspectName} wird nicht aus AliExpress übernommen` }); continue; }
    const translated = valueFor(nameLc, value);
    if (translated === null) { out.skipped.push({ specKey: rawKey, reason: `Wert "${value}" nicht eindeutig übersetzbar` }); continue; }
    let v = translated;
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
