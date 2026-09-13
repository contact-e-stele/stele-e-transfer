// GPSR Schritt 1 — Schreib-Skript: überträgt die von parseGpsrRaw() erkannten Werte in die
// Einzelfelder (gpsr_name, gpsr_address, gpsr_city, gpsr_email, gpsr_phone).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// SCHALTER STANDARDMÄSSIG AUS. Dieses Skript schreibt NICHTS, solange GPSR_APPLY_ENABLED unten
// `false` ist — es läuft dann nur im Trockenlauf (Dry-Run) und zeigt, was geschrieben WÜRDE.
// Wird in diesem PR NICHT ausgeführt (weder Dry-Run noch echt) — reine Bereitstellung für einen
// späteren, vom Nutzer freizugebenden Schritt, NACHDEM der Bericht (gpsr-parse-report.ts)
// manuell geprüft wurde.
// ═══════════════════════════════════════════════════════════════════════════════════════════
const GPSR_APPLY_ENABLED = false;

// Standardmäßig werden NUR "vollständig" erkannte Datensätze geschrieben (alle 5 Felder sicher
// erkannt). "teilweise" erkannte Datensätze NIE automatisch schreiben, auch wenn der Schalter
// an ist — die fehlenden Felder blieben sonst leer/inkonsistent, ohne dass das sichtbar wäre.
const ONLY_VOLLSTAENDIG = true;

import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { parseGpsrRaw } from '../src/shared/gpsr-parser';

const products = await db.select({
  id: schema.products.id,
  gpsrRaw: schema.products.gpsrRaw,
}).from(schema.products).orderBy(schema.products.id);

let wouldWrite = 0;
let skipped = 0;

for (const p of products) {
  const parsed = parseGpsrRaw(p.gpsrRaw);
  const eligible = parsed.confidence === 'vollstaendig' || (!ONLY_VOLLSTAENDIG && parsed.confidence === 'teilweise');

  if (!eligible) {
    skipped++;
    continue;
  }

  wouldWrite++;
  const action = GPSR_APPLY_ENABLED ? 'SCHREIBE' : 'WÜRDE SCHREIBEN (Dry-Run)';
  console.log(`stele-${p.id}: ${action} — Name="${parsed.name}" Adresse="${parsed.address}" Stadt="${parsed.city}" E-Mail="${parsed.email}" Telefon="${parsed.phone}"`);

  if (GPSR_APPLY_ENABLED) {
    await db.update(schema.products).set({
      gpsrName: parsed.name,
      gpsrAddress: parsed.address,
      gpsrCity: parsed.city,
      gpsrEmail: parsed.email,
      gpsrPhone: parsed.phone,
      // gpsr_raw bleibt unverändert — bleibt als Quelle erhalten.
    }).where(eq(schema.products.id, p.id));
  }
}

console.log(`\n${GPSR_APPLY_ENABLED ? 'Geschrieben' : 'Würde schreiben (Dry-Run, GPSR_APPLY_ENABLED=false)'}: ${wouldWrite}`);
console.log(`Übersprungen (nicht vollständig erkannt): ${skipped}`);
if (!GPSR_APPLY_ENABLED) {
  console.log('\nSCHALTER IST AUS — nichts wurde in die DB geschrieben. Zum Aktivieren: GPSR_APPLY_ENABLED oben auf true setzen, erst nachdem der Bericht (gpsr-parse-report.ts) manuell geprüft wurde.');
}
