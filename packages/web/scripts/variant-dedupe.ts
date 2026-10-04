// Einmal-/Wiederholungs-Skript (A-015 für stele-194, A-023 verallgemeinert): Dubletten in products.variantPrices bereinigen.
// STANDARD = TROCKENLAUF (liest nur, schreibt NICHTS). Erst `--apply` schreibt — und das darf erst nach ausdrücklichem Ja des Inhabers
// für GENAU die genannten Produkt-IDs laufen. Keine eBay-Zugriffe. Logik: src/shared/variant-dedupe.ts (rein, getestet).
// stele-214 ruht (Inhaber) und wird nie angefasst.
//
// Aufruf (aus packages/web/): bun --env-file=../../.env scripts/variant-dedupe.ts --ids 119,194 [--apply]
//   --ids   Pflicht, kommagetrennte Produkt-IDs (kein "alle" — --apply gilt immer nur für ausdrücklich genannte IDs)
// Ausgabe: scripts/output/variant-dedupe-<id>.md (und dieselbe Tabelle auf stdout)
import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import { and, eq } from 'drizzle-orm';
import { planVariantDedupe, renderDedupeMarkdown, staleSellPriceNotes, type DedupeEntry } from '../src/shared/variant-dedupe';
import { resolveVariantEntries, type VariantGroup } from '../src/shared/variant-resolver';
import { parseVariantSellPrices } from '../src/shared/pricing';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const RUHT = new Set([214]);
const apply = process.argv.includes('--apply');
const idsArg = process.argv.find((a, i) => process.argv[i - 1] === '--ids') ?? '';
const ids = [...new Set(idsArg.split(',').map(s => parseInt(s.trim(), 10)).filter(n => Number.isInteger(n) && n > 0))];
const ungueltig = idsArg.split(',').map(s => s.trim()).filter(s => s !== '' && !/^[1-9]\d*$/.test(s));
if (ungueltig.length > 0) { console.error(`Ungültige Produkt-ID(s): ${ungueltig.join(', ')} — Abbruch (nichts gelesen/geschrieben).`); process.exit(1); }
if (ids.length === 0) { console.error('Aufruf: bun --env-file=../../.env scripts/variant-dedupe.ts --ids 119,194 [--apply]'); process.exit(1); }
const ruhend = ids.filter(i => RUHT.has(i));
if (ruhend.length > 0) { console.error(`stele-${ruhend.join(', stele-')} ruht (Inhaber) — nicht angefasst, Abbruch.`); process.exit(1); }
const p = schema.products;
mkdirSync(resolve(import.meta.dir, 'output'), { recursive: true });

let failed = false;
for (const id of ids) {
  const [row] = await db.select({ id: p.id, variants: p.variants, variantPrices: p.variantPrices, variantSellPrices: p.variantSellPrices }).from(p).where(eq(p.id, id));
  if (!row) { console.error(`stele-${id} nicht gefunden`); failed = true; continue; }

  const groups = JSON.parse(row.variants ?? '[]') as VariantGroup[];
  const entries = JSON.parse(row.variantPrices ?? '[]') as DedupeEntry[];
  const plan = planVariantDedupe(groups, entries);
  let md = renderDedupeMarkdown(id, plan, entries.length, apply, new Date().toISOString());
  const notes = staleSellPriceNotes(plan.changes, parseVariantSellPrices(row.variantSellPrices));
  md += '\n## Gespeicherte Verkaufspreise (variant_sell_prices), die nach der Bereinigung nicht mehr wirken\n' + (notes.length > 0 ? notes.map(n => `- ${n}`).join('\n') : '- keine') + '\n';
  writeFileSync(resolve(import.meta.dir, 'output', `variant-dedupe-${id}.md`), md);
  console.log(md);

  if (!apply) continue;
  if (plan.changes.length === 0) { console.log(`stele-${id}: Nichts zu bereinigen — nichts geschrieben.`); continue; }
  // Sicherheitsnetz: nach der Bereinigung darf der ECHTE Resolver (wie beim Listing) keine "Mehrdeutig"-Fehler mehr melden — sonst abbrechen.
  const stillAmbiguous = resolveVariantEntries(id, groups, plan.newEntries as never).filter(r => r.error?.startsWith('Mehrdeutig'));
  if (stillAmbiguous.length > 0) {
    console.error(`ABBRUCH stele-${id}: nach der Bereinigung wären noch ${stillAmbiguous.length} Kombinationen mehrdeutig — nichts geschrieben.\n` + stillAmbiguous.map(r => r.error).join('\n'));
    failed = true; continue;
  }
  // Optimistische Sperre: nur schreiben, wenn variantPrices seit dem Lesen unverändert ist (die Preisprüfung läuft parallel im 8-h-Cron).
  const res = await db.update(p)
    .set({ variantPrices: JSON.stringify(plan.newEntries), updatedAt: new Date().toISOString() })
    .where(and(eq(p.id, id), eq(p.variantPrices, row.variantPrices ?? '')));
  // Sperre nicht gegriffen → NICHT als Erfolg melden.
  if ((res as { rowsAffected?: number }).rowsAffected !== 1) {
    console.error(`NICHT GESCHRIEBEN stele-${id}: variantPrices hat sich seit dem Lesen geändert (rowsAffected=${JSON.stringify((res as { rowsAffected?: number }).rowsAffected)}). Trockenlauf wiederholen. Hinweis: nicht im 8-h-Fenster der Preisprüfung ausführen.`);
    failed = true; continue;
  }
  console.log(`GESCHRIEBEN: 1 Zeile (stele-${id}). Danach Trockenlauf wiederholen — er muss "Kombinationen bereinigt: 0" melden.`);
}
if (!apply) console.log('TROCKENLAUF — nichts geschrieben. Mit --apply (nur nach Freigabe des Inhabers, nur für die genannten IDs) schreiben.');
process.exit(failed ? 1 : 0);
