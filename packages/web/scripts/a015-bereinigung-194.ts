// A-015 (Inhaber-Entscheid D, 04.10.2026) — Einmal-Skript: Dubletten in products.variantPrices von stele-194 bereinigen.
// STANDARD = TROCKENLAUF (liest nur, schreibt NICHTS). Erst `--apply` schreibt — und das darf erst nach erneutem Ja des Inhabers
// laufen. NUR Produkt 194 (214 ruht, wird nicht angefasst). Keine eBay-Zugriffe. Logik: src/shared/variant-dedupe.ts (rein, getestet).
//
// Aufruf (aus packages/web/): bun --env-file=../../.env scripts/a015-bereinigung-194.ts [--apply]
// Ausgabe: scripts/output/a015-bereinigung-194.md (und dieselbe Tabelle auf stdout)
import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import { and, eq } from 'drizzle-orm';
import { planVariantDedupe, renderDedupeMarkdown, type DedupeEntry } from '../src/shared/variant-dedupe';
import { resolveVariantEntries, type VariantGroup } from '../src/shared/variant-resolver';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const PRODUCT_ID = 194; // bewusst fest — andere Produkte (insbesondere 214) werden nicht angefasst
const apply = process.argv.includes('--apply');
const p = schema.products;

const [row] = await db.select({ id: p.id, variants: p.variants, variantPrices: p.variantPrices }).from(p).where(eq(p.id, PRODUCT_ID));
if (!row) { console.error(`stele-${PRODUCT_ID} nicht gefunden`); process.exit(1); }

const groups = JSON.parse(row.variants ?? '[]') as VariantGroup[];
const entries = JSON.parse(row.variantPrices ?? '[]') as DedupeEntry[];
const plan = planVariantDedupe(groups, entries);
const md = renderDedupeMarkdown(PRODUCT_ID, plan, entries.length, apply, new Date().toISOString());

mkdirSync(resolve(import.meta.dir, 'output'), { recursive: true });
writeFileSync(resolve(import.meta.dir, 'output', 'a015-bereinigung-194.md'), md);
console.log(md);

if (apply) {
  if (plan.changes.length === 0) { console.log('Nichts zu bereinigen — nichts geschrieben.'); process.exit(0); }
  // Sicherheitsnetz: nach der Bereinigung darf der ECHTE Resolver (wie beim Listing) keine "Mehrdeutig"-Fehler mehr melden — sonst abbrechen.
  const stillAmbiguous = resolveVariantEntries(PRODUCT_ID, groups, plan.newEntries as never).filter(r => r.error?.startsWith('Mehrdeutig'));
  if (stillAmbiguous.length > 0) {
    console.error('ABBRUCH: nach der Bereinigung wären noch ' + stillAmbiguous.length + ' Kombinationen mehrdeutig — nichts geschrieben.\n' + stillAmbiguous.map(r => r.error).join('\n'));
    process.exit(1);
  }
  // Optimistische Sperre: nur schreiben, wenn variantPrices seit dem Lesen unverändert ist (die Preisprüfung läuft parallel im 8-h-Cron).
  const res = await db.update(p)
    .set({ variantPrices: JSON.stringify(plan.newEntries), updatedAt: new Date().toISOString() })
    .where(and(eq(p.id, PRODUCT_ID), eq(p.variantPrices, row.variantPrices ?? '')));
  // Optimistische Sperre nicht gegriffen (variantPrices hat sich seit dem Lesen geändert, z. B. durch den 8-h-Cron) → NICHT als Erfolg melden.
  if ((res as { rowsAffected?: number }).rowsAffected !== 1) {
    console.error('NICHT GESCHRIEBEN: variantPrices hat sich seit dem Lesen geändert (rowsAffected=' + JSON.stringify((res as { rowsAffected?: number }).rowsAffected) + '). Trockenlauf wiederholen. Hinweis: nicht im 8-h-Fenster der Preisprüfung ausführen.');
    process.exit(1);
  }
  console.log('GESCHRIEBEN: 1 Zeile (stele-' + PRODUCT_ID + '). Danach Trockenlauf wiederholen — er muss "Kombinationen bereinigt: 0" melden.');
} else {
  console.log('TROCKENLAUF — nichts geschrieben. Mit --apply (nur nach Freigabe des Inhabers) schreiben.');
}
