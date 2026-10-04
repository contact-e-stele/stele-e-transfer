// A-029 (P-E01) — NUR LESEN: welche Produkte würde der Import-Vorschlag als "Elektro?" markieren? Bestandsprodukte tragen keinen Vorschlag (kein Backfill,
// Live-Angebote werden nicht angefasst) — dieser Bericht zeigt dem Inhaber, wo er selbst nachsehen sollte. Schreibt NICHTS (nur SELECT).
// Läuft auch VOR dem Deploy der Migration (liest nur bereits vorhandene Spalten).
// Aufruf (aus packages/web/): bun --env-file=../../.env scripts/electric-report.ts
import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import { suggestElectric } from '../src/shared/electric';

const p = schema.products;
const rows = await db.select({ id: p.id, status: p.ebayStatus, title: p.generatedTitle, orig: p.title, description: p.description, specs: p.specs }).from(p);
let hits = 0;
console.log('| Produkt | eBay-Status | Treffer-Wörter | Titel |\n|---|---|---|---|');
for (const r of rows) {
  let specs: string[] = [];
  try { specs = Object.entries(JSON.parse(r.specs ?? '{}') as Record<string, string>).map(([k, v]) => `${k} ${v}`); } catch { /* ohne Merkmale */ }
  const s = suggestElectric([r.title, r.orig, r.description, ...specs]);
  if (!s.suggested) continue;
  hits++;
  console.log(`| stele-${r.id} | ${r.status ?? 'none'} | ${s.matches.join(', ')} | ${String(r.title).slice(0, 70)} |`);
}
console.log(`\n${hits} von ${rows.length} Produkten mit Elektro-Treffer (Vorschlag, kein Urteil). Nichts geschrieben.`);
