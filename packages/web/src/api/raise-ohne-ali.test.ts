import { expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Live-Fund 24.10.2026 (Render-Log): AliExpress-Token abgelaufen → "Fertig — geprüft: 82, aktualisiert: 14, eBay-Updates: 0, Fehler: 68".
// Die Varianten-Anhebung lag nur im Zweig MIT frischen AliExpress-Daten → 68 Produkte (u. a. stele-127 im Verlust) blieben stehen.
// Quelltext-Prüfung (wie variant-stock.test.ts): im Zweig "keine AliExpress-Daten" wird mit dem gespeicherten EK angehoben.
test('Preisprüfung: ohne AliExpress-Daten wird mit gespeichertem Einkaufspreis angehoben (nur live, nur Varianten)', () => {
  const src = readFileSync(resolve(import.meta.dir, 'price-monitor.ts'), 'utf-8');
  const i = src.indexOf('if (!data) {\n        errors++;');
  expect(i).toBeGreaterThan(0);
  const branch = src.slice(i, src.indexOf('return;', i));
  expect(branch).toContain('maybeRaiseVariants(product, product.variantPrices, product.shipsFrom, hold.heldKeys, { explainSkips: true })' /* Fix 251: Gründe je Variante loggen */);
  expect(branch).toContain("product.ebayStatus === 'listed'");
  expect(branch).toContain('isVariantProduct(');
});

// Fix 251 (09.11.2026): Varianten-Produkt + AliExpress-Daten ohne Varianten-Preise → derselbe Zweig (data = null) VOR `if (!data)`.
test('Preisprüfung: Daten ohne Varianten-Preise gehen in den Zweig "gespeicherter Einkaufspreis" (stele-251)', () => {
  const src = readFileSync(resolve(import.meta.dir, 'price-monitor.ts'), 'utf-8');
  const gate = src.indexOf('aliDataUsability(isVariantProduct(product.variants, product.variantPrices), data)');
  const branch = src.indexOf('if (!data) {\n        errors++;');
  expect(gate).toBeGreaterThan(0);
  expect(gate).toBeLessThan(branch);
  expect(src.slice(gate, branch)).toContain('data = null;');
  // der Gate liegt VOR resolveAbPrice (Seitenpreis wird nie Ab-Preis) und vor mergeFreshVariantPrices
  expect(gate).toBeLessThan(src.indexOf('resolveAbPrice(data.price'));
  expect(gate).toBeLessThan(src.indexOf('mergeFreshVariantPrices(product.variantPrices, data.variantPrices)'));
});
