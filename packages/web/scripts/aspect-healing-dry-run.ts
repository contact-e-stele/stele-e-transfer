// P-88 Schritt 1 — VERIFIKATION: Trockenlauf gegen die echte Produktions-DB (NUR LESEND, kein
// db.update(), kein eBay-Schreib-Call — get_item_aspects_for_category ist ein GET). Beantwortet
// die im Auftrag verlangte Frage "bei wie vielen der 62 Produkte fehlen danach noch
// Pflichtmerkmale?" — genauer: bei wie vielen Produkten liefert buildAspects() (dieselbe Funktion,
// die auch beim echten Listing läuft, Grundgesetz Regel 8) mindestens einen Aspekt NUR über den
// generischen Fallback ("Nicht angegeben"/Kategorie-/globaler Default) statt über einen von eBay
// bestätigten oder aus AliExpress-Daten stammenden Wert — UND ob die 2 bekannten Fälle
// (stele-163 Farbe, stele-164 Produktart) ohne Handeingabe auflösbar sind.
//
// Läuft NICHT in dieser Sandbox (kein EBAY_CLIENT_ID/SECRET/REFRESH_TOKEN, s. task.md ENV-Abschnitt
// und scripts/diag-aspect-fetch-category-57920.ts — 401 invalid_client). Aufruf mit echten
// eBay-Zugangsdaten (lokal oder Render-Shell):
//   bun --env-file=<repo>/.env scripts/aspect-healing-dry-run.ts

import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import { getAccessToken, buildAspects, findUnresolvedRequiredAspects } from '../src/api/ebay';

console.log('Lade alle Produkte mit eBay-Kategorie aus der echten Produktions-DB (nur lesend)...\n');

const products = await db.select().from(schema.products);
const withCategory = products.filter(p => p.ebayCategory);
console.log(`${products.length} Produkte gesamt, ${withCategory.length} mit eBay-Kategorie.\n`);

const token = await getAccessToken();

let lowConfidenceCount = 0;
let stillMissingKnown = 0;
const details: string[] = [];

for (const p of withCategory) {
  const specs: Record<string, string> = (() => {
    try { return p.specs ? JSON.parse(p.specs) : {}; } catch { return {}; }
  })();
  const manualAspects: Record<string, string> = (() => {
    try { return p.manualAspects ? JSON.parse(p.manualAspects) : {}; } catch { return {}; }
  })();
  const variantAttrsList: Array<Record<string, string>> = (() => {
    try {
      const vp = JSON.parse(p.variantPrices ?? '[]');
      return Array.isArray(vp) ? vp.map((v: { attrs?: Record<string, string> }) => v.attrs ?? {}) : [];
    } catch { return []; }
  })();

  const aspects = await buildAspects(specs, undefined, p.ebayCategory ?? undefined, token, p.ean ?? undefined, manualAspects, variantAttrsList);
  const genericValues = new Set(['Nicht angegeben', 'Unbekannt']);
  const lowConfidence = Object.entries(aspects).filter(([, vals]) => vals.some(v => genericValues.has(v)));
  if (lowConfidence.length > 0) {
    lowConfidenceCount++;
    details.push(`stele-${p.id} (Kategorie ${p.ebayCategory}): ${lowConfidence.map(([n, v]) => `${n}="${v[0]}"`).join(', ')}`);
  }

  if (p.ebayMissingAspect) {
    const unresolved = await findUnresolvedRequiredAspects(
      [p.ebayMissingAspect], specs, p.ebayCategory ?? undefined, token, manualAspects, variantAttrsList,
    );
    if (unresolved.length > 0) {
      stillMissingKnown++;
      details.push(`stele-${p.id}: weiterhin ungelöst — ${unresolved.join(', ')}`);
    } else {
      details.push(`stele-${p.id}: "${p.ebayMissingAspect}" jetzt aufgelöst (ohne weitere Handeingabe) ✓`);
    }
  }
}

console.log(`Produkte mit mindestens einem Aspekt über generischen Fallback ("Nicht angegeben"/"Unbekannt"): ${lowConfidenceCount} von ${withCategory.length}`);
console.log(`Von eBay bereits konkret gemeldete, weiterhin ungelöste Pflichtfelder: ${stillMissingKnown}`);
console.log('\nDetails:');
console.log(details.join('\n'));
