// Einkaufspreis-Einfrieren — VORSCHAU vor dem Altbestand-Backfill (Grundgesetz Regel 1: Liste
// alt/neu VOR dem Schreiben, s. docs/superpowers/specs/2026-09-18-einkaufspreis-einfrieren-design.md).
//
// NUR LESEND — kein db.insert()/update(). Zeigt für jede Bestellung ohne frozenBuyPrice:
//   - "neu"  = order_notes-Zeile existiert noch nicht bzw. invoiceGeneratedAt ist NICHT gesetzt
//              → wird ab diesem PR automatisch beim nächsten /ebay/orders-Aufruf eingefroren,
//              kein manueller Schritt nötig.
//   - "alt"  = invoiceGeneratedAt ist bereits gesetzt (die App kannte diese Bestellung schon vor
//              diesem Fix) → wird NUR eingefroren, wenn freeze-buy-prices-apply.ts danach explizit
//              ausgeführt wird.
// Bestellungen, für die computeAutoBuyPrice() null liefert (Produkt fehlt/kein buyPrice bekannt),
// werden als "nicht berechenbar" ausgewiesen — bleiben offen für manualBuyPrice.
//
// Aufruf (aus packages/web/): bun --env-file=<repo>/.env scripts/freeze-buy-prices-preview.ts

import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import { getAllOrders } from '../src/api/ebay';
import { buildProductLookups, findProductForSku, computeAutoBuyPrice } from '../src/api/order-matching';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const outDir = resolve(import.meta.dir, 'output');
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, 'freeze-buy-prices-preview.md');

console.log('Lade Bestellungen (eBay) + order_notes + Produkte (nur lesend)...\n');

try {
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

  const lines: string[] = [];
  lines.push('# Einkaufspreis-Einfrieren — Vorschau (echte eBay-/DB-Daten, nur lesend)');
  lines.push('');
  lines.push(`Erzeugt mit \`bun --env-file=<repo>/.env scripts/freeze-buy-prices-preview.ts\`.`);
  lines.push('');
  lines.push('| Bestellung | Alt/Neu | manuell? | bereits eingefroren? | würde eingefroren als |');
  lines.push('|---|---|---|---|---|');

  let neuCount = 0, altCount = 0, nichtBerechenbar = 0, bereitsEingefroren = 0;

  for (const order of orders) {
    const note = notesByOrderId.get(order.orderId);
    const altNeu = note?.invoiceGeneratedAt ? 'alt' : 'neu';
    if (altNeu === 'alt') altCount++; else neuCount++;

    const hatManuell = note?.manualBuyPrice != null;
    const hatFrozen = note?.frozenBuyPrice != null;
    if (hatFrozen) bereitsEingefroren++;

    const wert = computeAutoBuyPrice(order.lineItems, findProduct);
    if (wert === null && !hatManuell && !hatFrozen) nichtBerechenbar++;

    const wertText = hatFrozen
      ? `— (schon eingefroren: ${note!.frozenBuyPrice!.toFixed(2)}€)`
      : hatManuell
        ? '— (manuell gesetzt, wird nie automatisch eingefroren)'
        : wert !== null
          ? `${wert.toFixed(2)}€`
          : '— nicht berechenbar (Produkt fehlt/kein Einkaufspreis) —';

    lines.push(`| ${order.orderId} | ${altNeu} | ${hatManuell ? 'ja' : 'nein'} | ${hatFrozen ? 'ja' : 'nein'} | ${wertText} |`);
  }

  lines.push('');
  lines.push(`**Zusammenfassung:** ${orders.length} Bestellungen gesamt — ${neuCount} neu (werden automatisch eingefroren), ${altCount} alt (brauchen \`freeze-buy-prices-apply.ts\`), ${bereitsEingefroren} bereits eingefroren, ${nichtBerechenbar} nicht berechenbar (Produkt fehlt).`);

  console.log(lines.join('\n'));
  writeFileSync(outPath, lines.join('\n'), 'utf-8');
  console.log(`\nDatei geschrieben: ${outPath}`);
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error('Abruf fehlgeschlagen:', msg);
  process.exit(1);
}
