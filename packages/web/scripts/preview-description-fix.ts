// Verstoß-Reparatur Phase 2 — Testfall für GENAU EIN Angebot (Auftragspunkt 4).
//
// Erzeugt die neue, gefilterte Beschreibung für ein einzelnes Produkt (Default: stele-110,
// eBay-Artikel 198601084836 — aktiv, 0 Verkäufe in 90 Tagen, siehe Phase-0/1-Befund) und
// schreibt Vorher/Nachher als Dateien zum Vergleich.
//
// "Vorher" = product.htmlDescription unverändert aus der DB — das ist exakt das, was heute
// als listingDescription an eBay geht (index.ts: isFullTemplate → fullDescription = rawHtml).
// "Nachher" = buildEbayHTMLLight() mit dem gepatchten Generator, aus denselben Produktfeldern,
// exakt der Parsing-Pfad wie in index.ts (Zeilen ~1519–1558, hier bewusst nachgebildet statt
// dupliziert zu behaupten — index.ts hat diesen Pfad nicht als eigene Funktion extrahiert).
//
// SENDET NICHTS AN EBAY. Kein Import aus ebay.ts, kein getAccessToken(), kein Netzwerk-Call
// außer dem lesenden DB-Zugriff. Schreibt ausschließlich lokale Dateien.
//
// Aufruf (aus packages/web/): bun run scripts/preview-description-fix.ts [productId]
// Ohne Argument: Produkt 110.

import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { buildEbayHTMLLight, type ScrapedProduct } from '../src/web/lib/ebay-description';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const productId = Number(process.argv[2] ?? 110);

const [product] = await db.select().from(schema.products).where(eq(schema.products.id, productId));
if (!product) {
  console.error(`Produkt ${productId} nicht gefunden in der DB.`);
  process.exit(1);
}

const sku = `stele-${product.id}`;
console.log(`Produkt ${productId} (${sku}): "${product.generatedTitle ?? product.title}"`);
console.log(`eBay-Artikel: ${product.ebayListingId ?? '(keiner)'} · Status: ${product.ebayStatus}`);

// ── "Vorher": aktuell gespeicherte Beschreibung, unverändert ────────────────────────────────
const vorher = product.htmlDescription ?? '';

// ── Produktfelder parsen — exakt wie index.ts /ebay/list vor buildEbayHTMLLight() ───────────
const variantGroupsParsed: Array<{ name: string; values: string[] }> = (() => {
  try {
    const parsed = JSON.parse(product.variants ?? '[]');
    if (Array.isArray(parsed) && parsed.length > 0 && 'name' in parsed[0]) return parsed;
  } catch { /* ignore */ }
  return [];
})();
const setContentsParsed: Record<string, string> = (() => {
  try { return JSON.parse(product.variantContents ?? '{}') as Record<string, string>; } catch { return {}; }
})();
const skuVariantsParsed: Array<{ name: string; price: number; imageUrl?: string }> = (() => {
  try {
    const parsed = JSON.parse(product.variantPrices ?? '[]');
    if (Array.isArray(parsed)) return parsed.map((v: { sku?: string; name?: string; ebayPrice?: number; price?: number; imageUrl?: string }) => ({
      name: v.sku ?? v.name ?? '',
      price: v.ebayPrice ?? v.price ?? 0,
      imageUrl: v.imageUrl,
    }));
  } catch { /* ignore */ }
  return [];
})();
const specsParsed: Record<string, string> = (() => {
  try { return JSON.parse(product.specs ?? '{}') as Record<string, string>; } catch { return {}; }
})();
const bulletsParsed: string[] = (() => {
  try { return JSON.parse(product.bullets ?? '[]') as string[]; } catch { return []; }
})();
const images: string[] = (() => { try { return JSON.parse(product.images ?? '[]') as string[]; } catch { return []; } })();

const templateProduct: ScrapedProduct = {
  title: product.generatedTitle ?? product.title,
  description: product.generatedDescription ?? product.description ?? '',
  specs: specsParsed,
  variants: variantGroupsParsed,
  skuVariants: skuVariantsParsed.length > 0 ? skuVariantsParsed : undefined,
  setContents: Object.keys(setContentsParsed).length > 0 ? setContentsParsed : undefined,
  bullets: bulletsParsed.length > 0 ? bulletsParsed : undefined,
  images: images.filter(u => u.startsWith('http')).slice(0, 3),
};

// ── "Nachher": gepatchter Generator ───────────────────────────────────────────────────────
const nachher = buildEbayHTMLLight(templateProduct);

// ── Dateien schreiben ─────────────────────────────────────────────────────────────────────
const outDir = resolve(import.meta.dir, 'output');
mkdirSync(outDir, { recursive: true });
const vorherPath = resolve(outDir, `${sku}-vorher.html`);
const nachherPath = resolve(outDir, `${sku}-nachher.html`);
writeFileSync(vorherPath, vorher, 'utf-8');
writeFileSync(nachherPath, nachher, 'utf-8');

// ── Kennzahlen (frisch nachgerechnet, nicht behauptet — Grundgesetz Regel 3) ─────────────────
function count(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const OWN_EMAIL = 'contact@stele-e-transfer.com';

function analyze(label: string, html: string) {
  const emails = [...html.matchAll(EMAIL_RE)].map(m => m[0]);
  const thirdParty = emails.filter(e => e.toLowerCase() !== OWN_EMAIL);
  console.log(`\n${label}:`);
  console.log(`  Länge: ${html.length} Zeichen`);
  console.log(`  KUNDENSERVICE-Block vorhanden: ${html.includes('KUNDENSERVICE') ? 'JA' : 'nein'}`);
  console.log(`  E-Mail-Treffer gesamt: ${emails.length} (davon eigene Adresse: ${emails.length - thirdParty.length}, Dritt-Kontakte: ${thirdParty.length})`);
  if (thirdParty.length > 0) console.log(`  Dritt-E-Mails: ${[...new Set(thirdParty)].join(', ')}`);
  console.log(`  Impressum-E-Mail vorhanden: ${html.includes('<strong>E-Mail:</strong> contact@stele-e-transfer.com') ? 'JA' : 'NEIN'}`);
  console.log(`  Widerruf-Adresse vorhanden: ${html.includes('Widerruf an:') && html.includes(OWN_EMAIL) ? 'JA' : 'NEIN'}`);
}

analyze('VORHER (aktuell in DB, aktuell auf eBay)', vorher);
analyze('NACHHER (gepatchter Generator)', nachher);

console.log(`\nDateien geschrieben:\n  ${vorherPath}\n  ${nachherPath}`);
console.log('\nEs wurde NICHTS an eBay gesendet. Hochladen erfolgt erst nach manueller Freigabe.');
