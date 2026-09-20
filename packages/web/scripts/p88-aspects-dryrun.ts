// P-88 Teil 1 — NACHWEIS (b): reiner Lese-Trockenlauf, KEIN db.update()/insert(), KEIN eBay-Schreib-
// Call (get_item_aspects_for_category ist ein GET). Für jedes Produkt mit eBay-Kategorie: alle
// Pflichtmerkmale der Kategorie, gefundener Wert mit Quelle (ali/kategorie/global/manuell), Lücken.
// Zusammenfassung: "X von N Produkten ohne Lücke".
//
// KORREKTUR 20.09.2026 (Prüfbefund "GEHIRN"): die frühere Fassung zählte "eBay-Vorschlag" (eBays
// erster Listeneintrag, kein echter Wert) als Füllung — das ist per Definition ein erfundener Wert
// und wurde entfernt. Ein Abruf-Fehler (getRequiredAspects() liefert jetzt null statt {}) wird jetzt
// als eigener Fall FEHLER gezählt, NICHT als "lückenlos".
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
  findColorInTitles, IDENTIFIER_ASPECT_NAMES,
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
let withGap = 0;
let fetchErrors = 0;

// Für die Liste "fehlende Merkmale je Kategorie" (Punkt D des Auftrags 20.09.2026)
interface GapEntry {
  categoryId: string;
  name: string;
  productCount: number;
  selectionOnly: boolean;
  firstTenAllowedValues: string[];
}
const gapsByKey = new Map<string, GapEntry>(); // Schlüssel: `${categoryId}::${name}`

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
  const titleSources = [p.title, p.generatedTitle].filter((t): t is string => !!t);

  const required = await getRequiredAspects(categoryId);
  if (required === null) {
    fetchErrors++;
    lines.push(`## stele-${p.id} (Kategorie ${categoryId}) — ❌ FEHLER (Pflichtmerkmale nicht abrufbar)`);
    lines.push('');
    continue;
  }

  const effectiveSpecsAspects = mapSpecsToAspects({ ...deriveConstantVariantAttrs(variantAttrsList), ...specs });
  if (!effectiveSpecsAspects['Farbe']) {
    const titleColor = findColorInTitles(titleSources);
    if (titleColor) effectiveSpecsAspects['Farbe'] = titleColor;
  }

  const rows: Array<{ name: string; value: string; source: string }> = [];
  let hasGap = false;
  for (const [name, info] of Object.entries(required)) {
    if (IDENTIFIER_ASPECT_NAMES.has(name)) {
      // Deckt sich mit buildAspects(): Identifier-Aspekte (EAN/GTIN/UPC/ISBN) bekommen dort immer
      // "Nicht zutreffend" (oder die echte EAN) — kein Rateversuch, keine Lücke.
      rows.push({ name, value: 'Nicht zutreffend', source: 'identifier-fallback' });
      continue;
    }
    const resolution = await resolveRequiredAspect(name, info, effectiveSpecsAspects, categoryId, manualAspects);
    if (resolution.value !== null && resolution.source !== null) {
      rows.push({ name, value: resolution.value, source: resolution.source });
      continue;
    }
    rows.push({ name, value: '—', source: 'LÜCKE' });
    hasGap = true;

    const key = `${categoryId}::${name}`;
    const existing = gapsByKey.get(key);
    if (existing) {
      existing.productCount++;
    } else {
      gapsByKey.set(key, {
        categoryId, name, productCount: 1,
        selectionOnly: info.mode === 'SELECTION_ONLY',
        firstTenAllowedValues: info.allowedValues.slice(0, 10),
      });
    }
  }

  if (hasGap) withGap++; else gapless++;

  lines.push(`## stele-${p.id} (Kategorie ${categoryId}) — ${hasGap ? '⚠️ LÜCKE' : '✅ vollständig'}`);
  lines.push('');
  lines.push('| Pflichtmerkmal | Wert | Quelle |');
  lines.push('|---|---|---|');
  for (const r of rows) lines.push(`| ${r.name} | ${r.value} | ${r.source} |`);
  lines.push('');
}

lines.push(`## Zusammenfassung`);
lines.push('');
lines.push(`**${gapless} von ${withCategory.length} Produkten ohne Lücke.** ${withGap} mit mindestens einer Lücke, ${fetchErrors} mit Abruf-Fehler (nicht als lückenlos gezählt).`);
lines.push('');

lines.push(`## Fehlende Merkmale je Kategorie (für manuelle Standardwert-Pflege)`);
lines.push('');
if (gapsByKey.size === 0) {
  lines.push('Keine offenen Lücken.');
} else {
  lines.push('| Kategorie | Merkmal | Anzahl Produkte | SELECTION_ONLY | Erste 10 erlaubte Werte |');
  lines.push('|---|---|---|---|---|');
  for (const g of [...gapsByKey.values()].sort((a, b) => b.productCount - a.productCount)) {
    lines.push(`| ${g.categoryId} | ${g.name} | ${g.productCount} | ${g.selectionOnly ? 'ja' : 'nein'} | ${g.firstTenAllowedValues.join(', ') || '—'} |`);
  }
}

const output = lines.join('\n');
console.log(output);
writeFileSync(outPath, output, 'utf-8');
console.log(`\nDatei geschrieben: ${outPath}`);
