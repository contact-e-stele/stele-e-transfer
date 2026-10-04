// A-027 — Abgleich: App führt ebayStatus='listed', bei eBay ist das Listing aber beendet. STANDARD = TROCKENLAUF (nur lesen: DB-SELECT und
// eBay GetItem, nur GET — nichts wird bei eBay verändert, nichts in der DB geschrieben). Erst `--apply` schreibt, und das darf erst nach
// ausdrücklichem Ja des Inhabers laufen: für bei eBay BEENDETE Listings ebayStatus='none' (+ ebayError=null), ebayListingId bleibt als Historie.
// Logik: src/shared/listing-status-abgleich.ts (rein, getestet).
//
// Aufruf (aus packages/web/): bun --env-file=../../.env scripts/listing-status-abgleich.ts [--apply]
// Ausgabe: scripts/output/listing-status-abgleich.md (und dieselbe Tabelle auf stdout)
import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import { and, eq } from 'drizzle-orm';
import { getItemStatusXml } from '../src/api/ebay';
import { parseGetItemStatus, planListingStatusAbgleich, patchForEnded, renderAbgleichMarkdown, type ItemStatusInfo } from '../src/shared/listing-status-abgleich';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const apply = process.argv.includes('--apply');
const p = schema.products;
const rows = await db.select({ id: p.id, title: p.title, generatedTitle: p.generatedTitle, ebayStatus: p.ebayStatus, ebayListingId: p.ebayListingId })
  .from(p).where(eq(p.ebayStatus, 'listed'));
const products = rows.map(r => ({ id: r.id, title: r.generatedTitle || r.title, ebayStatus: r.ebayStatus, ebayListingId: r.ebayListingId }));

const infos = new Map<string, ItemStatusInfo>();
for (const pr of products) {
  if (!pr.ebayListingId || infos.has(pr.ebayListingId)) continue;
  try {
    const r = await getItemStatusXml(pr.ebayListingId);
    infos.set(pr.ebayListingId, parseGetItemStatus(r.xml, r.httpStatus));
  } catch (e) {
    console.error(`GetItem ${pr.ebayListingId} (stele-${pr.id}) fehlgeschlagen: ${String(e)}`);
  }
  await new Promise(r => setTimeout(r, 300)); // eBay-Rate-Limit schonen
}

const plan = planListingStatusAbgleich(products, infos);
const md = renderAbgleichMarkdown(plan, products.length, apply, new Date().toISOString());
mkdirSync(resolve(import.meta.dir, 'output'), { recursive: true });
writeFileSync(resolve(import.meta.dir, 'output', 'listing-status-abgleich.md'), md);
console.log(md);

if (!apply) { console.log('TROCKENLAUF — nichts geschrieben. Mit --apply (nur nach Freigabe des Inhabers) werden die beendeten Listings in der App auf "nicht gelistet" gesetzt.'); process.exit(0); }

let written = 0; let failed = false;
for (const r of plan.filter(x => x.action === 'mark_ended')) {
  // Optimistische Bedingung: nur wenn das Produkt noch 'listed' mit DERSELBEN Listing-ID ist (zwischenzeitlich neu gelistet → nicht anfassen).
  const res = await db.update(p).set({ ...patchForEnded(), updatedAt: new Date().toISOString() })
    .where(and(eq(p.id, r.productId), eq(p.ebayStatus, 'listed'), eq(p.ebayListingId, r.listingId!)));
  const n = (res as { rowsAffected?: number }).rowsAffected;
  if (n === 1) { written++; console.log(`GESCHRIEBEN stele-${r.productId} (${r.listingId}): ebayStatus 'none'`); }
  else { failed = true; console.error(`NICHT GESCHRIEBEN stele-${r.productId} (${r.listingId}): rowsAffected=${JSON.stringify(n)} (Status/ID hat sich geändert)`); }
}
console.log(`APPLY fertig: ${written} Produkt(e) auf 'none' gesetzt.`);
process.exit(failed ? 1 : 0);
