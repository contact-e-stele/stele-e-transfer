// Einkaufspreis-Einfrieren — Altbestand-Backfill, SCHREIBT order_notes (frozenBuyPrice/
// frozenBuyPriceAt). Erst NACH Prüfung von freeze-buy-prices-preview.ts ausführen (Grundgesetz
// Regel 1 — Liste alt/neu VOR dem Einfrieren).
//
// Schreibt AUSSCHLIESSLICH order_notes. Rührt Produkte, Verkaufspreise, Zielmarge,
// Senkungsbremse oder die Preisüberwachung NICHT an (s. docs/superpowers/specs/
// 2026-09-18-einkaufspreis-einfrieren-design.md — Geltungsbereich).
//
// Schreibt NIE einen Platzhalter (null/0) — nur Bestellungen, für die computeAutoBuyPrice()
// einen echten Wert liefert, bekommen frozenBuyPrice gesetzt. Bestellungen mit manuellem
// Einkaufspreis (manualBuyPrice) werden übersprungen — der bleibt weiterhin die Quelle der
// Wahrheit, wird nicht durch einen automatisch berechneten Wert ersetzt. Bereits eingefrorene
// Bestellungen werden übersprungen (nie überschrieben).
//
// Aufruf (aus packages/web/): bun --env-file=<repo>/.env scripts/freeze-buy-prices-apply.ts

import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import { getAllOrders } from '../src/api/ebay';
import { buildProductLookups, findProductForSku, computeAutoBuyPrice } from '../src/api/order-matching';

console.log('Lade Bestellungen (eBay) + order_notes + Produkte (nur lesend, vor dem Schreiben)...\n');

const [orders, notes, products] = await Promise.all([
  getAllOrders(),
  db.select().from(schema.orderNotes).all(),
  db.select({
    id: schema.products.id,
    asin: schema.products.asin,
    buyPrice: schema.products.buyPrice,
    shipsFrom: schema.products.shipsFrom,
  }).from(schema.products).all(),
]);

const notesByOrderId = new Map(notes.map(n => [n.ebayOrderId, n]));
const lookups = buildProductLookups(products);
const findProduct = (sku: string | null) => findProductForSku(sku, lookups);

let frozen = 0, skippedManual = 0, skippedAlreadyFrozen = 0, skippedNichtBerechenbar = 0;

for (const order of orders) {
  const note = notesByOrderId.get(order.orderId);
  if (note?.manualBuyPrice != null) { skippedManual++; continue; }
  if (note?.frozenBuyPrice != null) { skippedAlreadyFrozen++; continue; }

  const wert = computeAutoBuyPrice(order.lineItems, findProduct);
  if (wert === null) { skippedNichtBerechenbar++; continue; }

  const now = new Date().toISOString();
  await db.insert(schema.orderNotes).values({
    ebayOrderId: order.orderId,
    frozenBuyPrice: wert,
    frozenBuyPriceAt: now,
  }).onConflictDoUpdate({
    target: schema.orderNotes.ebayOrderId,
    set: { frozenBuyPrice: wert, frozenBuyPriceAt: now },
  });
  console.log(`[freeze] ${order.orderId}: ${wert.toFixed(2)}€ eingefroren`);
  frozen++;
}

console.log(`\nFertig — eingefroren: ${frozen}, übersprungen (manuell): ${skippedManual}, übersprungen (schon eingefroren): ${skippedAlreadyFrozen}, nicht berechenbar: ${skippedNichtBerechenbar}.`);
