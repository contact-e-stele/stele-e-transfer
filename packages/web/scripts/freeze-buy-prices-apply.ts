// Einkaufspreis-Einfrieren — Altbestand-Backfill, SCHREIBT order_notes (frozenBuyPrice/
// frozenBuyPriceAt). Erst NACH Prüfung von freeze-buy-prices-preview.ts ausführen (Grundgesetz
// Regel 1 — Liste alt/neu VOR dem Einfrieren).
//
// Nutzer-Korrektur 19.09.2026: schreibt AUSSCHLIESSLICH den echten, von AliExpress selbst
// ausgewiesenen Betrag (order_amount.amount, über fetchAliOrderTotal() — s. aliexpress-api.ts).
// NIE eine aus der lokalen Produkt-DB rekonstruierte Schätzung (computeAutoBuyPrice) — die ist
// nachweislich falsch (Live-Fund: 0,87-0,89€ Lücke zwischen Einzelposten-Summe und tatsächlich
// gezahltem Betrag, vermutlich Gutscheine/einmalig erlassene Zollkosten).
//
// Schreibt AUSSCHLIESSLICH order_notes. Rührt Produkte, Verkaufspreise, Zielmarge,
// Senkungsbremse oder die Preisüberwachung NICHT an (s. docs/superpowers/specs/
// 2026-09-18-einkaufspreis-einfrieren-design.md — Geltungsbereich).
//
// Bestellungen OHNE aliexpressOrderId werden übersprungen — es gibt nichts Echtes zum Einfrieren.
// Bestellungen mit manuellem Einkaufspreis (manualBuyPrice) werden übersprungen — der bleibt
// weiterhin die Quelle der Wahrheit. Bereits eingefrorene Bestellungen werden übersprungen (nie
// überschrieben).
//
// Aufruf (aus packages/web/): bun --env-file=<repo>/.env scripts/freeze-buy-prices-apply.ts

import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import { getAllOrders } from '../src/api/ebay';
import { getAliAccessToken, fetchAliOrderTotal } from '../src/api/aliexpress-api';

console.log('Lade Bestellungen (eBay) + order_notes (nur lesend, vor dem Schreiben)...\n');

const [orders, notes, aliToken] = await Promise.all([
  getAllOrders(),
  db.select().from(schema.orderNotes).all(),
  getAliAccessToken(),
]);

if (!aliToken) {
  console.error('Kein AliExpress-Token verfügbar — Abbruch, nichts geschrieben.');
  process.exit(1);
}

const notesByOrderId = new Map(notes.map(n => [n.ebayOrderId, n]));

let frozen = 0, skippedManual = 0, skippedAlreadyFrozen = 0, skippedKeineAliNr = 0, skippedAbrufFehlgeschlagen = 0;

for (const order of orders) {
  const note = notesByOrderId.get(order.orderId);
  if (note?.manualBuyPrice != null) { skippedManual++; continue; }
  if (note?.frozenBuyPrice != null) { skippedAlreadyFrozen++; continue; }
  if (!note?.aliexpressOrderId) { skippedKeineAliNr++; continue; }

  const wert = await fetchAliOrderTotal(note.aliexpressOrderId, aliToken);
  if (wert === null) { skippedAbrufFehlgeschlagen++; continue; }

  const now = new Date().toISOString();
  await db.insert(schema.orderNotes).values({
    ebayOrderId: order.orderId,
    frozenBuyPrice: wert,
    frozenBuyPriceAt: now,
  }).onConflictDoUpdate({
    target: schema.orderNotes.ebayOrderId,
    set: { frozenBuyPrice: wert, frozenBuyPriceAt: now },
  });
  console.log(`[freeze] ${order.orderId} (AliExpress ${note.aliexpressOrderId}): ${wert.toFixed(2)}€ eingefroren (echter Betrag)`);
  frozen++;
}

console.log(`\nFertig — eingefroren: ${frozen}, übersprungen (manuell): ${skippedManual}, übersprungen (schon eingefroren): ${skippedAlreadyFrozen}, übersprungen (keine AliExpress-Nr.): ${skippedKeineAliNr}, Abruf fehlgeschlagen: ${skippedAbrufFehlgeschlagen}.`);
