// P-88 Teil 1 — NACHWEIS (b): reiner Lese-Trockenlauf, KEIN db.update()/insert(), KEIN eBay-Schreib-
// Call (get_item_aspects_for_category ist ein GET). Für jedes Produkt mit eBay-Kategorie: alle
// Pflichtmerkmale der Kategorie, gefundener Wert mit Quelle (ali/kategorie/global/manuell/eBay-
// Vorschlag/LÜCKE). Zusammenfassung: "X von N Produkten ohne Lücke".
//
// Nutzt dieselben Funktionen wie der echte Listing-Pfad (getRequiredAspects/resolveRequiredAspect,
// ebay.ts) — kein Nachbau der Rangfolge-Logik (Grundgesetz Regel 8).
//
// Braucht einen echten eBay App-Token (client_credentials). Läuft diese Sandbox/dieser Rechner
// ohne EBAY_CLIENT_ID/EBAY_CLIENT_SECRET, bricht das Skript mit dem literalen Fehler ab — dann NICHT
// nach Zugangsdaten fragen, sondern diesen Befehl in einer Render-Shell ausführen (App-Verzeichnis):
//   cd packages/web && bun scripts/p88-aspects-dryrun.ts
// (Render hat EBAY_CLIENT_ID/EBAY_CLIENT_SECRET bereits als Umgebungsvariable gesetzt — kein
// --env-file nötig, im Gegensatz zum lokalen Aufruf unten.)
//
// Lokaler Aufruf (aus packages/web/): bun --env-file=<repo>/.env scripts/p88-aspects-dryrun.ts

import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import {
  getRequiredAspects, resolveRequiredAspect, mapSpecsToAspects, deriveConstantVariantAttrs,
  findColorInTitle, type RequiredAspectInfo,
} from '../src/api/ebay';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const outDir = resolve(import.meta.dir, 'output');
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, 'p88-aspects-dryrun.md');

console.log('Lade alle Produkte mit eBay-Kategorie aus der echten Produktions-DB (nur lesend)...\n');

const products = await db.select().from(schema.products);
const withCategory = products.filter(p => p.ebayCategory);
console.log(`${products.length} Produkte gesamt, ${withCategory.length} mit eBay-Kategorie.\n`);

const lines: string[] = [];
lines.push('# P-88 Teil 1 — Trockenlauf Pflichtmerkmale (echte Produktions-DB + echte eBay-Taxonomy-API, nur lesend)');
lines.push('');
lines.push(`Erzeugt mit \`bun scripts/p88-aspects-dryrun.ts\`. ${products.length} Produkte gesamt, ${withCategory.length} mit eBay-Kategorie geprüft.`);
lines.push('');

let gapless = 0;
let firstError: string | null = null;

for (const p of withCategory) {
  const categoryId = p.ebayCategory!;
  const specs: Record<string, string> = (() => { try { return p.specs ? JSON.parse(p.specs) as Record<string, string> : {}; } catch { return {}; } })();
  const manualAspects: Record<string, string> = (() => { try { return p.manualAspects ? JSON.parse(p.manualAspects) as Record<string, string> : {}; } catch { return {}; } })();
  const variantAttrsList: Array<Record<string, string>> = (() => {
    try {
      const vp = JSON.parse(p.variantPrices ?? '[]');
      return Array.isArray(vp) ? (vp as Array<{ attrs?: Record<string, string> }>).map(v => v.attrs ?? {}) : [];
    } catch { return []; }
  })();
  const title = p.generatedTitle ?? p.title;

  let required: Record<string, RequiredAspectInfo>;
  try {
    required = await getRequiredAspects(categoryId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!firstError) firstError = msg;
    lines.push(`## stele-${p.id} (Kategorie ${categoryId}) — ABRUF FEHLGESCHLAGEN`);
    lines.push('```');
    lines.push(msg);
    lines.push('```');
    lines.push('');
    continue;
  }

  const effectiveSpecsAspects = mapSpecsToAspects({ ...deriveConstantVariantAttrs(variantAttrsList), ...specs });
  if (!effectiveSpecsAspects['Farbe']) {
    const titleColor = findColorInTitle(title);
    if (titleColor) effectiveSpecsAspects['Farbe'] = titleColor;
  }

  const rows: Array<{ name: string; value: string; source: string }> = [];
  let hasGap = false;
  for (const [name, info] of Object.entries(required)) {
    const resolution = await resolveRequiredAspect(name, info, effectiveSpecsAspects, categoryId, manualAspects);
    if (resolution.source !== null && resolution.value !== null) {
      rows.push({ name, value: resolution.value, source: resolution.source });
      continue;
    }
    // Deckt sich mit findUnresolvedRequiredAspects()/buildAspects(): ein Auswahl-Merkmal mit
    // bekannter erlaubter Liste hat IMMER einen von eBay bestätigten Fallback-Kandidaten
    // (allowedValues[0]) — das ist kein Rateversuch, sondern eBays eigener erster erlaubter Wert.
    if (info.allowedValues.length > 0) {
      rows.push({ name, value: info.allowedValues[0], source: 'eBay-Vorschlag' });
      continue;
    }
    rows.push({ name, value: '—', source: 'LÜCKE' });
    hasGap = true;
  }

  if (!hasGap) gapless++;

  lines.push(`## stele-${p.id} (Kategorie ${categoryId}) — ${hasGap ? '⚠️ LÜCKE' : '✅ vollständig'}`);
  lines.push('');
  lines.push('| Pflichtmerkmal | Wert | Quelle |');
  lines.push('|---|---|---|');
  for (const r of rows) lines.push(`| ${r.name} | ${r.value} | ${r.source} |`);
  lines.push('');
}

lines.push(`## Zusammenfassung`);
lines.push('');
lines.push(`**${gapless} von ${withCategory.length} Produkten ohne Lücke.**`);
if (firstError) {
  lines.push('');
  lines.push(`⚠️ Mindestens ein Kategorie-Abruf ist fehlgeschlagen (erster Fehler): \`${firstError}\``);
}

const output = lines.join('\n');
console.log(output);
writeFileSync(outPath, output, 'utf-8');
console.log(`\nDatei geschrieben: ${outPath}`);
