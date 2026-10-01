import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';

// A-005 (01.10.2026): PUT /offer/{id} ERSETZT das komplette Offer. Ein Teil-Body
// {sku, marketplaceId, pricingSummary} löscht regulatory, listingDescription und categoryId
// (A-003/A-004). Preis-Updates laufen ausschließlich über updateOfferPriceBySku() (price-monitor.ts).
const PARTIAL_PRICE_BODY = /JSON\.stringify\(\s*\{\s*sku:[^}]*pricingSummary/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    if (name === 'node_modules' || name === 'output') return [];
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe('kein Teil-PUT auf /offer/ mit {sku, marketplaceId, pricingSummary}', () => {
  const root = resolve(import.meta.dir, '..', '..');
  const files = [...sourceFiles(join(root, 'src')), ...sourceFiles(join(root, 'scripts'))];

  test('Repo-weit (src + scripts) kein Teil-Body', () => {
    expect(files.length).toBeGreaterThan(10);
    const hits = files.filter(f => PARTIAL_PRICE_BODY.test(readFileSync(f, 'utf-8')));
    expect(hits).toEqual([]);
  });

  test('check-all-prices nutzt updateOfferPriceBySku', () => {
    const src = readFileSync(join(root, 'src', 'api', 'index.ts'), 'utf-8');
    expect(src).toContain('updateOfferPriceBySku(trySku, decision.price, ebayToken)');
  });
});
