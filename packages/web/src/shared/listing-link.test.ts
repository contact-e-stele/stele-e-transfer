import { describe, expect, test } from 'bun:test';
import { checkListingLink } from './listing-link';

// Aufbau wie eine GetItem-Antwort (Trading API); Werte nach stele-228 (eBay 198725901272, Bestandseinheit "stele-228", live 18.10.2026).
// Varianten-SKUs sind hier Beispielwerte für die Prüflogik — die echten liest die Route live und gibt sie zurück.
const item = (status: string, sku: string, variants: string[] = []) => `<?xml version="1.0"?><GetItemResponse><Ack>Success</Ack><Item><ItemID>198725901272</ItemID>
<SellingStatus><ListingStatus>${status}</ListingStatus></SellingStatus><SKU>${sku}</SKU><Title>Wärmflasche Classic Heißwasserbeutel für Damen &amp; Herren</Title>
${variants.length ? `<Variations>${variants.map(v => `<Variation><SKU>${v}</SKU><Quantity>4</Quantity></Variation>`).join('')}</Variations>` : ''}</Item></GetItemResponse>`;

describe('Angebot verknüpfen', () => {
  test('aktiv + Bestandseinheit stele-228 → ok', () => {
    const r = checkListingLink(item('Active', 'stele-228'), 228);
    expect(r.ok).toBe(true);
    expect(r.itemSku).toBe('stele-228');
    expect(r.title).toContain('Damen & Herren');
  });
  test('Varianten-SKUs werden gelesen', () => {
    const r = checkListingLink(item('Active', 'stele-228', ['stele-228-A', 'stele-228-B']), 228);
    expect(r.variantSkus).toEqual(['stele-228-A', 'stele-228-B']);
    expect(r.ok).toBe(true);
  });
  test('fremde Bestandseinheit → abgelehnt (auch stele-2280)', () => {
    expect(checkListingLink(item('Active', 'stele-229'), 228).ok).toBe(false);
    expect(checkListingLink(item('Active', 'stele-2280'), 228).ok).toBe(false);
  });
  test('beendet → abgelehnt', () => {
    const r = checkListingLink(item('Completed', 'stele-228'), 228);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('nicht aktiv');
  });
  test('GetItem-Fehler → abgelehnt', () => {
    expect(checkListingLink('<GetItemResponse><Ack>Failure</Ack></GetItemResponse>', 228).ok).toBe(false);
  });
});

describe('Verknüpfen-Route nutzt die volle GetItem-Antwort', () => {
  test('kein OutputSelector-Aufruf (getItemStatusXml), sondern getItemBuyerPricesXml', () => {
    const { readFileSync } = require('fs') as typeof import('fs');
    const { resolve } = require('path') as typeof import('path');
    const idx = readFileSync(resolve(import.meta.dir, '..', 'api', 'index.ts'), 'utf-8');
    const i = idx.indexOf(".post('/products/:id/link-listing'");
    const block = idx.slice(i, i + 2500);
    expect(block).toContain('getItemBuyerPricesXml(listingId)');
    expect(block).not.toContain('getItemStatusXml(');
  });
});
