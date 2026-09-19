// Einkaufspreis-Einfrieren — VORSCHAU vor dem Altbestand-Backfill (Grundgesetz Regel 1: Liste
// alt/neu VOR dem Schreiben, s. docs/superpowers/specs/2026-09-18-einkaufspreis-einfrieren-design.md).
//
// Nutzer-Korrektur 19.09.2026: NUR der echte AliExpress-Betrag (order_amount.amount) darf
// eingefroren werden. Eine aus der lokalen Produkt-DB rekonstruierte Schätzung ist nachweislich
// falsch (Live-Fund: 0,87-0,89€ Lücke bei geprüften Bestellungen — vermutlich Gutscheine/einmalig
// erlassene Zollkosten, in keinem Einzelfeld sichtbar) und darf höchstens als klar markierte
// Anzeige erscheinen, NIE gespeichert werden.
//
// NUR LESEND — kein db.insert()/update(). Zeigt für jede Bestellung ohne frozenBuyPrice:
//   - "neu"  = order_notes-Zeile existiert noch nicht bzw. invoiceGeneratedAt ist NICHT gesetzt
//   - "alt"  = invoiceGeneratedAt ist bereits gesetzt (die App kannte diese Bestellung schon vor
//              diesem Fix)
// Pro Bestellung:
//   - hat sie eine aliexpressOrderId → echter AliExpress-Betrag wird abgerufen und als "würde
//     eingefroren als" gezeigt (das IST der Wert, den freeze-buy-prices-apply.ts schreiben würde).
//   - hat sie KEINE aliexpressOrderId → keine Freeze-Möglichkeit; die lokale DB-Schätzung wird nur
//     zur Einordnung mit angezeigt, ausdrücklich als "geschätzt, wird NIE eingefroren" markiert.
//
// Aufruf (aus packages/web/): bun --env-file=<repo>/.env scripts/freeze-buy-prices-preview.ts

import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import { getAllOrders } from '../src/api/ebay';
import { getAliAccessToken, fetchAliOrderTotal } from '../src/api/aliexpress-api';
import { buildProductLookups, findProductForSku, computeAutoBuyPrice } from '../src/api/order-matching';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const outDir = resolve(import.meta.dir, 'output');
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, 'freeze-buy-prices-preview.md');

console.log('Lade Bestellungen (eBay) + order_notes + Produkte (nur lesend)...\n');

try {
  const [orders, notes, products, aliToken] = await Promise.all([
    getAllOrders(),
    db.select().from(schema.orderNotes).all(),
    db.select({
      id: schema.products.id,
      asin: schema.products.asin,
      buyPrice: schema.products.buyPrice,
      shipsFrom: schema.products.shipsFrom,
    }).from(schema.products).all(),
    getAliAccessToken(),
  ]);

  const notesByOrderId = new Map(notes.map(n => [n.ebayOrderId, n]));
  const lookups = buildProductLookups(products);
  const findProduct = (sku: string | null) => findProductForSku(sku, lookups);

  const lines: string[] = [];
  lines.push('# Einkaufspreis-Einfrieren — Vorschau (echte eBay-/AliExpress-/DB-Daten, nur lesend)');
  lines.push('');
  lines.push(`Erzeugt mit \`bun --env-file=<repo>/.env scripts/freeze-buy-prices-preview.ts\`.`);
  lines.push('');
  lines.push('| Bestellung | AliExpress-Nr. | Alt/Neu | manuell? | bereits eingefroren? | würde eingefroren als (echter Betrag) | Schätzung (nur Anzeige, NIE eingefroren) |');
  lines.push('|---|---|---|---|---|---|---|');

  let neuCount = 0, altCount = 0, bereitsEingefroren = 0, wuerdeEingefroren = 0, keineAliNr = 0;

  for (const order of orders) {
    const note = notesByOrderId.get(order.orderId);
    const altNeu = note?.invoiceGeneratedAt ? 'alt' : 'neu';
    if (altNeu === 'alt') altCount++; else neuCount++;

    const hatManuell = note?.manualBuyPrice != null;
    const hatFrozen = note?.frozenBuyPrice != null;
    if (hatFrozen) bereitsEingefroren++;

    const geschaetzt = computeAutoBuyPrice(order.lineItems, findProduct);
    const schaetzungText = geschaetzt !== null ? `${geschaetzt.toFixed(2)}€ (geschätzt)` : '—';

    let echterBetragText: string;
    if (hatFrozen) {
      echterBetragText = `— (schon eingefroren: ${note!.frozenBuyPrice!.toFixed(2)}€)`;
    } else if (hatManuell) {
      echterBetragText = '— (manuell gesetzt, wird nie automatisch eingefroren)';
    } else if (!note?.aliexpressOrderId) {
      echterBetragText = '— keine AliExpress-Bestellnummer hinterlegt, kein Freeze möglich —';
      keineAliNr++;
    } else if (!aliToken) {
      echterBetragText = '— AliExpress-Token nicht verfügbar, Abruf übersprungen —';
    } else {
      const real = await fetchAliOrderTotal(note.aliexpressOrderId, aliToken);
      if (real !== null) {
        echterBetragText = `${real.toFixed(2)}€`;
        wuerdeEingefroren++;
      } else {
        echterBetragText = '— AliExpress-Abruf fehlgeschlagen/kein order_amount —';
      }
    }

    lines.push(`| ${order.orderId} | ${note?.aliexpressOrderId ?? '—'} | ${altNeu} | ${hatManuell ? 'ja' : 'nein'} | ${hatFrozen ? 'ja' : 'nein'} | ${echterBetragText} | ${schaetzungText} |`);
  }

  lines.push('');
  lines.push(`**Zusammenfassung:** ${orders.length} Bestellungen gesamt — ${neuCount} neu, ${altCount} alt, ${bereitsEingefroren} bereits eingefroren, ${wuerdeEingefroren} würden mit \`freeze-buy-prices-apply.ts\` jetzt einen echten Betrag eingefroren bekommen, ${keineAliNr} ohne AliExpress-Bestellnummer (kein Freeze möglich, nur Schätzung als Anzeige).`);

  console.log(lines.join('\n'));
  writeFileSync(outPath, lines.join('\n'), 'utf-8');
  console.log(`\nDatei geschrieben: ${outPath}`);
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error('Abruf fehlgeschlagen:', msg);
  process.exit(1);
}
