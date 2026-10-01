// A-008 Teil 2 — Einmal-Skript: füllt products.gpsr_mfr_* aus gpsr_raw (Parser), NUR leere Felder.
// Standard = Dry-Run (schreibt NICHTS). Erst `--apply` schreibt. Vorher muss die Migration (neue Spalten)
// auf der Ziel-DB gelaufen sein (läuft beim Serverstart, src/db/migrate.ts).
//
// Aufruf (aus packages/web/): bun --env-file=<repo>/.env scripts/gpsr-mfr-backfill.ts [--apply]
// Ausgabe: scripts/output/gpsr-mfr-backfill.md

import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import { and, eq, isNull, or } from 'drizzle-orm';
import { planMfrBackfill } from '../src/shared/gpsr-parser';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const apply = process.argv.includes('--apply');
const p = schema.products;
const rows = await db.select({
  id: p.id, gpsrRaw: p.gpsrRaw,
  gpsrMfrName: p.gpsrMfrName, gpsrMfrAddress: p.gpsrMfrAddress, gpsrMfrCity: p.gpsrMfrCity,
  gpsrMfrCountry: p.gpsrMfrCountry, gpsrMfrEmail: p.gpsrMfrEmail, gpsrMfrPhone: p.gpsrMfrPhone, gpsrMfrUrl: p.gpsrMfrUrl,
}).from(p).orderBy(p.id);

const lines: string[] = [`# A-008 Hersteller-Backfill — ${apply ? 'APPLY (geschrieben)' : 'DRY-RUN (nichts geschrieben)'}`, '', `Lauf: ${new Date().toISOString()}`, ''];
lines.push('| Produkt | gesetzte Felder |', '|---|---|');
const writes: Array<{ id: number; plan: Record<string, string> }> = [];
for (const r of rows) {
  const plan = planMfrBackfill(r, r.gpsrRaw) as Record<string, string>;
  const keys = Object.keys(plan);
  if (keys.length === 0) continue;
  lines.push(`| ${r.id} | ${keys.map(k => `${k}=${plan[k]}`).join('; ').replaceAll('|', '/')} |`);
  writes.push({ id: r.id, plan });
}
lines.push('', `Produkte gesamt: ${rows.length}; mit Änderung: ${writes.length}; ${apply ? 'geschrieben' : 'würde schreiben'}: ${writes.length}`);

if (apply) {
  // Eine Transaktion; je Feld zusätzlich "in der DB (noch) leer" im WHERE — ein zwischenzeitlich (Import/Hand)
  // gesetztes Feld wird nie überschrieben, auch wenn der Plan auf einem älteren Lesezustand beruht.
  await db.transaction(async tx => {
    for (const w of writes) {
      for (const [key, value] of Object.entries(w.plan)) {
        const col = (p as unknown as Record<string, typeof p.gpsrMfrName>)[key];
        await tx.update(p).set({ [key]: value }).where(and(eq(p.id, w.id), or(isNull(col), eq(col, ''))));
      }
    }
  });
}

const outDir = resolve(import.meta.dir, 'output');
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'gpsr-mfr-backfill.md'), lines.join('\n'), 'utf-8');
console.log(lines.join('\n'));
