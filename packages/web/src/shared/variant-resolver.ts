// P-85 Schritt 2b (20.09.2026): EINE exakte Varianten-SKU/Preis/Bild-Zuordnung statt zwei
// unabhängiger, ungenauer Rekonstruktionen (Grundgesetz Regel 8).
//
// Vorheriger Zustand: ebay.ts (listOnEbayWithVariants) matchte Anzeigewerte per Substring
// (`includes()`) gegen variantPrices[].attrs, price-monitor.ts (buildVariantSku) baute die
// erwartete SKU stattdessen direkt aus attrs neu (slugify), gegen die echten eBay-SKUs verglichen,
// bei Dubletten gewann der LETZTE (Map-Overwrite). Beide Wege drifteten auseinander, sobald ein
// Anzeigewert umbenannt wird — die reale eBay-SKU wurde beim Listing aus dem ANZEIGEWERT gebaut,
// price-monitor.ts rekonstruierte sie aus dem ORIGINAL-attrs-Wert.
//
// Live-Befund 20.09.2026 (belegte Fehlzuordnungen): stele-132 ("Indigo Pink" trifft "Indigo Pink
// Base Set" per Substring), stele-141 ("50pcs" trifft "150pcs"; Size="ONE SIZE" verhindert jeden
// SKU-Treffer in Weg B), stele-162 ("1" trifft "10", "2" trifft "12", ein Eintrag ganz ohne EK),
// stele-107/161 (doppelte attrs-Werte mit unterschiedlichem EK — Dublette, kein "erster Treffer"
// darf hier stillschweigend entscheiden), stele-70 (umbenannte Werte ohne Rückverfolgung:
// Silber-Optik/Gold-Optik vs. 1PCS/Gold), stele-154 (Ziffer vs. ausgeschriebene Zahl).
//
// resolveVariantEntries() ist jetzt die EINE Stelle, die sowohl ebay.ts (Listing-Erstellung:
// Preis/Menge/Bild je Variante) als auch price-monitor.ts (Preis-Update je echter eBay-SKU)
// nutzen. Rangfolge: (1) entry.displayValues — eine explizite, beim Umbenennen mitgeschriebene
// Zuordnung (s. syncDisplayValuesOnRename), überlebt jede künftige Umbenennung; (2) entry.attrs —
// exakter (nicht mehr Substring-), case-insensitiver, getrimmter Wertevergleich, NON_VARIATION_
// ASPECTS ignoriert. Uneindeutigkeit (mehrere Treffer, kein Treffer, kein EK, verwaister Eintrag)
// ist ein HARTER Fehler mit Klartext (Produkt, Wert, alle betroffenen skuIds+EK) — kein "erster
// Treffer"/"letzter gewinnt" mehr.

export interface VariantGroup {
  name: string;
  values: string[];
}

export interface VariantPriceEntry {
  skuId?: string;
  attrs?: Record<string, string>;
  price?: number;        // Einkaufspreis (AliExpress)
  ebayPrice?: number;
  stock?: number;
  imageUrl?: string;
  // P-85 Schritt 2b: explizite Gruppenname → Anzeigewert-Zuordnung, überschreibt attrs-Matching.
  // Wird NUR beim Umbenennen geschrieben (syncDisplayValuesOnRename) — kein Migrations-Feld,
  // bestehende variantPrices-JSON-Spalte, unbekannte Einträge haben es einfach nicht gesetzt.
  displayValues?: Record<string, string>;
}

export interface ResolvedVariantEntry {
  skuId: string;
  price?: number;
  ebayPrice?: number;
  stock?: number;
  imageUrl?: string;
}

export interface ResolvedVariant {
  displayValues: Record<string, string>; // Gruppenname (roh, wie in variants[]) → Anzeigewert dieser Kombination
  sku: string;                           // exakt wie ebay.ts sie beim Listing vergibt: stele-{id}-{slugify(Werte)}
  entry: ResolvedVariantEntry | null;    // null bei Fehler — s. error
  error: string | null;
}

// Merkmale, die NIE Teil einer echten Varianten-SKU/Preis-Zuordnung sind (z.B. Versandland) —
// vorher in ebay.ts definiert, hierher verschoben, da jetzt an drei Stellen gebraucht
// (ebay.ts Item-Aspekte, price-monitor.ts SKU-Aufbau, dieser Resolver). EINE Quelle (Regel 8).
export const NON_VARIATION_ASPECTS = new Set(['Ships From', 'Versandort', 'Herstellungsland', 'Country/Region of Manufacture']);

