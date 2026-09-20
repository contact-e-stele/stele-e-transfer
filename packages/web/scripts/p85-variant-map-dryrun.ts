// P-85 Schritt 2b — NACHWEIS (Punkt 5): reiner Lese-Trockenlauf, KEIN db.update()/insert(), KEIN
// eBay-Schreib-Call. Für jedes Produkt mit Varianten-Gruppen: je Anzeigewert-Kombination die ALTE
// Zuordnung (bisherige Substring-Suche, ebay.ts/price-monitor.ts vor diesem PR) neben der NEUEN
// (resolveVariantEntries(), variant-resolver.ts) — Status ok/blockiert mit Klartext-Grund.
//
// Nutzt dieselbe Funktion wie der echte Listing-/Preis-Update-Pfad (resolveVariantEntries,
// variant-resolver.ts) — kein Nachbau der Zuordnungs-Logik (Grundgesetz Regel 8).
//
// Ausgabe als Markdown in scripts/output/ — wird NICHT ins Repo committet (s. PR-Beschreibung,
// dieselbe Regel wie P-88 Nacharbeit Punkt 5: Trockenlauf-Ausgaben ändern sich bei jedem Lauf).
//
// Lokaler Aufruf (aus packages/web/): bun --env-file=<repo>/.env scripts/p85-variant-map-dryrun.ts

import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import { resolveVariantEntries, findOrphanedVariantEntries, type VariantGroup, type VariantPriceEntry } from '../src/shared/variant-resolver';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const outDir = resolve(import.meta.dir, 'output');
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, 'p85-variant-map-dryrun.md');

console.log('Lade alle Produkte mit Varianten-Gruppen aus der echten Produktions-DB (nur lesend)...\n');

const products = await db.select().from(schema.products);
const withVariants = products.filter(p => {
  try { return (JSON.parse(p.variants) as unknown[]).length > 0; } catch { return false; }
});
console.log(`${products.length} Produkte gesamt, ${withVariants.length} mit Varianten-Gruppen.\n`);

// ALTE Zuordnung (Substring, vor diesem PR) — hier NACHGEBAUT nur für den Vorher/Nachher-Vergleich
// im Bericht, NICHT produktiv genutzt (ebay.ts/price-monitor.ts nutzen bereits die neue Funktion).
function oldSubstringMatch(comboValues: string[], attrs: Record<string, string> | undefined): boolean {
  const attrsVal = Object.values(attrs ?? {}).map(v => v.toLowerCase());
  return comboValues.every(cv => attrsVal.some(av => av.includes(cv.toLowerCase()) || cv.toLowerCase().includes(av)));
}

const lines: string[] = [];
lines.push('# P-85 Schritt 2b — Trockenlauf Varianten-SKU/Preis-Zuordnung (echte Produktions-DB, nur lesend)');
lines.push('');
lines.push(`Erzeugt mit \`bun scripts/p85-variant-map-dryrun.ts\`. ${products.length} Produkte gesamt, ${withVariants.length} mit Varianten-Gruppen geprüft.`);
lines.push('');

let ok = 0;
let blocked = 0;

for (const p of withVariants) {
  const variants: VariantGroup[] = (() => {
    try { return JSON.parse(p.variants) as VariantGroup[]; } catch { return []; }
  })();
  const variantPrices: VariantPriceEntry[] = (() => {
    try { const parsed = JSON.parse(p.variantPrices ?? '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  })();

  const resolved = resolveVariantEntries(p.id, variants, variantPrices);
  const orphaned = findOrphanedVariantEntries(p.id, variants, variantPrices);
  const hasBlocker = resolved.some(r => r.error) || orphaned.length > 0;

  if (hasBlocker) blocked++; else ok++;

  lines.push(`## stele-${p.id} (${p.generatedTitle || p.title}) — ${hasBlocker ? '⚠️ BLOCKIERT' : '✅ eindeutig'}`);
  lines.push('');
  lines.push('| Anzeigewert(e) | ALTE Zuordnung (Substring) | NEUE Zuordnung (exakt) | Status |');
  lines.push('|---|---|---|---|');
  for (const r of resolved) {
    const label = Object.entries(r.displayValues).map(([k, v]) => `${k}=${v}`).join(', ');
    const oldMatches = variantPrices.filter(e => oldSubstringMatch(Object.values(r.displayValues), e.attrs));
    const oldLabel = oldMatches.length === 0
      ? '— (kein Treffer)'
      : oldMatches.length > 1
        ? `mehrdeutig (${oldMatches.length} Treffer, "erster gewinnt" wäre ${oldMatches[0].skuId ?? '?'})`
        : `${oldMatches[0].skuId ?? '?'} (EK ${oldMatches[0].price?.toFixed(2) ?? '—'}€)`;
    const newLabel = r.entry ? `${r.entry.skuId} (EK ${r.entry.price?.toFixed(2) ?? '—'}€)` : '—';
    const status = r.error ? `❌ ${r.error}` : '✅ ok';
    lines.push(`| ${label} | ${oldLabel} | ${newLabel} | ${status} |`);
  }
  if (orphaned.length > 0) {
    lines.push('');
    lines.push('**Verwaiste variantPrices-Einträge (passen auf keinen aktuellen Anzeigewert):**');
    for (const o of orphaned) lines.push(`- ${o}`);
  }
  lines.push('');
}

lines.push('## Zusammenfassung');
lines.push('');
lines.push(`**${ok} von ${withVariants.length} Produkten mit eindeutiger Varianten-Zuordnung.** ${blocked} blockiert (mehrdeutig, kein Treffer, kein EK oder verwaister Eintrag).`);
lines.push('');

const output = lines.join('\n');
console.log(output);
writeFileSync(outPath, output, 'utf-8');
console.log(`\nDatei geschrieben: ${outPath}`);
