import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Inhaber 18.10.2026 22:48: Multi-Rabatt automatisch beim ersten Listen (Wächter auf die Verdrahtung in POST /ebay/list).
const idx = readFileSync(resolve(import.meta.dir, 'index.ts'), 'utf-8');
const mr = readFileSync(resolve(import.meta.dir, 'multi-rabatt.ts'), 'utf-8');

describe('Multi-Rabatt automatisch beim ersten Listen', () => {
  test('wird NACH dem Speichern von listingId/ebayStatus aufgerufen und nur beim ersten Listen', () => {
    const iList = idx.indexOf(".post('/ebay/list'");
    const iSaved = idx.indexOf("ebayStatus: 'listed'", iList);
    const iAuto = idx.indexOf('sendMultiRabattForNewListing(body.productId)', iList);
    expect(iSaved).toBeGreaterThan(iList);
    expect(iAuto).toBeGreaterThan(iSaved);
    expect(idx.slice(iAuto - 200, iAuto)).toContain('!product.ebayListingId');
  });
  test('Fehler brechen das Listen nicht ab (try/catch) und es wird die aktuelle Vorschau gesendet', () => {
    const i = mr.indexOf('export async function sendMultiRabattForNewListing');
    const body = mr.slice(i, i + 1500);
    expect(body).toContain('try {');
    expect(body).toContain('catch (e)');
    expect(body).toContain('sendMultiRabatt(productId, prev.plan.percents)');
  });
});