// Vorher in ebay.ts definiert, hierher verschoben (s.o.) — von ebay.ts re-exportiert, damit
// bestehende Importe (`from './ebay'`) unverändert weiterfunktionieren.
export function slugify(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 20);
}

function norm(v: string): string {
  return v.trim().toLowerCase();
}

function filteredAttrValues(attrs: Record<string, string> | undefined): string[] {
  return Object.entries(attrs ?? {})
    .filter(([k]) => !NON_VARIATION_ASPECTS.has(k))
    .map(([, v]) => v);
}

function buildCombinations(groups: VariantGroup[]): Array<Record<string, string>> {
  const result: Array<Record<string, string>> = [{}];
  for (const group of groups) {
    const next: Array<Record<string, string>> = [];
    for (const combo of result) {
      for (const value of group.values) {
        next.push({ ...combo, [group.name]: value });
      }
    }
    result.splice(0, result.length, ...next);
  }
  return result;
}

// EIN Eintrag matcht eine Kombination NUR exakt: entweder über seine explizite displayValues-
// Zuordnung (wenn vorhanden — dann verbindlich, attrs wird für DIESEN Eintrag nicht mehr geprüft),
// oder — falls (noch) keine displayValues gesetzt sind — über exakten, getrimmten, case-
// insensitiven Wertevergleich gegen die (NON_VARIATION_ASPECTS-gefilterten) attrs-Werte.
function entryMatchesCombo(combo: Record<string, string>, entry: VariantPriceEntry): boolean {
  if (entry.displayValues) {
    return Object.entries(combo).every(([k, v]) => norm(entry.displayValues![k] ?? '') === norm(v));
  }
  const attrsVals = filteredAttrValues(entry.attrs).map(norm);
  return Object.values(combo).every(v => attrsVals.includes(norm(v)));
}

function comboLabel(combo: Record<string, string>): string {
  return Object.entries(combo).map(([k, v]) => `${k}=${v}`).join(', ');
}

// EINE Zuordnung für Listing-Erstellung (ebay.ts) UND Preis-Update (price-monitor.ts) — je
// Kombination der Varianten-Gruppen (product.variants) wird GENAU EIN variantPrices-Eintrag
// gesucht. Mehrdeutigkeit, fehlender Treffer oder fehlender Einkaufspreis sind harte Fehler
// (Grundgesetz Regel 4: kein Raten, keine erfundenen Werte) — `entry` ist dann null, `error`
// enthält den Klartext-Grund inkl. betroffener skuIds/EK.
export function resolveVariantEntries(
  productId: number,
  variants: VariantGroup[],
  variantPrices: VariantPriceEntry[],
): ResolvedVariant[] {
  const combos = buildCombinations(variants);
  const results: ResolvedVariant[] = [];

  for (const combo of combos) {
    const sku = `stele-${productId}-${Object.values(combo).map(slugify).filter(Boolean).join('-')}`;
    const label = comboLabel(combo);
    const matches = variantPrices.filter(e => entryMatchesCombo(combo, e));

    if (matches.length === 0) {
      results.push({
        displayValues: combo, sku, entry: null,
        error: `Kein variantPrices-Eintrag für Anzeigewert(e) "${label}" (Produkt ${productId}) gefunden.`,
      });
      continue;
    }
    if (matches.length > 1) {
      const skuIds = matches.map(m => m.skuId ?? '?').join(', ');
      const eks = matches.map(m => m.price != null ? m.price.toFixed(2) : '—').join(', ');
      results.push({
        displayValues: combo, sku, entry: null,
        error: `Mehrdeutig: ${matches.length} variantPrices-Einträge passen auf Anzeigewert(e) "${label}" (Produkt ${productId}) — skuIds: ${skuIds}, EK: ${eks}.`,
      });
      continue;
    }
    const m = matches[0];
    if (!m.skuId) {
      results.push({
        displayValues: combo, sku, entry: null,
        error: `variantPrices-Eintrag für Anzeigewert(e) "${label}" (Produkt ${productId}) hat keine skuId.`,
      });
      continue;
    }
    if (m.price == null && m.ebayPrice == null) {
      results.push({
        displayValues: combo, sku, entry: null,
        error: `Kein Einkaufspreis (EK) für Anzeigewert(e) "${label}" (Produkt ${productId}, skuId ${m.skuId}) vorhanden.`,
      });
      continue;
    }
    results.push({
      displayValues: combo, sku,
      entry: { skuId: m.skuId, price: m.price, ebayPrice: m.ebayPrice, stock: m.stock, imageUrl: m.imageUrl },
      error: null,
    });
  }

  return results;
}

