// A-038 Punkt 5 — Bericht NUR LESEN: order_notes, bei denen tracking_number == aliexpress_order_id (eigene) ODER == aliexpress_order_id einer
// anderen Bestellung ist. Logik in shared/tracking-guard.ts (findAliAsTrackingNotes). Käufer nur Vorname + Initial (aus eBay-Bestellung, nur lesen);
// ist eBay nicht erreichbar, steht "(eBay nicht erreichbar)". Schreibt NICHTS (keine DB, kein eBay-Schreibaufruf).
// Aufruf (aus packages/web/): bun --env-file=../../.env scripts/a038-ali-as-tracking-report.ts
import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import { findAliAsTrackingNotes } from '../src/shared/tracking-guard';
import { getAllOrders, type EbayOrder } from '../src/api/ebay';

const notes = await db.select().from(schema.orderNotes).all();
const findings = findAliAsTrackingNotes(notes);

let orders = new Map<string, EbayOrder>();
let ebayNote = '';
try { orders = new Map((await getAllOrders()).map(o => [o.orderId, o])); } catch (e) { ebayNote = `(eBay nicht erreichbar: ${String(e).slice(0, 120)})`; }
const shortName = (full?: string) => {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return ebayNote ? '(eBay nicht erreichbar)' : '(Bestellung nicht in eBay-Liste)';
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1][0]}.`;
};

console.log(`# A-038 Bericht (nur lesen) — Lauf ${new Date().toISOString()}`);
console.log(`order_notes gesamt: ${notes.length}; mit Sendungsnummer: ${notes.filter(n => n.trackingNumber?.trim()).length}; Funde: ${findings.length}`);
console.log('');
console.log('| eBay-Bestellnr. | Käufer | Datum | Nummer | Art | tracking_ebay_submitted |');
console.log('|---|---|---|---|---|---|');
for (const f of findings) {
  const o = orders.get(f.ebayOrderId);
  console.log(`| ${f.ebayOrderId} | ${shortName(o?.shippingAddress?.fullName)} | ${(o?.orderDate ?? f.createdAt ?? '').slice(0, 10)} | ${f.trackingNumber} | ${f.kind} | ${f.trackingEbaySubmitted === null ? 'NULL' : f.trackingEbaySubmitted} |`);
}
if (ebayNote) console.log(`\n${ebayNote}`);
