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
  expect(branch).toContain('maybeRaiseVariants(product, product.variantPrices, product.shipsFrom, hold.heldKeys)');
  expect(branch).toContain("product.ebayStatus === 'listed'");
  expect(branch).toContain('isVariantProduct(');
});