// P-85 Schritt 2b, Anforderung 2 ("Eintrag ohne Anzeigewert"): ein variantPrices-Eintrag, der auf
// KEINE Kombination der aktuellen Varianten-Gruppen passt — ein verwaister Eintrag (z.B. nach
// einer Umbenennung ohne displayValues-Mitschrift, oder ein gelöschter Anzeigewert). Blockiert das
// Listing NICHT automatisch (er wird bei resolveVariantEntries() einfach nicht verwendet), wird
// aber von der Vorab-Prüfung als Warnung/Fehler mit ausgegeben, damit er nicht unbemerkt bleibt.
export function findOrphanedVariantEntries(
  productId: number,
  variants: VariantGroup[],
  variantPrices: VariantPriceEntry[],
): string[] {
  const combos = buildCombinations(variants);
  const errors: string[] = [];
  for (const entry of variantPrices) {
    const matchesAnyCombo = combos.some(combo => entryMatchesCombo(combo, entry));
    if (!matchesAnyCombo) {
      errors.push(`variantPrices-Eintrag (skuId ${entry.skuId ?? '?'}, attrs=${JSON.stringify(entry.attrs ?? {})}) passt auf keinen aktuellen Anzeigewert (Produkt ${productId}) — verwaister Eintrag.`);
    }
  }
  return errors;
}

// P-85 Schritt 2b: wird beim Umbenennen aufgerufen (PATCH /products/:id/variants, Import-Tab
// lieferanten.tsx) — löst die variantPrices-Einträge gegen die ALTEN Anzeigewerte auf (dieselbe
// resolveVariantEntries()-Logik, Regel 8) und schreibt für jeden erfolgreich aufgelösten Eintrag
// die NEUEN Anzeigewerte (an derselben Kombinations-Position) als displayValues fest — überlebt
// damit jede künftige weitere Umbenennung.
//
// Voraussetzung: alte und neue Gruppen haben dieselbe Struktur (gleiche Anzahl Gruppen, gleiche
// Werte-ANZAHL je Gruppe — nur Werte-TEXT geändert). Bei Struktur-Änderungen (Gruppe hinzugefügt/
// entfernt, Wert hinzugefügt/entfernt) wird NICHTS geschrieben (bestehende displayValues bleiben
// unverändert, falls vorhanden) statt eine möglicherweise falsche Zuordnung zu raten (Grundgesetz
// Regel 4) — bewusste, im PR offengelegte Grenze (Regel 6), s. Abschnitt "OFFEN".
export function syncDisplayValuesOnRename(
  productId: number,
  oldVariants: VariantGroup[],
  newVariants: VariantGroup[],
  variantPrices: VariantPriceEntry[],
): VariantPriceEntry[] {
  const sameStructure = oldVariants.length === newVariants.length
    && oldVariants.every((g, i) => g.values.length === newVariants[i].values.length);
  if (!sameStructure) return variantPrices;

  const oldResolved = resolveVariantEntries(productId, oldVariants, variantPrices);
  const newCombos = buildCombinations(newVariants);
  if (oldResolved.length !== newCombos.length) return variantPrices;

  const newDisplayValuesBySkuId = new Map<string, Record<string, string>>();
  for (let i = 0; i < oldResolved.length; i++) {
    const skuId = oldResolved[i].entry?.skuId;
    if (skuId) newDisplayValuesBySkuId.set(skuId, newCombos[i]);
  }

  return variantPrices.map(entry =>
    entry.skuId && newDisplayValuesBySkuId.has(entry.skuId)
      ? { ...entry, displayValues: newDisplayValuesBySkuId.get(entry.skuId)! }
      : entry
  );
}
