// P-82 — Aufgabe 7: Trockenlauf. Zeigt für ein bestehendes Produkt aus der ECHTEN Produktions-DB,
// welche Offer-Payload-Felder mit Kategorie an eBay gingen — OHNE den eBay-Call auszuführen.
//
// Nutzt buildStoreCategoryBlock() — DIESELBE Funktion, die createOffer()/listOnEbayWithVariants()
// (ebay.ts) tatsächlich für den storeCategoryNames-Teil des Payloads verwenden (Grundgesetz
// Regel 8, keine Nachbau-Logik). Die übrigen Offer-Felder (Policies, Artikelmerkmale) hängen von
// zusätzlichen eBay-Calls ab (getBusinessPolicies, buildAspects) — die bleiben hier bewusst als
// Platzhalter markiert, da sie nicht Gegenstand dieses PRs sind und in dieser Sandbox ohnehin
// nicht live abrufbar wären (kein eBay-Zugriff, s. scripts/fetch-store-categories.ts).
//
// SCHREIBT NICHTS — kein db.update(), kein eBay-Call.
//
// Aufruf (aus packages/web/): bun --env-file=<repo>/.env scripts/preview-offer-with-category.ts [productId]

import { buildStoreCategoryBlock } from '../src/api/ebay';
import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

function buildPreviewOfferBody(product: { id: number; generatedTitle: string; title: string; sellPrice: number | null; ebayCategory: string | null; storeCategoryName: string | null }) {
  return {
    sku: `stele-${product.id}`,
    marketplaceId: 'EBAY_DE',
    format: 'FIXED_PRICE',
    availableQuantity: 3,
    categoryId: product.ebayCategory ?? '79720',
    listingDescription: '(gekürzt für die Vorschau — echte HTML-Beschreibung wird beim Listen verwendet)',
    pricingSummary: {
      price: { value: (product.sellPrice ?? 0).toFixed(2), currency: 'EUR' },
    },
    merchantLocationKey: 'default',
    listingPolicies: '(aus getBusinessPolicies() — echter eBay-Call, hier nicht ausgeführt)',
    itemSpecifics: '(aus buildAspects() — echter eBay-Call, hier nicht ausgeführt)',
    productSafety: '(GPSR-Block — reine Produktdaten, kein eBay-Call, hier der Übersichtlichkeit halber weggelassen)',
    // Das ist die tatsächliche, in Produktion verwendete Funktion (ebay.ts) — kein Nachbau.
    ...buildStoreCategoryBlock(product.storeCategoryName ?? undefined),
  };
}

const requestedId = process.argv[2] ? Number(process.argv[2]) : undefined;

console.log('Lade ein reales Produkt aus der echten Produktions-DB (nur lesend)...\n');

const product = requestedId
  ? await db.select().from(schema.products).where(eq(schema.products.id, requestedId)).get()
  : await db.select().from(schema.products).limit(1).get();

if (!product) {
  console.error('Kein Produkt gefunden.');
  process.exit(1);
}

const lines: string[] = [];
lines.push('# P-82: Trockenlauf — Offer-Payload mit Kategorie (ohne echten eBay-Call)');
lines.push('');
lines.push(`Reales Produkt aus der Produktions-DB: **stele-${product.id}** — "${(product.generatedTitle ?? product.title).slice(0, 60)}"`);
lines.push(`\`storeCategoryName\` aktuell in der DB: ${product.storeCategoryName ? `\`${product.storeCategoryName}\`` : '_(keine — neue Spalte, noch nicht befüllt)_'}`);
lines.push('');

lines.push('## Fall A — Produkt WIE JETZT in der DB (Aufgabe 5: keine Kategorie hinterlegt)');
lines.push('');
lines.push('```json');
lines.push(JSON.stringify(buildPreviewOfferBody(product), null, 2));
lines.push('```');
lines.push('');
lines.push(product.storeCategoryName
  ? '`storeCategoryNames` ist im Payload enthalten.'
  : '**`storeCategoryNames` fehlt im Payload komplett** — kein "Sonstiges"-Ersatzwert, exakt wie in Aufgabe 5 gefordert.');
lines.push('');

lines.push('## Fall B — Illustratives Beispiel MIT gesetzter Kategorie');
lines.push('');
lines.push('**Wichtig:** `/Wohnen & Möbel` ist hier ein Beispielwert, KEINE echte, live abgerufene');
lines.push('eBay-Kategorie — die echte Kategorieliste ist aus dieser Sandbox nicht abrufbar (s.');
lines.push('`scripts/output/store-categories.md`). Zeigt nur die CODE-PFAD-Logik, nicht echte Daten.');
lines.push('');
const withCategory = { ...product, storeCategoryName: '/Wohnen & Möbel' };
lines.push('```json');
lines.push(JSON.stringify(buildPreviewOfferBody(withCategory), null, 2));
lines.push('```');
lines.push('');
lines.push('`storeCategoryNames: ["/Wohnen & Möbel"]` ist jetzt im Payload enthalten.');

console.log(lines.join('\n'));

const outDir = resolve(import.meta.dir, 'output');
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, 'offer-payload-preview.md');
writeFileSync(outPath, lines.join('\n'), 'utf-8');
console.log(`\nDatei geschrieben: ${outPath}`);
console.log('Es wurde NICHTS geschrieben und KEIN eBay-Call ausgelöst.');
