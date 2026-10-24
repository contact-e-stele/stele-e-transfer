import { expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// PR B (Inhaber 24.10.2026 „ja a,b“). Verdrahtung in der Preisprüfung als Quelltext-Prüfung (DB/eBay nicht im Test erreichbar,
// Grundgesetz 1: Grund benannt). Die Rechen-/Entscheidungs-Funktionen selbst sind bestehende, getestete Funktionen.
const src = readFileSync(resolve(import.meta.dir, 'price-monitor.ts'), 'utf-8');
const fn = (name: string) => { const i = src.indexOf(`export async function ${name}(`); expect(i).toBeGreaterThan(0); return src.slice(i, src.indexOf('\n}\n', i)); };

test('Punkt 5: jeder Lauf übernimmt eBay-Preise in die App, wenn keine Sperre besteht', () => {
  const i = src.indexOf('const adopted = await maybeAutoAlign(product);');
  const block = src.slice(i, i + 900);
  expect(block).toContain('!(await isProductPriceLocked(product.id))');
  expect(block).toContain('adoptEbaySellPricesToApp(product');
});

test('Punkt 5: Übernahme nur, wenn Käuferpreis = Angebotsdaten (sonst nichts)', () => {
  const f = fn('adoptEbaySellPricesToApp');
  expect(f).toContain('Käuferpreis ≠ Angebotsdaten — nicht übernommen');
  expect(f).not.toContain('updateOfferPriceBySku'); // schreibt nie an eBay
});

test('Punkt 6: Einzelartikel ohne AliExpress-Daten → Anhebung mit gespeichertem EK, raiseOnly gegen den Live-Preis', () => {
  const i = src.indexOf('if (!data) {\n        errors++;');
  const branch = src.slice(i, src.indexOf('return;', i));
  expect(branch).toContain('raiseSingleWithStoredBuyPrice(product');
  const f = fn('raiseSingleWithStoredBuyPrice');
  expect(f).toContain('applyRaiseOnly(');
  expect(f).toMatch(/updateOfferPriceBySku\(`stele-\$\{product\.id\}`, decision\.price, token, fetch, true\)/);
  expect(f).toContain('SINGLE_ITEM_HOLD_KEY'); // Preis halten respektiert
});
