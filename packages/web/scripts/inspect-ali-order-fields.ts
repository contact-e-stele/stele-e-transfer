// P2-Korrektur — Aufgabe 1: volle, ungefilterte Feldliste einer echten
// aliexpress.trade.ds.order.get-Antwort ausgeben (nicht nur die von getAliOrderTracking()
// bereits ausgewählten Felder) — gesucht: das Feld mit der Zusteller-Nummer (DHL) und dem
// Zusteller-Namen, als Ersatz für logistics_no (das ist nachweislich AliExpress' EIGENE interne
// Sendungs-ID, nicht die DHL-Nummer, s. aliexpress-api.ts-Kommentar).
//
// SCHREIBT NICHTS — reiner Lesezugriff gegen die echte AliExpress-API.
//
// Aufruf (aus packages/web/): bun --env-file=<repo>/.env scripts/inspect-ali-order-fields.ts [aliOrderId...]
// Ohne Argumente: beide im Auftrag genannten Bestellungen.

import { ensureFreshAliToken, getAliAccessToken, getAliOrderRaw } from '../src/api/aliexpress-api';

const ids = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['3076306514497211', '3075188992327211'];

await ensureFreshAliToken();
const accessToken = await getAliAccessToken();
if (!accessToken) {
  console.error('Kein AliExpress-Access-Token verfügbar — Abbruch.');
  process.exit(1);
}

for (const id of ids) {
  console.log(`\n================ Bestellung ${id} ================`);
  const raw = await getAliOrderRaw(id, accessToken);
  if (!raw) {
    console.log('Abruf fehlgeschlagen — siehe Fehlermeldung oben.');
    continue;
  }
  console.log('--- volles result-Objekt (Top-Level-Felder) ---');
  console.log(Object.keys(raw).sort().join(', '));

  const logisticsList = (raw.logistics_info_list as { aeop_order_logistics_info?: Array<Record<string, unknown>> } | undefined)?.aeop_order_logistics_info ?? [];
  console.log(`\n--- logistics_info_list.aeop_order_logistics_info[] (${logisticsList.length} Einträge) ---`);
  logisticsList.forEach((entry, i) => {
    console.log(`  Eintrag ${i}:`);
    for (const [k, v] of Object.entries(entry)) {
      console.log(`    ${k}: ${JSON.stringify(v)}`);
    }
  });

  console.log('\n--- komplettes rohes JSON (für sonst nicht erfasste Felder) ---');
  console.log(JSON.stringify(raw, null, 2));
}

console.log('\nReiner Lesezugriff — es wurde NICHTS geschrieben.');
