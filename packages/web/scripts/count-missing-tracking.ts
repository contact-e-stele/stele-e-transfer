// Aufgabe 7: wie viele Bestellungen in der DB haben eine AliExpress-Bestellnr. ohne Sendungsnummer?
// NUR LESEND.
//
// Aufruf (aus packages/web/): bun --env-file=<repo>/.env scripts/count-missing-tracking.ts

import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import { and, isNotNull } from 'drizzle-orm';

const withAliId = await db.select({
  ebayOrderId: schema.orderNotes.ebayOrderId,
  aliexpressOrderId: schema.orderNotes.aliexpressOrderId,
  trackingNumber: schema.orderNotes.trackingNumber,
  shippedAt: schema.orderNotes.shippedAt,
  createdAt: schema.orderNotes.createdAt,
}).from(schema.orderNotes).where(and(isNotNull(schema.orderNotes.aliexpressOrderId)));

const withAliIdNonEmpty = withAliId.filter(r => r.aliexpressOrderId?.trim());
const withoutTracking = withAliIdNonEmpty.filter(r => !r.trackingNumber?.trim());

console.log(`Bestellungen mit AliExpress-Bestellnr. gesamt: ${withAliIdNonEmpty.length}`);
console.log(`davon OHNE Sendungsnummer: ${withoutTracking.length}\n`);
for (const r of withoutTracking) {
  console.log(`  eBay=${r.ebayOrderId} AliExpress=${r.aliexpressOrderId} shippedAt=${r.shippedAt ?? '–'} createdAt=${r.createdAt}`);
}
